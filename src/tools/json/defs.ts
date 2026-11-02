// 所有 JSON 类工具的定义。较大的转换库（YAML / TOML / TOON / Schema 校验 / Excel）在用到时才加载
import * as Core from '../../core/json';
import { escapeHtml } from '../../core/text';
import type { Delim } from '../../core/csv';
import type { ListRow, OptDef, Opts, Result, RunCtx, ToolDef } from './types';
import { bool, str } from './types';

// ---------------- 公共选项 ----------------
const O_INDENT: OptDef = { key: 'indent', label: '缩进', type: 'select', options: [['2', '2 空格'], ['4', '4 空格'], ['tab', 'Tab']], def: '2' };
const O_SORT: OptDef = { key: 'sort', label: '键名排序', type: 'check', def: false };
const O_ASCII: OptDef = { key: 'ascii', label: '中文转 \\u', type: 'check', def: false };
const O_LOOSE: OptDef = { key: 'loose', label: '宽松模式', type: 'check', def: false, title: '允许注释、单引号、末尾逗号、不带引号的键名，输出标准 JSON' };
const O_TYPES: OptDef = { key: 'types', label: '自动识别数字和布尔', type: 'check', def: true, title: '"1" → 1，"true" → true；关闭后全部按字符串处理' };

const onDir = (...dirs: string[]) => (_o: Opts, d: string) => dirs.includes(d);
const json = (c: RunCtx, i = 0): Core.JNode => c.json[i]!.root;
const out = (c: RunCtx, nd: Core.JNode, note?: string): Result => ({ kind: 'text', text: Core.stringify(nd, c.fmt), json: true, note });
const pct = (a: number, b: number) => (b ? Math.round((1 - a / b) * 100) : 0);

export const SAMPLE = String.raw`{"site":"快JSON","url":"https://www.kuaijson.com","version":"1.0.0","features":["格式化","校验","压缩","转义","树形视图","转 YAML/XML/CSV"],"stats":{"users":10240,"rating":4.9,"online":true,"beta":null},"orderId":1234567890123456789,"users":[{"id":1,"name":"张三","city":"青岛","tags":["dev","json"]},{"id":2,"name":"李四","city":"北京","tags":[]}],"tip":"\u6570\u636e\u53ea\u5728\u672c\u5730\u5904\u7406"}`;
const PRETTY = (s: string) => Core.stringify(Core.parse(s).root, { indent: '  ' });
const TABLE_SAMPLE = String.raw`{"code":0,"data":{"list":[{"id":1,"name":"张三","age":28,"city":"青岛","vip":true,"joined":"2024-03-01"},{"id":2,"name":"李四","age":35,"city":"北京","vip":false,"joined":"2023-11-20"},{"id":3,"name":"王五","age":null,"city":"上海","vip":true,"joined":"2025-01-08"}]}}`;

const help = (rows: [string, string][], intro = '') =>
  (intro ? `<p>${intro}</p>` : '') + `<table class="help-t">${rows.map(([a, b]) => `<tr><td><code>${escapeHtml(a)}</code></td><td>${escapeHtml(b)}</td></tr>`).join('')}</table>`;

// ================= 格式化 / 压缩 / 树形 =================

const format: ToolDef = {
  opts: [O_INDENT, O_SORT, O_ASCII, O_LOOSE],
  outTitle: () => '格式化结果',
  run: (c) => out(c, json(c)),
  ext: () => 'json',
};

const minify: ToolDef = {
  opts: [O_SORT, O_ASCII, O_LOOSE],
  outTitle: () => '压缩结果',
  run: (c) => {
    const text = Core.stringify(json(c), { ...c.fmt, indent: '' });
    const saved = new TextEncoder().encode(c.src[0]).length - new TextEncoder().encode(text).length;
    return { kind: 'text', text, json: true, note: saved > 0 ? `节省 ${(saved / 1024).toFixed(1)} KB（${pct(text.length, c.src[0].length)}%）` : '' };
  },
  ext: () => 'json',
};

const viewer: ToolDef = {
  opts: [O_SORT, O_LOOSE],
  outTitle: () => '树形视图',
  run: (c) => {
    const root = bool(c.o, 'sort') ? Core.parse(Core.stringify(json(c), { indent: '', sort: true })).root : json(c);
    return { kind: 'tree', root, text: Core.stringify(root, c.fmt), note: '点击节点可查看并复制路径' };
  },
  ext: () => 'json',
};

// ================= 转义 / Unicode =================

const escape: ToolDef = {
  opts: [O_LOOSE],
  dirs: [['escape', '转义'], ['unescape', '去转义']],
  flip: { escape: 'unescape', unescape: 'escape' },
  jsonIn: () => false,
  placeholder: (d) => (d === 'escape' ? '粘贴 JSON 或任意文本，转成可以放进字符串里的形式…' : '粘贴 {\\"a\\":1} 这样转义过的字符串，还原成 JSON…'),
  sample: (d) => [d === 'escape' ? SAMPLE : Core.escapeStr(Core.stringify(Core.parse(SAMPLE).root, { indent: '' }))],
  run: (c) => {
    const src = c.src[0];
    if (c.dir === 'unescape') {
      const s = Core.unescapeStr(src);
      try {
        return out(c, Core.parse(s, bool(c.o, 'loose')).root, '已去转义并格式化');
      } catch {
        return { kind: 'text', text: s, note: '已去转义（结果不是 JSON，按原文显示）' };
      }
    }
    try {
      const min = Core.stringify(Core.parse(src, bool(c.o, 'loose')).root, { indent: '' });
      return { kind: 'text', text: Core.escapeStr(min), note: '已压缩并转义' };
    } catch {
      return { kind: 'text', text: Core.escapeStr(src), note: '已转义原始文本' };
    }
  },
  ext: (_d, _o, r) => (r.kind === 'text' && r.json ? 'json' : 'txt'),
};

