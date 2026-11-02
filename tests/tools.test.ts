// 第 2 步新增工具的核心逻辑测试：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Core from '../src/core/json.ts';
import { cleanNode, diffNodes, mergeNodes, sortNode } from '../src/core/ops.ts';
import { PathError, queryPath } from '../src/core/jsonpath.ts';
import { generateSchema, validateSchema } from '../src/core/schema.ts';
import { LANGS, jsonToCode } from '../src/core/codegen.ts';
import { jsonToPhp, jsonToPostman, jsonToQuery, jsonToSql, postmanToJson, queryToJson } from '../src/core/convert.ts';
import { xmlToJson } from '../src/core/xml.ts';
import { csvToJson, tableToCsv } from '../src/core/csv.ts';
import { jsonToToml, tomlToJson } from '../src/core/toml.ts';
import { jsonToToon, toonToJson } from '../src/core/toon.ts';
import { yamlToJson } from '../src/core/yaml.ts';
import { mockData } from '../src/core/mock.ts';

const P = (s: string) => Core.parse(s).root;
const S = (n: Core.JNode) => Core.stringify(n, { indent: '' });
const locOf = (f: () => unknown): string => {
  try {
    f();
    return 'OK';
  } catch (e) {
    if (e instanceof Core.LocError) return `${e.label} L${e.line}C${e.col} ${e.message}`;
    throw e;
  }
};

test('排序：键名、自然排序、降序、按值、数组按字段', () => {
  const base = { by: 'key', desc: false, deep: true, arrays: false, arrayKey: '', natural: true } as const;
  assert.equal(S(sortNode(P('{"b":1,"a":{"d":1,"c":2},"item10":0,"item2":0}'), base)), '{"a":{"c":2,"d":1},"b":1,"item2":0,"item10":0}');
  assert.equal(S(sortNode(P('{"b":1,"a":2}'), { ...base, desc: true })), '{"b":1,"a":2}');
  assert.equal(S(sortNode(P('{"x":3,"y":1,"z":2}'), { ...base, by: 'value' })), '{"y":1,"z":2,"x":3}');
  assert.equal(S(sortNode(P('[{"id":3},{"id":1},{"x":0},{"id":2}]'), { ...base, arrays: true, arrayKey: 'id' })), '[{"id":1},{"id":2},{"id":3},{"x":0}]');
  assert.equal(S(sortNode(P('{"b":{"z":1,"y":2},"a":0}'), { ...base, deep: false })), '{"a":0,"b":{"z":1,"y":2}}');
  // 超长整数按数值比较
  assert.equal(S(sortNode(P('[12345678901234567891,12345678901234567890,9]'), { ...base, arrays: true })), '[9,12345678901234567890,12345678901234567891]');
});

test('清理：删除空值，变空的容器一并删除', () => {
  const o = { nulls: true, emptyStr: true, emptyArr: true, emptyObj: true, trim: true, arrays: true };
  const r = cleanNode(P('{"id":1,"name":"  张三  ","nick":"","email":null,"tags":["dev",null,""],"profile":{"bio":"","links":[]},"extra":{}}'), o);
  assert.equal(S(r.node), '{"id":1,"name":"张三","tags":["dev"]}');
  // nick、email、tags 里的 null 和 ""、bio、links、变空的 profile、extra
  assert.equal(r.removed, 8);
  assert.equal(r.trimmed, 1);
  assert.equal(S(cleanNode(P('[null,1]'), { ...o, arrays: false }).node), '[null,1]');
});

