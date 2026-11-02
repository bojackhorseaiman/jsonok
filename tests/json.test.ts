// JSON 核心库测试：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../src/core/json.ts';

const errOf = (src: string, loose = false): string => {
  try {
    Core.parse(src, loose);
    return 'OK';
  } catch (e) {
    if (!(e instanceof Core.JsonError)) throw e;
    const { line, col } = Core.lineCol(src, e.pos);
    return `L${line}C${col} ${e.message}`;
  }
};

test('报错：位置准确、原因是中文', () => {
  const cases: [string, string][] = [
    ['{"a":1,}', 'L1C7 最后一项后面多了一个逗号'],
    ['{"a":1\n "b":2}', 'L2C2 缺少逗号'],
    ['{"a":1，"b":2}', 'L1C7 使用了中文逗号'],
    ["{'a':1}", 'L1C2 标准 JSON 不支持单引号'],
    ['{a:1}', 'L1C2 键名必须用双引号包裹'],
    ['{"a":[1,2', 'L1C6 这个 [ 没有对应的结束括号 ]'],
    ['{"a":01}', 'L1C6 JSON 数字不能有前导 0'],
    ['{"a":True}', 'L1C6 True 不是合法的 JSON 值，应写作 true'],
    ['{"a":"x\ny"}', 'L1C8 字符串里不能直接换行'],
    ['{"a":\u00a01}', 'L1C6 这里有一个不可见字符 U+00A0'],
    ['{"a":1}}', 'L1C8 JSON 已经结束，后面还有多余内容'],
    ['[1,2}', 'L1C5 括号不匹配'],
    ['{"a":1 // hi\n}', 'L1C8 标准 JSON 不支持注释'],
    ['{"a":}', 'L1C6 此处应为一个值，却遇到了 }'],
  ];
  for (const [src, expect] of cases) assert.ok(errOf(src).startsWith(expect), `${JSON.stringify(src)} → ${errOf(src)}`);
  assert.equal(errOf('{"a":[1,{"b":null}]}'), 'OK');
});

test('宽松模式：注释、单引号、末尾逗号、无引号键名', () => {
  const src = "{a:1, 'b':'x', /*c*/ \"c\":[1,2,],}";
  assert.equal(Core.stringify(Core.parse(src, true).root, { indent: '' }), '{"a":1,"b":"x","c":[1,2]}');
});

test('超长整数保留精度、检测重复键、统计', () => {
  const p = Core.parse('{"id":1234567890123456789,"d":1,"d":2,"x":{"y":[1]}}');
  assert.ok(Core.stringify(p.root, { indent: '' }).includes('1234567890123456789'));
  assert.equal(p.warnings.length, 1);
  assert.equal(p.warnings[0].key, 'd');
  assert.deepEqual(Core.stats(p.root), { nodes: 7, depth: 4, bigNums: 1 });
});

test('格式化：排序、中文转 \\u、往返一致', () => {
  assert.equal(Core.stringify(Core.parse('{"b":"中","a":1}').root, { indent: '', sort: true, ascii: true }), '{"a":1,"b":"\\u4e2d"}');
  const big = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i, name: '用户' + i, v: i / 7, ok: i % 2 === 0, z: null, arr: [1, { q: '"\\\n' }] })));
  const out = Core.stringify(Core.parse(big).root, { indent: '  ' });
  assert.equal(JSON.stringify(JSON.parse(out)), big);
});

test('转 YAML', () => {
  const y = Core.toYAML(Core.parse('{"a":"yes","b":[{"c":1,"d":[]}],"e":{},"s":"a: b","m":[[1,2],[3]],"n":1}').root);
  assert.equal(y, 'a: "yes"\nb:\n  - c: 1\n    d: []\ne: {}\ns: "a: b"\nm:\n  - - 1\n    - 2\n  - - 3\n"n": 1\n');
});

test('转 XML', () => {
  const x = Core.toXML(Core.parse('{"a":"<&>","list":[1,2],"9k":null}').root);
  assert.equal(x, '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <a>&lt;&amp;&gt;</a>\n  <list>1</list>\n  <list>2</list>\n  <_9k/>\n</root>\n');
});

test('转 CSV：自动找到表格、嵌套字段展开、特殊字符加引号', () => {
  const r = Core.toCSV(Core.parse('{"code":0,"data":{"list":[{"id":1,"name":"李,四","addr":{"city":"青岛"}},{"id":2,"tags":["a"]}]}}').root);
  assert.equal(r.path, '$.data.list');
  assert.equal(r.rows, 2);
  assert.equal(r.text, 'id,name,addr.city,tags\r\n1,"李,四",青岛,\r\n2,,,"[""a""]"');
});

test('Unicode 与转义', () => {
  assert.equal(Core.unicodeToCn('{"a":"\\u6570\\u636e\\u0022"}'), '{"a":"数据\\u0022"}');
  assert.equal(Core.unicodeToCn(Core.cnToUnicode('数据😀')), '数据😀');
  const e = Core.escapeStr('{"a":"x"}');
  assert.equal(e, '{\\"a\\":\\"x\\"}');
  assert.equal(Core.unescapeStr(e), '{"a":"x"}');
  assert.equal(Core.unescapeStr(`"${e}"`), '{"a":"x"}');
  assert.throws(() => Core.unescapeStr('a"b'));
});