const unicode: ToolDef = {
  opts: [],
  dirs: [['toCn', 'Unicode 转中文'], ['toU', '中文转 Unicode']],
  flip: { toCn: 'toU', toU: 'toCn' },
  jsonIn: () => false,
  placeholder: (d) => (d === 'toCn' ? '粘贴包含 \\u4e2d\\u6587 这类编码的文本…' : '粘贴包含中文的文本…'),
  sample: (d) => [d === 'toCn' ? '{"tip":"\\u6570\\u636e\\u53ea\\u5728\\u672c\\u5730\\u5904\\u7406"}' : '{"tip":"数据只在本地处理"}'],
  run: (c) => ({ kind: 'text', text: c.dir === 'toU' ? Core.cnToUnicode(c.src[0]) : Core.unicodeToCn(c.src[0]) }),
  ext: () => 'txt',
};

// ================= YAML / XML / CSV / TOML / TOON 双向 =================

const yaml: ToolDef = {
  dirs: [['to', 'JSON → YAML'], ['from', 'YAML → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [O_SORT, { ...O_LOOSE, show: onDir('to') }, { ...O_INDENT, show: onDir('from') }],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 YAML'],
  outTitle: (d) => (d === 'to' ? 'YAML' : 'JSON'),
  placeholder: (d) => (d === 'to' ? '' : '粘贴 YAML，例如\nname: 快JSON\ntags:\n  - json\n  - yaml'),
  sample: (d) => [d === 'to' ? SAMPLE : 'site: 快JSON\nversion: 1.0.0\nfeatures:\n  - 格式化\n  - 校验\nstats:\n  users: 10240\n  online: true\n  beta: ~\norderId: 1234567890123456789\n'],
  run: async (c) => {
    if (c.dir === 'to') return { kind: 'text', text: Core.toYAML(json(c), { sort: bool(c.o, 'sort') }) };
    const { yamlToJson } = await import('../../core/yaml');
    const r = yamlToJson(c.src[0]);
    const notes = [r.docs > 1 ? `包含 ${r.docs} 个文档，已合并成数组` : '', r.lossy ? `${r.lossy} 个 .inf / .nan 值已转成 null` : ''].filter(Boolean);
    return out(c, r.root, notes.join(' · '));
  },
  ext: (d) => (d === 'to' ? 'yaml' : 'json'),
};

const xml: ToolDef = {
  dirs: [['to', 'JSON → XML'], ['from', 'XML → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [
    { ...O_LOOSE, show: onDir('to') },
    { key: 'prefix', label: '属性前缀', type: 'select', options: [['@', '@id'], ['_', '_id'], ['-', '-id'], ['', '无前缀']], def: '@', show: onDir('from') },
    { key: 'noAttr', label: '忽略属性', type: 'check', def: false, show: onDir('from') },
    { ...O_TYPES, show: onDir('from') },
    { ...O_INDENT, show: onDir('from') },
  ],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 XML'],
  outTitle: (d) => (d === 'to' ? 'XML' : 'JSON'),
  placeholder: (d) => (d === 'to' ? '' : '粘贴 XML，例如 <user id="1"><name>张三</name></user>'),
  sample: (d) => [d === 'to' ? SAMPLE : '<?xml version="1.0" encoding="UTF-8"?>\n<site version="1.0">\n  <name>快JSON</name>\n  <feature>格式化</feature>\n  <feature>校验</feature>\n  <stats users="10240" online="true"/>\n  <tip><![CDATA[数据只在<本地>处理]]></tip>\n</site>\n'],
  run: async (c) => {
    if (c.dir === 'to') return { kind: 'text', text: Core.toXML(json(c)) };
    const { xmlToJson } = await import('../../core/xml');
    return out(c, xmlToJson(c.src[0], { attrPrefix: str(c.o, 'prefix'), ignoreAttrs: bool(c.o, 'noAttr'), types: bool(c.o, 'types'), textKey: '#text' }), '重复的同名元素会合并成数组');
  },
  ext: (d) => (d === 'to' ? 'xml' : 'json'),
};

const csv: ToolDef = {
  dirs: [['to', 'JSON → CSV'], ['from', 'CSV / Excel → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [
    { ...O_LOOSE, show: onDir('to') },
    { key: 'delim', label: '分隔符', type: 'select', options: [['auto', '自动识别'], [',', '逗号 ,'], ['\t', 'Tab'], [';', '分号 ;'], ['|', '竖线 |']], def: 'auto', show: onDir('from') },
    { key: 'header', label: '第一行是表头', type: 'check', def: true, show: onDir('from') },
    { ...O_TYPES, show: onDir('from') },
    { key: 'nest', label: 'a.b 列名还原成嵌套', type: 'check', def: true, show: onDir('from') },
    { ...O_INDENT, show: onDir('from') },
  ],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 CSV（也可以打开 Excel 文件）'],
  outTitle: (d) => (d === 'to' ? 'CSV' : 'JSON'),
  placeholder: (d) => (d === 'to' ? '粘贴 JSON 数组，或 {"data":[...]} 这类包了一层的数据…' : '粘贴 CSV，或点“打开文件”选择 .csv / .xlsx 文件…'),
  sample: (d) => [d === 'to' ? TABLE_SAMPLE : 'id,name,age,addr.city,vip\n1,张三,28,青岛,true\n2,"李,四",35,北京,false\n3,王五,,上海,true\n'],
  accept: '.json,.csv,.tsv,.txt,.xlsx',
  readFile: (f) => {
    if (!/\.xlsx$/i.test(f.name)) {
      if (/\.xls$/i.test(f.name)) return Promise.reject(new Error('暂不支持旧版 .xls 文件，请在 Excel 里另存为 .xlsx 或 .csv'));
      return null;
    }
    return (async () => {
      const [{ readSheet }, { tableToCsv }] = await Promise.all([import('read-excel-file/browser'), import('../../core/csv')]);
      const rows = (await readSheet(f)) as unknown as unknown[][];
      return { text: tableToCsv(rows), dir: 'from', note: `已读取 ${f.name} 的第一个工作表（${rows.length} 行）` };
    })();
  },
  run: async (c) => {
    if (c.dir === 'to') {
      const r = Core.toCSV(json(c));
      return { kind: 'text', text: r.text, note: (r.path ? `已自动取 ${r.path} 作为表格 · ` : '') + `${r.rows} 行 × ${r.cols} 列 · 下载的文件可以直接用 Excel 打开` };
    }
    const { csvToJson } = await import('../../core/csv');
    const r = csvToJson(c.src[0], { delimiter: str(c.o, 'delim') as Delim, header: bool(c.o, 'header'), types: bool(c.o, 'types'), nest: bool(c.o, 'nest') });
    const dn: Record<string, string> = { ',': '逗号', '\t': 'Tab', ';': '分号', '|': '竖线' };
    return out(c, r.root, `${r.rows} 行 × ${r.cols} 列 · 分隔符：${dn[r.delimiter] ?? r.delimiter}`);
  },
  ext: (d) => (d === 'to' ? 'csv' : 'json'),
};

const toml: ToolDef = {
  dirs: [['to', 'JSON → TOML'], ['from', 'TOML → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [{ ...O_LOOSE, show: onDir('to') }, { ...O_INDENT, show: onDir('from') }],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 TOML'],
  outTitle: (d) => (d === 'to' ? 'TOML' : 'JSON'),
  placeholder: (d) => (d === 'to' ? '粘贴 JSON 对象…' : '粘贴 TOML，例如\ntitle = "快JSON"\n\n[server]\nport = 8080'),
  sample: (d) => [d === 'to' ? SAMPLE : 'title = "快JSON"\nversion = "1.0.0"\nreleased = 2026-11-02\n\n[server]\nhost = "0.0.0.0"\nport = 8080\n\n[[users]]\nid = 1\nname = "张三"\n\n[[users]]\nid = 2\nname = "李四"\n'],
  run: async (c) => {
    const m = await import('../../core/toml');
    if (c.dir === 'to') {
      const r = m.jsonToToml(json(c));
      return { kind: 'text', text: r.text, note: r.dropped ? `TOML 不支持 null，已忽略 ${r.dropped} 个 null 值` : '' };
    }
    return out(c, m.tomlToJson(c.src[0]), '日期时间已转成字符串');
  },
  ext: (d) => (d === 'to' ? 'toml' : 'json'),
};

const toon: ToolDef = {
  dirs: [['to', 'JSON → TOON'], ['from', 'TOON → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [
    { ...O_LOOSE, show: onDir('to') },
    { key: 'delim', label: '分隔符', type: 'select', options: [['comma', '逗号'], ['tab', 'Tab'], ['pipe', '竖线 |']], def: 'comma', show: onDir('to') },
    { key: 'tindent', label: '缩进', type: 'select', options: [['2', '2 空格'], ['4', '4 空格']], def: '2', show: onDir('to') },
    { key: 'strict', label: '严格校验', type: 'check', def: true, title: '校验数组声明的长度和实际行数是否一致', show: onDir('from') },
    { ...O_INDENT, show: onDir('from') },
  ],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 TOON'],
  outTitle: (d) => (d === 'to' ? 'TOON' : 'JSON'),
  sample: (d) => [d === 'to' ? TABLE_SAMPLE : 'code: 0\nusers[2]{id,name,city}:\n  1,张三,青岛\n  2,李四,北京\ntags[3]: json,toon,llm\n'],
  help: '<p>TOON（Token-Oriented Object Notation）是一种给大模型用的紧凑格式：对象数组写成表格（字段名只写一次），比 JSON 省不少 token，适合放进提示词。</p>',
  run: async (c) => {
    const m = await import('../../core/toon');
    if (c.dir === 'to') {
      const r = m.jsonToToon(json(c), { delimiter: str(c.o, 'delim') as 'comma', indent: Number(str(c.o, 'tindent')) });
      return { kind: 'text', text: r.text, note: `${r.toonChars} 字符，比压缩后的 JSON 少 ${pct(r.toonChars, r.jsonChars)}%` };
    }
    const r = m.toonToJson(c.src[0], bool(c.o, 'strict'));
    return out(c, r.root, r.lossy ? `⚠ ${r.lossy} 个超长整数可能已丢失精度` : '');
  },
  ext: (d) => (d === 'to' ? 'toon' : 'json'),
};

// ================= 排序 / 清理 =================

const sort: ToolDef = {
  opts: [
    { key: 'by', label: '对象按', type: 'select', options: [['key', '键名'], ['value', '值']], def: 'key' },
    { key: 'order', label: '顺序', type: 'select', options: [['asc', '升序 A→Z'], ['desc', '降序 Z→A']], def: 'asc' },
    { key: 'natural', label: '自然排序', type: 'check', def: true, title: 'item2 排在 item10 前面；中文按拼音排序' },
    { key: 'deep', label: '所有层级', type: 'check', def: true, title: '关闭后只排序最外层' },
    { key: 'arrays', label: '数组元素也排序', type: 'check', def: false },
    { key: 'akey', label: '按字段', type: 'text', def: '', placeholder: '如 id', width: 90, title: '对象数组按这个字段排序；不填就按整个元素排序', show: (o) => o.arrays === true },
    O_INDENT, O_LOOSE,
  ],
  outTitle: () => '排序结果',
  run: async (c) => {
    const { sortNode } = await import('../../core/ops');
    return out(c, sortNode(json(c), {
      by: str(c.o, 'by') as 'key', desc: str(c.o, 'order') === 'desc', deep: bool(c.o, 'deep'),
      arrays: bool(c.o, 'arrays'), arrayKey: str(c.o, 'akey'), natural: bool(c.o, 'natural'),
    }));
  },
  ext: () => 'json',
};

const clean: ToolDef = {
  opts: [
    { key: 'nulls', label: '删除 null', type: 'check', def: true },
    { key: 'emptyStr', label: '删除空字符串', type: 'check', def: true },
    { key: 'emptyArr', label: '删除空数组 []', type: 'check', def: true },
    { key: 'emptyObj', label: '删除空对象 {}', type: 'check', def: true },
    { key: 'trim', label: '去掉首尾空格', type: 'check', def: false },
    { key: 'arrays', label: '也清理数组元素', type: 'check', def: true, title: '关闭后数组里的 null、空值保持不动（不改变下标）' },
    O_INDENT, O_LOOSE,
  ],
  outTitle: () => '清理结果',
  sample: () => ['{"id":1,"name":"  张三  ","nick":"","email":null,"tags":["dev",null,""],"profile":{"bio":"","links":[]},"extra":{}}'],
  run: async (c) => {
    const { cleanNode } = await import('../../core/ops');
    const r = cleanNode(json(c), {
      nulls: bool(c.o, 'nulls'), emptyStr: bool(c.o, 'emptyStr'), emptyArr: bool(c.o, 'emptyArr'),
      emptyObj: bool(c.o, 'emptyObj'), trim: bool(c.o, 'trim'), arrays: bool(c.o, 'arrays'),
    });
    const notes = [`删除了 ${r.removed} 个值`, r.trimmed ? `去掉了 ${r.trimmed} 处首尾空格` : ''].filter(Boolean);
    return out(c, r.node, notes.join(' · '));
  },
  ext: () => 'json',
};

// ================= 对比 / 合并 =================

const preview = (nd?: Core.JNode) => {
  if (!nd) return '';
  const s = Core.stringify(nd, { indent: '' });
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
};

const diff: ToolDef = {
  inputs: () => 2,
  inTitles: () => ['原始 JSON（A）', '新的 JSON（B）'],
  outTitle: () => '差异',
  opts: [
    { key: 'ignoreOrder', label: '忽略数组顺序', type: 'check', def: false, title: '数组元素按内容匹配，不按位置；元素有改动时会显示为一删一增' },
    { key: 'numeric', label: '数字按数值比较', type: 'check', def: true, title: '1.0 和 1 视为相同' },
    O_LOOSE,
  ],
  sample: () => [
    PRETTY('{"id":1,"name":"快JSON","version":"1.0.0","tags":["json","format"],"owner":{"name":"张三","city":"青岛"},"price":10.0}'),
    PRETTY('{"id":1,"name":"快JSON 工具箱","version":"1.1.0","tags":["json","format","diff"],"owner":{"name":"张三"},"price":10,"online":true}'),
  ],
  run: async (c) => {
    const { diffNodes } = await import('../../core/ops');
    const r = diffNodes(json(c, 0), json(c, 1), { ignoreOrder: bool(c.o, 'ignoreOrder'), numeric: bool(c.o, 'numeric') });
    const LBL = { add: '新增', del: '删除', mod: '修改' } as const;
    const rows: ListRow[] = r.items.map((d) => ({ tone: d.kind, cells: [LBL[d.kind], d.path, preview(d.a), preview(d.b)] }));
    const count = (k: string) => r.items.filter((d) => d.kind === k).length;
    const summary = r.items.length
      ? `共 ${r.items.length}${r.truncated ? '+' : ''} 处差异：新增 ${count('add')}，删除 ${count('del')}，修改 ${count('mod')}`
      : '';
    const text = r.items.map((d) => (d.kind === 'add' ? `+ ${d.path}: ${preview(d.b)}` : d.kind === 'del' ? `- ${d.path}: ${preview(d.a)}` : `~ ${d.path}: ${preview(d.a)} → ${preview(d.b)}`)).join('\n');
    return { kind: 'list', head: ['类型', '路径', 'A 中的值', 'B 中的值'], rows, summary, okText: '两份 JSON 完全相同', text: text || '两份 JSON 完全相同', note: r.truncated ? '差异太多，只显示前 5000 处' : '' };
  },
  ext: () => 'txt',
};

const merge: ToolDef = {
  inputs: () => 2,
  inTitles: () => ['JSON A', 'JSON B'],
  outTitle: () => '合并结果',
  opts: [
    { key: 'arrays', label: '数组', type: 'select', options: [['replace', '整体替换'], ['concat', '拼接'], ['union', '拼接并去重'], ['index', '按下标合并']], def: 'concat' },
    { key: 'prefer', label: '冲突时', type: 'select', options: [['b', '以 B 为准'], ['a', '以 A 为准']], def: 'b' },
    { key: 'nullOverride', label: 'null 也覆盖', type: 'check', def: false, title: '关闭时，一边是 null 另一边有值，保留有值的那边' },
    O_INDENT, O_LOOSE,
  ],
  sample: () => [
    PRETTY('{"name":"快JSON","version":"1.0.0","server":{"host":"localhost","port":8080},"tags":["json"],"debug":false}'),
    PRETTY('{"version":"1.1.0","server":{"port":9090,"https":true},"tags":["format"],"debug":null,"owner":"张三"}'),
  ],
  run: async (c) => {
    const { mergeNodes } = await import('../../core/ops');
    const r = mergeNodes(json(c, 0), json(c, 1), { arrays: str(c.o, 'arrays') as 'concat', prefer: str(c.o, 'prefer') as 'b', nullOverride: bool(c.o, 'nullOverride') });
    return out(c, r.node, `新增 ${r.added} 个字段 · ${r.conflicts} 处冲突${r.conflicts ? `，已以 ${str(c.o, 'prefer') === 'b' ? 'B' : 'A'} 为准` : ''}`);
  },
  ext: () => 'json',
};

// ================= JSONPath =================

const jsonpath: ToolDef = {
  opts: [
    { key: 'expr', label: '表达式', type: 'text', def: '$.users[*].name', placeholder: '$.store.book[?(@.price < 10)].title', width: 320 },
    { key: 'output', label: '输出', type: 'select', options: [['value', '值'], ['path', '路径'], ['both', '路径和值']], def: 'value' },
    O_LOOSE,
  ],
  presets: [
    { label: '所有用户名', o: { expr: '$.users[*].name' } },
    { label: '第一个用户', o: { expr: '$.users[0]' } },
    { label: '最后一个', o: { expr: '$.users[-1:]' } },
    { label: '递归找 name', o: { expr: '$..name' } },
    { label: '过滤 id > 1', o: { expr: '$.users[?(@.id > 1)]' } },
    { label: '正则匹配', o: { expr: "$.users[?(@.city =~ /^青/)].name" } },
    { label: '有标签的用户', o: { expr: '$.users[?(@.tags.length > 0)].name' } },
  ],
  outTitle: () => '查询结果',
  help: help([
    ['$', '根节点'],
    ['.name 或 [\'name\']', '取字段（字段名有特殊字符时用方括号）'],
    ['[0]  [-1]', '数组下标，负数从末尾数'],
    ['[0:3]  [::2]', '切片：开始:结束:步长'],
    ['*', '所有子元素'],
    ['..name', '递归查找所有层级的 name'],
    ['[0,2]  [\'a\',\'b\']', '同时取多个'],
    ['[?(@.age > 18)]', '过滤：@ 是当前元素，支持 == != < <= > >= =~ && || !'],
    ['[?(@.name =~ /^张/)]', '正则匹配'],
    ['[?(@.email)]', '只要有 email 字段的'],
    ['length(@.tags)  @.tags.length', '数组 / 字符串长度'],
  ]),
  run: async (c) => {
    const { queryPath, PathError } = await import('../../core/jsonpath');
    const expr = str(c.o, 'expr').trim();
    if (!expr) return { kind: 'text', text: '', note: '请在上方输入 JSONPath 表达式' };
    let hits;
    try {
      hits = queryPath(json(c), expr);
    } catch (e) {
      if (e instanceof PathError) throw new Error(`JSONPath 表达式有误（第 ${e.pos + 1} 个字符）：${e.message}`);
      throw e;
    }
    const mode = str(c.o, 'output');
    const items: Core.JNode[] = hits.map((h) =>
      mode === 'path' ? { t: 's', v: h.path } : mode === 'both' ? { t: 'o', items: [['path', { t: 's', v: h.path }], ['value', h.node]] } : h.node,
    );
    return out(c, { t: 'a', items }, `找到 ${hits.length} 个结果`);
  },
  ext: () => 'json',
};

// ================= JSON Schema =================

const schema: ToolDef = {
  dirs: [['gen', '生成 Schema'], ['check', '校验数据']],
  inputs: (d) => (d === 'gen' ? 1 : 2),
  inTitles: (d) => (d === 'gen' ? ['示例 JSON'] : ['要校验的 JSON 数据', 'JSON Schema']),
  outTitle: (d) => (d === 'gen' ? 'JSON Schema' : '校验结果'),
  opts: [
    { key: 'draft', label: '版本', type: 'select', options: [['07', 'Draft 07'], ['2020-12', '2020-12']], def: '07', show: onDir('gen') },
    { key: 'required', label: '生成 required', type: 'check', def: true, title: '每个对象里都出现的字段设为必填', show: onDir('gen') },
    { key: 'format', label: '识别格式', type: 'check', def: true, title: '识别日期时间、邮箱、网址、IP、UUID', show: onDir('gen') },
    { ...O_INDENT, show: onDir('gen') },
    O_LOOSE,
  ],
  sample: (d) =>
    d === 'gen'
      ? [PRETTY('{"id":1,"name":"张三","email":"zhangsan@example.com","age":28,"tags":["dev"],"created":"2026-01-01T08:00:00Z","address":{"city":"青岛","zip":"266000"}}')]
      : [
          PRETTY('{"id":"1","name":"","email":"not-an-email","age":-3,"tags":["dev","dev"],"extra":true}'),
          PRETTY('{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","required":["id","name","email","phone"],"additionalProperties":false,"properties":{"id":{"type":"integer"},"name":{"type":"string","minLength":1},"email":{"type":"string","format":"email"},"age":{"type":"integer","minimum":0},"phone":{"type":"string"},"tags":{"type":"array","uniqueItems":true,"items":{"type":"string"}}}}'),
        ],
  run: async (c) => {
    const m = await import('../../core/schema');
    if (c.dir === 'gen') {
      return out(c, m.generateSchema(json(c), { draft: str(c.o, 'draft') as '07', required: bool(c.o, 'required'), format: bool(c.o, 'format') }));
    }
    const issues = m.validateSchema(Core.toJS(json(c, 0)), Core.toJS(json(c, 1)));
    return {
      kind: 'list',
      head: ['问题', '位置', '说明'],
      rows: issues.map((x) => ({ tone: 'err', cells: [x.label, x.path, x.message] })),
      summary: issues.length ? `发现 ${issues.length} 个问题` : '',
      okText: '✓ 校验通过，数据符合 Schema',
      text: issues.length ? issues.map((x) => `${x.path}  ${x.label}：${x.message}`).join('\n') : '校验通过',
    };
  },
  ext: (d) => (d === 'gen' ? 'json' : 'txt'),
};

// ================= 转代码 / SQL / PHP =================

const LANG_OPTS: [string, string][] = [
  ['java', 'Java'], ['kotlin', 'Kotlin'], ['csharp', 'C#'], ['go', 'Go'], ['ts', 'TypeScript'], ['python', 'Python'],
  ['rust', 'Rust'], ['swift', 'Swift'], ['dart', 'Dart'], ['php', 'PHP'], ['cpp', 'C++ (nlohmann/json)'],
];
const LANG_EXT: Record<string, string> = { ts: 'ts', java: 'java', kotlin: 'kt', csharp: 'cs', go: 'go', python: 'py', rust: 'rs', swift: 'swift', dart: 'dart', php: 'php', cpp: 'hpp' };
const isLang = (...l: string[]) => (o: Opts) => l.includes(str(o, 'lang'));

const toCode: ToolDef = {
  opts: [
    { key: 'lang', label: '语言', type: 'select', options: LANG_OPTS, def: 'java' },
    { key: 'root', label: '类名', type: 'text', def: 'Root', width: 100 },
    { key: 'javaStyle', label: '风格', type: 'select', options: [['lombok', 'Lombok @Data'], ['pojo', 'Getter / Setter'], ['record', 'record（Java 16+）']], def: 'lombok', show: isLang('java') },
    { key: 'ktLib', label: '序列化库', type: 'select', options: [['kotlinx', 'kotlinx.serialization'], ['gson', 'Gson']], def: 'kotlinx', show: isLang('kotlin') },
    { key: 'csLib', label: '序列化库', type: 'select', options: [['stj', 'System.Text.Json'], ['newtonsoft', 'Newtonsoft.Json']], def: 'stj', show: isLang('csharp') },
    { key: 'tsStyle', label: '写法', type: 'select', options: [['interface', 'interface'], ['type', 'type']], def: 'interface', show: isLang('ts') },
    { key: 'pyStyle', label: '写法', type: 'select', options: [['dataclass', 'dataclass'], ['pydantic', 'Pydantic'], ['typeddict', 'TypedDict']], def: 'dataclass', show: isLang('python') },
    O_LOOSE,
  ],
  outTitle: () => '生成的代码',
  run: async (c) => {
    const { jsonToCode } = await import('../../core/codegen');
    const r = jsonToCode(json(c), {
      lang: str(c.o, 'lang') as 'java', root: str(c.o, 'root'),
      javaStyle: str(c.o, 'javaStyle') as 'lombok', ktLib: str(c.o, 'ktLib') as 'kotlinx', csLib: str(c.o, 'csLib') as 'stj',
      tsStyle: str(c.o, 'tsStyle') as 'interface', pyStyle: str(c.o, 'pyStyle') as 'dataclass',
    });
    return { kind: 'text', text: r.code, note: `生成了 ${r.classes} 个类型 · 数组里的多个对象已合并，缺少的字段标为可选` };
  },
  ext: (_d, o) => LANG_EXT[str(o, 'lang')] ?? 'txt',
};

const sql: ToolDef = {
  opts: [
    { key: 'dialect', label: '数据库', type: 'select', options: [['mysql', 'MySQL'], ['postgres', 'PostgreSQL'], ['sqlite', 'SQLite'], ['sqlserver', 'SQL Server'], ['oracle', 'Oracle']], def: 'mysql' },
    { key: 'table', label: '表名', type: 'text', def: '', placeholder: '自动', width: 110 },
    { key: 'create', label: '生成建表语句', type: 'check', def: true },
    { key: 'batch', label: '合并成一条 INSERT', type: 'check', def: true, title: '多行数据合并到一条 INSERT 里（每 500 行一条）；Oracle 始终逐行生成' },
    O_LOOSE,
  ],
  outTitle: () => 'SQL',
  sample: () => [TABLE_SAMPLE],
  run: async (c) => {
    const { jsonToSql } = await import('../../core/convert');
    const r = jsonToSql(json(c), { table: str(c.o, 'table'), dialect: str(c.o, 'dialect') as 'mysql', create: bool(c.o, 'create'), batch: bool(c.o, 'batch') });
    return { kind: 'text', text: r.text, note: (r.path ? `已自动取 ${r.path} 作为数据 · ` : '') + `表 ${r.table}，${r.rows} 行 × ${r.cols} 列 · 嵌套字段存为 JSON 文本` };
  },
  ext: () => 'sql',
};

const php: ToolDef = {
  opts: [
    { key: 'short', label: '短数组 []', type: 'check', def: true, title: '关闭后使用 array() 写法（PHP 5.3 及以下）' },
    { key: 'var', label: '变量名', type: 'text', def: 'data', width: 90 },
    O_LOOSE,
  ],
  outTitle: () => 'PHP 数组',
  run: async (c) => {
    const { jsonToPhp } = await import('../../core/convert');
    return { kind: 'text', text: jsonToPhp(json(c), { short: bool(c.o, 'short'), varName: str(c.o, 'var') }) };
  },
  ext: () => 'php',
};

// ================= GET 参数 / Postman =================

const query: ToolDef = {
  dirs: [['to', 'JSON → GET 参数'], ['from', 'GET 参数 → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [
    { key: 'nest', label: '嵌套对象', type: 'select', options: [['bracket', 'a[b]=1'], ['dot', 'a.b=1'], ['json', 'JSON 字符串']], def: 'bracket', show: onDir('to') },
    { key: 'arr', label: '数组', type: 'select', options: [['repeat', 'a=1&a=2'], ['bracket', 'a[]=1&a[]=2'], ['index', 'a[0]=1&a[1]=2'], ['comma', 'a=1,2']], def: 'repeat', show: onDir('to') },
    { key: 'encode', label: 'URL 编码', type: 'check', def: true, show: onDir('to') },
    { ...O_LOOSE, show: onDir('to') },
    { ...O_TYPES, show: onDir('from') },
    { key: 'dots', label: 'a.b 当作嵌套', type: 'check', def: false, show: onDir('from') },
    { ...O_INDENT, show: onDir('from') },
  ],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 GET 参数或完整网址'],
  outTitle: (d) => (d === 'to' ? 'GET 参数' : 'JSON'),
  placeholder: (d) => (d === 'to' ? '粘贴 JSON 对象，例如 {"page":1,"size":20,"filter":{"city":"青岛"}}' : '粘贴 a=1&b=2，或完整网址 https://example.com/list?page=1&tags[]=a…'),
  sample: (d) => [
    d === 'to'
      ? PRETTY('{"keyword":"快 JSON","page":1,"size":20,"tags":["json","工具"],"filter":{"city":"青岛","vip":true}}')
      : 'https://www.example.com/search?keyword=%E5%BF%AB+JSON&page=1&size=20&tags[]=json&tags[]=%E5%B7%A5%E5%85%B7&filter[city]=%E9%9D%92%E5%B2%9B&filter[vip]=true',
  ],
  run: async (c) => {
    const m = await import('../../core/convert');
    if (c.dir === 'to') {
      const text = m.jsonToQuery(json(c), { nest: str(c.o, 'nest') as 'bracket', arr: str(c.o, 'arr') as 'repeat', encode: bool(c.o, 'encode') });
      return { kind: 'text', text, note: `${text ? text.split('&').length : 0} 个参数` };
    }
    return out(c, m.queryToJson(c.src[0], { types: bool(c.o, 'types'), dots: bool(c.o, 'dots') }), '重复的参数已合并成数组');
  },
  ext: (d) => (d === 'to' ? 'txt' : 'json'),
};

const postman: ToolDef = {
  dirs: [['to', 'JSON → Postman'], ['from', 'Postman → JSON']],
  flip: { to: 'from', from: 'to' },
  opts: [
    { key: 'nest', label: '嵌套字段', type: 'select', options: [['json', '转成 JSON 字符串'], ['bracket', '展开为 a[b]'], ['dot', '展开为 a.b']], def: 'json', show: onDir('to') },
    { ...O_LOOSE, show: onDir('to') },
    { ...O_TYPES, show: onDir('from') },
    { key: 'pnest', label: '按 a[b] / a.b 还原嵌套', type: 'check', def: false, show: onDir('from') },
    { key: 'disabled', label: '包含禁用的行', type: 'check', def: false, title: 'Postman 里禁用的参数以 // 开头', show: onDir('from') },
    { ...O_INDENT, show: onDir('from') },
  ],
  jsonIn: (d) => d === 'to',
  inTitles: (d) => [d === 'to' ? '输入 JSON' : '输入 Postman 批量编辑内容'],
  outTitle: (d) => (d === 'to' ? 'Postman 批量编辑格式' : 'JSON'),
  placeholder: (d) => (d === 'to' ? '粘贴 JSON 对象…' : '粘贴 Postman Params / Headers / Body 的 Bulk Edit 内容，每行一个 key:value…'),
  sample: (d) => [
    d === 'to'
      ? PRETTY('{"username":"admin","password":"123456","remember":true,"profile":{"city":"青岛"}}')
      : 'username:admin\npassword:123456\nremember:true\n//debug:1\nredirect:https://example.com/home\n',
  ],
  help: '<p>在 Postman 的 Params、Headers、Body（form-data / x-www-form-urlencoded）里点 <b>Bulk Edit</b>，就能看到这种每行一个 <code>key:value</code> 的格式，可以直接复制粘贴。</p>',
  run: async (c) => {
    const m = await import('../../core/convert');
    if (c.dir === 'to') {
      const r = m.jsonToPostman(json(c), { nest: str(c.o, 'nest') as 'json' });
      return { kind: 'text', text: r.text, note: r.escaped ? `${r.escaped} 个值里的换行已写成 \\n` : '复制后在 Postman 里点 Bulk Edit 粘贴' };
    }
    const r = m.postmanToJson(c.src[0], { types: bool(c.o, 'types'), nest: bool(c.o, 'pnest'), disabled: bool(c.o, 'disabled') });
    return out(c, r.root, r.skipped ? `跳过了 ${r.skipped} 行禁用的参数` : '');
  },
  ext: (d) => (d === 'to' ? 'txt' : 'json'),
};

// ================= 测试数据生成 =================

const MOCK_SAMPLE = `{
  "code": 0,
  "data|5": [
    {
      "id|+1": 1001,
      "name": "@name",
      "age|18-60": 0,
      "gender|1": ["男", "女"],
      "phone": "@phone",
      "email": "@email",
      "city": "@city",
      "vip": "@bool",
      "score": "@float(60,100,1)",
      "tags|1-3": ["@cword(2,4)"],
      "createdAt": "@datetime",
      "avatar": "@image(100x100)",
      "remark": "用户 @id 的备注"
    }
  ]
}`;

const mock: ToolDef = {
  opts: [
    { key: 'fmt', label: '输出格式', type: 'select', options: [['json', 'JSON'], ['yaml', 'YAML'], ['xml', 'XML'], ['csv', 'CSV']], def: 'json' },
    { key: 'count', label: '重复生成', type: 'text', def: '1', width: 60, title: '把整个模板生成多份，结果是数组（最多 1000）' },
    { ...O_INDENT, show: (o) => str(o, 'fmt') === 'json' },
  ],
  inTitles: () => ['数据模板'],
  outTitle: () => '生成的数据',
  placeholder: () => '写一个 JSON 模板，例如 {"list|10":[{"id|+1":1,"name":"@name","phone":"@phone"}]}',
  sample: () => [MOCK_SAMPLE],
  ownInput: true,
  rerun: true,
  help:
    help([
      ['"list|5": [ {…} ]', '生成 5 个元素的数组；"list|2-8" 随机 2~8 个'],
      ['"tag|1": ["a","b","c"]', '从数组里随机选一个'],
      ['"age|18-60": 0', '18~60 之间的随机整数'],
      ['"id|+1": 1000', '从 1000 开始，每个元素加 1'],
      ['"用户@id"', '占位符可以嵌在文字里'],
    ], '模板就是普通 JSON：字段名后面加 <code>|规则</code>，字符串里写 <code>@占位符</code>。改了模板会自动重新生成，也可以点“重新生成”。') +
    '<p class="help-sub">可用的占位符：</p>' +
    help([
      ['@id', '自增编号 1、2、3…'], ['@int(1,100)', '随机整数'], ['@float(0,100,2)', '随机小数（最小、最大、小数位）'], ['@bool', 'true / false'],
      ['@pick(a,b,c)', '从列出的值里随机选一个'], ['@name / @ename', '中文 / 英文姓名'], ['@phone', '手机号'], ['@email / @url / @domain / @ip', '邮箱、网址、域名、IP'],
      ['@uuid', 'UUID'], ['@date / @time / @datetime', '日期、时间'], ['@timestamp / @now', '毫秒时间戳 / 当前时间'],
      ['@city / @province / @address / @zip', '城市、省份、地址、邮编'], ['@word / @sentence', '英文单词 / 句子'], ['@cword(2,4) / @csentence / @title', '中文词、句子、标题'],
      ['@string(16) / @color / @image(200x100)', '随机字符串、颜色、占位图地址'],
    ]),
  run: async (c) => {
    const { mockData } = await import('../../core/mock');
    const data = mockData(json(c), Number(str(c.o, 'count')) || 1);
    const f = str(c.o, 'fmt');
    if (f === 'yaml') return { kind: 'text', text: Core.toYAML(data) };
    if (f === 'xml') return { kind: 'text', text: Core.toXML(data) };
    if (f === 'csv') {
      const r = Core.toCSV(data);
      return { kind: 'text', text: r.text, note: `${r.rows} 行 × ${r.cols} 列` };
    }
    return out(c, data);
  },
  ext: (_d, o) => str(o, 'fmt') || 'json',
};

// ================= 汇总 =================

export const DEFS: Record<string, ToolDef> = {
  'json/format': format,
  'json/minify': minify,
  'json/viewer': viewer,
  'json/escape': escape,
  'json/yaml': yaml,
  'json/xml': xml,
  'json/csv': csv,
  'json/toml': toml,
  'json/toon': toon,
  'json/sort': sort,
  'json/clean': clean,
  'json/diff': diff,
  'json/merge': merge,
  'json/jsonpath': jsonpath,
  'json/schema': schema,
  'json/to-code': toCode,
  'json/sql': sql,
  'json/php': php,
  'json/query': query,
  'json/postman': postman,
  'json/mock': mock,
  'encode/unicode': unicode,
};