test('对比：新增 / 删除 / 修改，数字按数值，忽略数组顺序', () => {
  const a = P('{"id":1,"price":10.0,"tags":["a","b"],"owner":{"name":"张三","city":"青岛"}}');
  const b = P('{"id":1,"price":10,"tags":["b","a","c"],"owner":{"name":"李四"},"new":true}');
  const r = diffNodes(a, b, { ignoreOrder: false, numeric: true });
  assert.deepEqual(r.items.map((d) => `${d.kind} ${d.path}`), ['mod $.tags[0]', 'mod $.tags[1]', 'add $.tags[2]', 'mod $.owner.name', 'del $.owner.city', 'add $.new']);
  const r2 = diffNodes(a, b, { ignoreOrder: true, numeric: false });
  assert.deepEqual(r2.items.map((d) => `${d.kind} ${d.path}`), ['mod $.price', 'add $.tags[2]', 'mod $.owner.name', 'del $.owner.city', 'add $.new']);
  assert.equal(diffNodes(P('{"a":[1,{"b":2}]}'), P('{"a":[1,{"b":2.0}]}'), { ignoreOrder: false, numeric: true }).items.length, 0);
});

test('合并：对象递归、数组策略、冲突和 null', () => {
  const a = P('{"v":"1.0","server":{"host":"localhost","port":8080},"tags":["json"],"debug":false}');
  const b = P('{"v":"1.1","server":{"port":9090,"https":true},"tags":["json","fmt"],"debug":null,"owner":"张三"}');
  const r = mergeNodes(a, b, { arrays: 'union', prefer: 'b', nullOverride: false });
  assert.equal(S(r.node), '{"v":"1.1","server":{"host":"localhost","port":9090,"https":true},"tags":["json","fmt"],"debug":false,"owner":"张三"}');
  assert.equal(r.conflicts, 2);
  assert.equal(r.added, 2);
  assert.equal(S(mergeNodes(a, b, { arrays: 'concat', prefer: 'a', nullOverride: true }).node), '{"v":"1.0","server":{"host":"localhost","port":8080,"https":true},"tags":["json","json","fmt"],"debug":false,"owner":"张三"}');
  assert.equal(S(mergeNodes(P('[{"a":1},2]'), P('[{"b":2}]'), { arrays: 'index', prefer: 'b', nullOverride: false }).node), '[{"a":1,"b":2},2]');
});

test('JSONPath：字段、下标、切片、递归、过滤、正则、长度', () => {
  const doc = P('{"store":{"book":[{"title":"A","price":8,"tags":["x"]},{"title":"B","price":12},{"title":"C","price":5,"isbn":"1"}],"bike":{"price":19}},"content-type":"json"}');
  const q = (e: string) => queryPath(doc, e).map((h) => S(h.node)).join(' ');
  assert.equal(q('$.store.book[*].title'), '"A" "B" "C"');
  assert.equal(q('$.store.book[-1].title'), '"C"');
  assert.equal(q('$.store.book[0:2].price'), '8 12');
  assert.equal(q('$.store.book[::-1].title'), '"C" "B" "A"');
  assert.equal(q('$..price'), '8 12 5 19');
  assert.equal(q('$.store.book[?(@.price < 10)].title'), '"A" "C"');
  assert.equal(q('$.store.book[?(@.price > 6 && @.price < 20 || @.isbn)].title'), '"A" "B" "C"');
  assert.equal(q('$.store.book[?(@.isbn)].title'), '"C"');
  assert.equal(q('$.store.book[?(!@.isbn)].title'), '"A" "B"');
  assert.equal(q("$.store.book[?(@.title =~ /^[AB]$/)].price"), '8 12');
  assert.equal(q('$.store.book[?(@.tags.length > 0)].title'), '"A"');
  assert.equal(q('$.store.book[?(length(@.title) == 1)].title'), '"A" "B" "C"');
  assert.equal(q("$['content-type']"), '"json"');
  assert.equal(q('store.bike.price'), '19');
  assert.equal(q("$.store.book[0,2]['title']"), '"A" "C"');
  assert.deepEqual(queryPath(doc, '$..bike.price').map((h) => h.path), ['$.store.bike.price']);
  assert.throws(() => queryPath(doc, '$.store.book[?(@.price <'), PathError);
  assert.throws(() => queryPath(doc, '$.a['), PathError);
});

test('JSON Schema：生成（合并数组元素、required、format）', () => {
  const s = generateSchema(P('{"id":1,"price":1.5,"email":"a@b.com","items":[{"n":1,"x":"a"},{"n":2.5}],"tags":[],"z":null}'), { required: true, format: true, draft: '07' });
  assert.equal(S(s), '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"id":{"type":"integer"},"price":{"type":"number"},"email":{"type":"string","format":"email"},"items":{"type":"array","items":{"type":"object","properties":{"n":{"type":"number"},"x":{"type":"string"}},"required":["n"]}},"tags":{"type":"array","items":{}},"z":{"type":"null"}},"required":["id","price","email","items","tags","z"]}');
  // 生成的 Schema 能校验通过原数据
  const data = P('{"id":1,"when":"2026-01-01T08:00:00Z","list":[{"a":1},{"a":2,"b":null}]}');
  assert.deepEqual(validateSchema(Core.toJS(data), Core.toJS(generateSchema(data, { required: true, format: true, draft: '2020-12' }))), []);
});

test('JSON Schema：校验，错误翻译成中文、路径用 $.a[0]', () => {
  const schema = { type: 'object', required: ['id', 'phone'], additionalProperties: false, properties: { id: { type: 'integer' }, phone: { type: 'string' }, age: { type: 'integer', minimum: 0 }, tags: { type: 'array', uniqueItems: true, items: { type: 'string' } }, b: { anyOf: [{ type: 'string' }, { type: 'number' }] } } };
  const issues = validateSchema({ id: '1', age: -3, tags: ['a', 1, 'a'], b: true, extra: 1 }, schema);
  const got = issues.map((i) => `${i.path} ${i.label}：${i.message}`);
  assert.ok(got.includes('$ 缺少必填字段：缺少必填字段 "phone"'), got.join('\n'));
  assert.ok(got.includes('$.id 类型不符：类型应为 integer，实际是 string'), got.join('\n'));
  assert.ok(got.includes('$.age 数值太小：-3 小于最小值 0'), got.join('\n'));
  assert.ok(got.includes('$.tags[1] 类型不符：类型应为 string，实际是 number'), got.join('\n'));
  assert.ok(got.some((x) => x.startsWith('$.tags 元素重复')), got.join('\n'));
  assert.ok(got.includes('$.b 不满足 anyOf：不满足 anyOf 里的任何一个条件'), got.join('\n'));
  assert.ok(got.includes('$ 多余的字段：不允许出现字段 "extra"'), got.join('\n'));
  assert.equal(got.filter((x) => x.startsWith('$.b ')).length, 1, 'anyOf 的分支错误不应重复列出');
  assert.deepEqual(validateSchema({ id: 1, phone: 'x' }, schema), []);
});

const CODE_SAMPLE = '{"id":12345678901,"user_name":"张三","price":9.9,"vip":true,"tags":["a"],"content-type":"x","profile":{"city":"青岛"},"orders":[{"orderId":1,"amount":10},{"orderId":2,"amount":2.5,"note":"急"}],"extra":null}';

test('JSON 转代码：11 种语言都能生成，类型推断正确', () => {
  const o = { lang: 'ts', root: 'Root', tsStyle: 'interface', javaStyle: 'lombok', pyStyle: 'dataclass', csLib: 'stj', ktLib: 'kotlinx' } as const;
  for (const [lang] of LANGS) {
    const r = jsonToCode(P(CODE_SAMPLE), { ...o, lang });
    assert.equal(r.classes, 3, lang);
    assert.ok(r.code.includes('Order'), `${lang} 应该把 orders 的元素命名为 Order`);
    assert.ok(r.code.includes('Profile'), lang);
  }
  const ts = jsonToCode(P(CODE_SAMPLE), o).code;
  assert.ok(ts.includes('  "content-type": string;'), ts);
  assert.ok(ts.includes('  note?: string;'), ts);
  assert.ok(ts.includes('  extra: any;'), ts);
  assert.ok(ts.includes('  orders: Order[];'), ts);
  const java = jsonToCode(P(CODE_SAMPLE), { ...o, lang: 'java' }).code;
  assert.ok(java.includes('private Long id;'), java);
  assert.ok(java.includes('@JsonProperty("user_name")\n    private String userName;'), java);
  assert.ok(java.includes('private Double amount;'), java);
  assert.ok(java.includes('public static class Order {'), java);
  const rec = jsonToCode(P(CODE_SAMPLE), { ...o, lang: 'java', javaStyle: 'record' }).code;
  assert.ok(rec.includes('public record Root(') && rec.includes('    public record Order(') && rec.trim().endsWith('}'), rec);
  const go = jsonToCode(P(CODE_SAMPLE), { ...o, lang: 'go' }).code;
  assert.ok(/\tID\s+int64\s+`json:"id"`/.test(go), go);
  assert.ok(/\tNote\s+string\s+`json:"note,omitempty"`/.test(go), go);
  const py = jsonToCode(P(CODE_SAMPLE), { ...o, lang: 'python', pyStyle: 'pydantic' }).code;
  assert.ok(py.indexOf('class Order(BaseModel)') < py.indexOf('class Root(BaseModel)'), '被引用的类应该先定义');
  assert.ok(py.includes('content_type: str = Field(alias="content-type")'), py);
  const kt = jsonToCode(P('{"$id":1}'), { ...o, lang: 'kotlin' }).code;
  assert.ok(kt.includes('@SerialName("\\$id")'), kt);
  const dart = jsonToCode(P(CODE_SAMPLE), { ...o, lang: 'dart' }).code;
  assert.ok(dart.includes("amount: (json['amount'] as num).toDouble(),"), dart);
  assert.ok(dart.includes("orders: (json['orders'] as List<dynamic>).map((e) => Order.fromJson(e as Map<String, dynamic>)).toList(),"), dart);
  const rust = jsonToCode(P('{"type":1,"userName":"a"}'), { ...o, lang: 'rust' }).code;
  assert.ok(rust.includes('pub r#type: i64,') && rust.includes('#[serde(rename = "userName")]\n    pub user_name: String,'), rust);
  assert.throws(() => jsonToCode(P('[1,2]'), o));
  // 根是对象数组时，类名直接用根类名
  assert.ok(jsonToCode(P('[{"a":1},{"a":2,"b":"x"}]'), { ...o, root: 'User' }).code.startsWith('export interface User {'));
});

test('GET 参数：双向转换、嵌套、数组、编码', () => {
  const j = P('{"q":"快 JSON","page":1,"tags":["a","b"],"f":{"city":"青岛","vip":true},"empty":null}');
  assert.equal(jsonToQuery(j, { nest: 'bracket', arr: 'repeat', encode: false }), 'q=快 JSON&page=1&tags=a&tags=b&f[city]=青岛&f[vip]=true&empty=');
  assert.equal(jsonToQuery(j, { nest: 'dot', arr: 'bracket', encode: true }), 'q=%E5%BF%AB%20JSON&page=1&tags[]=a&tags[]=b&f.city=%E9%9D%92%E5%B2%9B&f.vip=true&empty=');
  assert.equal(jsonToQuery(j, { nest: 'json', arr: 'comma', encode: false }), 'q=快 JSON&page=1&tags=a,b&f={"city":"青岛","vip":true}&empty=');
  const back = queryToJson('https://x.com/s?q=%E5%BF%AB+JSON&page=1&tags[]=a&tags[]=b&f[city]=%E9%9D%92%E5%B2%9B&list[0][id]=1&list[0][n]=x&list[1][id]=2&a=1&a=2&zip=007#top', { types: true, dots: false });
  assert.equal(S(back), '{"q":"快 JSON","page":1,"tags":["a","b"],"f":{"city":"青岛"},"list":[{"id":1,"n":"x"},{"id":2}],"a":[1,2],"zip":"007"}');
  assert.equal(S(queryToJson('a.b=1&c', { types: false, dots: true })), '{"a":{"b":"1"},"c":""}');
});

test('Postman 批量编辑格式：双向转换', () => {
  const r = jsonToPostman(P('{"u":"admin","n":1,"p":{"city":"青岛"},"t":"a\\nb"}'), { nest: 'json' });
  assert.equal(r.text, 'u:admin\nn:1\np:{"city":"青岛"}\nt:a\\nb');
  assert.equal(r.escaped, 1);
  assert.equal(jsonToPostman(P('{"p":{"city":"青岛","tags":["x"]}}'), { nest: 'bracket' }).text, 'p[city]:青岛\np[tags][0]:x');
  const back = postmanToJson('u:admin\nurl: https://a.com:8080/x\n//debug:1\nn:1\nobj:{"a":1}\n\n', { types: true, nest: false, disabled: false });
  assert.equal(S(back.root), '{"u":"admin","url":"https://a.com:8080/x","n":1,"obj":{"a":1}}');
  assert.equal(back.skipped, 1);
});

test('PHP 数组', () => {
  assert.equal(jsonToPhp(P('{"a":"it\'s \\\\ ok","b":[1,true,null],"c":{}}'), { short: true, varName: '$cfg' }),
    "<?php\n\n$cfg = [\n    'a' => 'it\\'s \\\\ ok',\n    'b' => [\n        1,\n        true,\n        null,\n    ],\n    'c' => [],\n];\n");
  assert.ok(jsonToPhp(P('[1]'), { short: false, varName: '' }).includes('$data = array(\n    1,\n);'));
});

test('SQL：建表 + 批量插入，类型推断、转义、方言', () => {
  const j = P('{"data":{"list":[{"id":1,"name":"O\'Brien","age":28,"vip":true,"joined":"2024-03-01","meta":{"a":1}},{"id":2,"name":"李四","age":null,"vip":false,"joined":"2023-11-20"}]}}');
  const r = jsonToSql(j, { table: '', dialect: 'mysql', create: true, batch: true });
  assert.equal(r.table, 'list');
  assert.equal(r.text, 'CREATE TABLE `list` (\n  `id` INT PRIMARY KEY,\n  `name` VARCHAR(32) NOT NULL,\n  `age` INT,\n  `vip` TINYINT(1) NOT NULL,\n  `joined` DATE NOT NULL,\n  `meta` JSON\n);\n\nINSERT INTO `list` (`id`, `name`, `age`, `vip`, `joined`, `meta`) VALUES\n  (1, \'O\'\'Brien\', 28, 1, \'2024-03-01\', \'{"a":1}\'),\n  (2, \'李四\', NULL, 0, \'2023-11-20\', NULL);\n');
  const pg = jsonToSql(j, { table: 'app.users', dialect: 'postgres', create: false, batch: false }).text;
  assert.ok(pg.startsWith('INSERT INTO "app"."users" ("id", "name", "age", "vip", "joined", "meta") VALUES (1, \'O\'\'Brien\', 28, TRUE,'), pg);
  const ms = jsonToSql(j, { table: 't', dialect: 'sqlserver', create: true, batch: true }).text;
  assert.ok(ms.includes("[name] NVARCHAR(32) NOT NULL") && ms.includes("N'李四'"), ms);
  const ora = jsonToSql(j, { table: 't', dialect: 'oracle', create: false, batch: true }).text;
  assert.equal(ora.split('\n').filter((l) => l.startsWith('INSERT')).length, 2);
  assert.ok(ora.includes("DATE '2024-03-01'"), ora);
});

test('XML → JSON：属性、重复元素、CDATA、实体、报错位置', () => {
  const o = { attrPrefix: '@', ignoreAttrs: false, types: true, textKey: '#text' };
  const r = xmlToJson('<?xml version="1.0"?>\n<!-- c -->\n<site v="1.0"><name>快&amp;JSON</name><f>a</f><f>b</f><stats users="10" ok="true"/><tip><![CDATA[<x>]]></tip><p lang="zh">你好</p><e/></site>', o);
  assert.equal(S(r), '{"site":{"@v":1.0,"name":"快&JSON","f":["a","b"],"stats":{"@users":10,"@ok":true},"tip":"<x>","p":{"@lang":"zh","#text":"你好"},"e":""}}');
  assert.equal(S(xmlToJson('<a x="1"><b>2</b></a>', { ...o, ignoreAttrs: true, types: false })), '{"a":{"b":"2"}}');
  assert.equal(locOf(() => xmlToJson('<a>\n  <b>1</c>\n</a>', o)), 'XML L2C7 标签不匹配：<b> 的结束标签写成了 </c>');
  assert.equal(locOf(() => xmlToJson('<a><b>', o)), 'XML L1C4 <b> 没有对应的结束标签 </b>');
  assert.equal(locOf(() => xmlToJson('<a/><b/>', o)), 'XML L1C5 XML 只能有一个根元素');
});

test('CSV → JSON：引号、自动分隔符、类型、嵌套列、表头去重', () => {
  const o = { delimiter: 'auto', header: true, types: true, nest: true } as const;
  const r = csvToJson('\uFEFFid,name,addr.city,tags,ok\r\n1,"李,""四""",青岛,"[""a""]",true\r\n2,王五,,,false\r\n', o);
  assert.equal(S(r.root), '[{"id":1,"name":"李,\\"四\\"","addr":{"city":"青岛"},"tags":["a"],"ok":true},{"id":2,"name":"王五","addr":{"city":null},"tags":null,"ok":false}]');
  assert.equal(r.delimiter, ',');
  const t = csvToJson('a\tb\tb\n1\t007\tx', { ...o, nest: false });
  assert.equal(t.delimiter, '\t');
  assert.equal(S(t.root), '[{"a":1,"b":"007","b_2":"x"}]');
  assert.equal(S(csvToJson('1,2\n3', { ...o, header: false, types: false }).root), '[["1","2"],["3"]]');
  assert.equal(locOf(() => csvToJson('a,b\n1,"abc\n2,3', o)), 'CSV L2C3 引号没有闭合：单元格以 " 开头，但没有找到结束的 "');
  // 和 JSON → CSV 往返一致
  const src = P('[{"id":1,"name":"李,四","addr":{"city":"青岛"}},{"id":2,"name":"x","addr":{"city":"北京"}}]');
  assert.equal(S(csvToJson(Core.toCSV(src).text, o).root), S(src));
  assert.equal(tableToCsv([['a', 'b'], [1, 'x,y'], [null, new Date(Date.UTC(2024, 0, 2))]]), 'a,b\n1,"x,y"\n,2024-01-02');
});

test('TOML：双向转换，超长整数、null、日期、报错位置', () => {
  const r = jsonToToml(P('{"title":"快JSON","big":12345678901234567890,"n":null,"server":{"port":8080},"users":[{"id":1},{"id":2}],"list":[1,null,2]}'));
  assert.equal(r.text, 'title = "快JSON"\nbig = 12345678901234567890\nlist = [ 1, 2 ]\n\n[server]\nport = 8080\n\n[[users]]\nid = 1\n\n[[users]]\nid = 2\n');
  assert.equal(r.dropped, 2);
  assert.throws(() => jsonToToml(P('[1]')), /最外层必须是对象/);
  assert.equal(S(tomlToJson('a = 12345678901234567890\nd = 2026-11-02\nt = 1979-05-27T07:32:00Z\n[s]\nx = 1.5\n')), '{"a":12345678901234567890,"d":"2026-11-02","t":"1979-05-27T07:32:00.000Z","s":{"x":1.5}}');
  assert.equal(locOf(() => tomlToJson('a = 1\nb = \n')), 'TOML L2C5 TOML 语法错误：invalid value');
});

test('TOON：编码保留超长整数、表格数组；解码报错带行号', () => {
  const r = jsonToToon(P('{"id":12345678901234567890,"users":[{"id":1,"n":"a,b"},{"id":2,"n":"c"}],"tags":["x","y"]}'), { delimiter: 'comma', indent: 2 });
  assert.equal(r.text, 'id: 12345678901234567890\nusers[2]{id,n}:\n  1,"a,b"\n  2,c\ntags[2]: x,y');
  assert.ok(r.toonChars < r.jsonChars);
  assert.equal(S(toonToJson('users[2]{id,name}:\n  1,张三\n  2,李四\n', true).root), '{"users":[{"id":1,"name":"张三"},{"id":2,"name":"李四"}]}');
  assert.equal(toonToJson('n: 12345678901234567890', true).lossy, 1);
  assert.match(locOf(() => toonToJson('users[3]{id}:\n  1\n  2', true)), /^TOON L3C1 TOON 格式错误：/);
});

test('YAML → JSON：超长整数、多文档、报错位置', () => {
  assert.equal(S(yamlToJson('id: 12345678901234567890\nname: 快JSON\ntags: [a, b]\nn: ~\nx: 1.50\n').root), '{"id":12345678901234567890,"name":"快JSON","tags":["a","b"],"n":null,"x":1.5}');
  const m = yamlToJson('a: 1\n---\na: 2\n');
  assert.equal(m.docs, 2);
  assert.equal(S(m.root), '[{"a":1},{"a":2}]');
  assert.equal(yamlToJson('x: .inf').lossy, 1);
  assert.match(locOf(() => yamlToJson('a: 1\nb: [1, 2\nc: 3\n')), /^YAML L[23]C\d+ YAML 语法错误：/);
  assert.match(locOf(() => yamlToJson('a: 1\n  b: 2\n')), /^YAML L1C4 YAML 语法错误：/);
  // 和 JSON → YAML 往返一致
  const src = P('{"a":"yes","b":[{"c":1,"d":[]}],"e":{},"s":"a: b","big":12345678901234567890,"z":null,"t":true,"q":"","num":"123"}');
  assert.equal(S(yamlToJson(Core.toYAML(src)).root), S(src));
});

test('测试数据生成：数组长度、范围、自增、占位符、固定种子可复现', () => {
  const tpl = P('{"list|3":[{"id|+1":100,"age|18-20":0,"g|1":["男","女"],"name":"@name","n":"@int(5,5)","b":"@bool","t":"用户@id","e":"@email","u":"@uuid","x":"@unknown"}],"one|2":"ab","k|1-1":["q"]}');
  const a = mockData(tpl, 1, 42);
  const b = mockData(tpl, 1, 42);
  assert.equal(S(a), S(b), '同一个种子应该生成相同的数据');
  const js = Core.toJS(a) as { list: Record<string, unknown>[]; one: string; k: string[] };
  assert.equal(js.list.length, 3);
  assert.deepEqual(js.list.map((x) => x.id), [100, 101, 102]);
  for (const x of js.list) {
    assert.ok((x.age as number) >= 18 && (x.age as number) <= 20);
    assert.ok(['男', '女'].includes(x.g as string));
    assert.equal(x.n, 5);
    assert.equal(typeof x.b, 'boolean');
    assert.match(x.t as string, /^用户\d+$/);
    assert.match(x.e as string, /^\S+@\S+\.\S+$/);
    assert.match(x.u as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(x.x, '@unknown');
    assert.match(x.name as string, /^[\u4e00-\u9fa5]{2,3}$/);
  }
  assert.equal(js.one, 'abab');
  assert.deepEqual(js.k, ['q']);
  const many = mockData(P('{"id":"@id"}'), 3, 1);
  assert.equal(S(many), '[{"id":1},{"id":2},{"id":3}]');
});

test('工作台工具清单和定义一致', () => {
  const defs = readFileSync(new URL('../src/tools/json/defs.ts', import.meta.url), 'utf8');
  const ids = readFileSync(new URL('../src/tools/json/ids.ts', import.meta.url), 'utf8');
  const inDefs = [...defs.slice(defs.indexOf('export const DEFS')).matchAll(/^  '([\w/-]+)':/gm)].map((m) => m[1]);
  const inIds = [...ids.matchAll(/^  '([\w/-]+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(inIds, inDefs);
  const catalog = readFileSync(new URL('../src/data/catalog.ts', import.meta.url), 'utf8');
  const doneJson = [...catalog.slice(catalog.indexOf("['json'"), catalog.indexOf("['encode'")).matchAll(/\['([\w-]+)','[^']*','[^']*','[^']*done/g)].map((m) => 'json/' + m[1]);
  for (const id of doneJson) assert.ok(inIds.includes(id) || id === 'json/editor', `${id} 标记了 done 但没有实现`);
});
