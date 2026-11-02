/**
 * JSON 核心库：自研解析器 + 各种格式转换。
 * 纯函数，不依赖浏览器，可以直接在 Node 里测试（tests/json.test.ts）。
 *
 * - 报错精确到行列，并用中文说明原因（中文标点、单引号、末尾逗号、不可见字符等）
 * - 数字保留原始文本，超长整数不丢精度；保留键的原始顺序；检测重复键
 * - 宽松模式：允许注释、单引号、末尾逗号、不带引号的键名
 */

export class JsonError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = 'JsonError';
    this.pos = pos;
  }
}

export interface JObj { t: 'o'; items: [string, JNode][] }
export interface JArr { t: 'a'; items: JNode[] }
export interface JStr { t: 's'; v: string }
export interface JNum { t: 'n'; raw: string }
export interface JBool { t: 'b'; v: boolean }
export interface JNull { t: 'z' }
export type JNode = JObj | JArr | JStr | JNum | JBool | JNull;

export interface DupKey { key: string; pos: number }
export interface ParseResult { root: JNode; warnings: DupKey[] }
export interface FmtOpt { indent?: string; sort?: boolean; ascii?: boolean }

export const TYPE_NAME: Record<JNode['t'], string> = {
  o: '对象', a: '数组', s: '字符串', n: '数字', b: '布尔值', z: 'null',
};

const PUNCT: Record<string, string> = {
  '\u201C': '使用了中文引号 “，请改成英文双引号 "',
  '\u201D': '使用了中文引号 ”，请改成英文双引号 "',
  '\u2018': '使用了中文引号 ‘，请改成英文双引号 "',
  '\u2019': '使用了中文引号 ’，请改成英文双引号 "',
  '\uFF0C': '使用了中文逗号 ，请改成英文逗号 ,',
  '\uFF1A': '使用了中文冒号 ：请改成英文冒号 :',
  '\u3010': '使用了中文括号 【，请改成 [',
  '\u3011': '使用了中文括号 】，请改成 ]',
  '\uFF5B': '使用了全角括号 ｛，请改成 {',
  '\uFF5D': '使用了全角括号 ｝，请改成 }',
  '\uFF3B': '使用了全角括号 ［，请改成 [',
  '\uFF3D': '使用了全角括号 ］，请改成 ]',
};
const INVISIBLE = /[\u00A0\u200B\u200C\u200D\u2060\u3000\uFEFF]/;
const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const PY_FIX: Record<string, string> = {
  True: 'true', False: 'false', None: 'null', undefined: 'null', NaN: 'null', Infinity: '数字或字符串',
};
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const hex4 = (c: number) => c.toString(16).toUpperCase().padStart(4, '0');

export function parse(src: string, loose = false): ParseResult {
  let i = 0;
  const n = src.length;
  const warnings: DupKey[] = [];

  function fail(msg: string, pos: number = i): never {
    throw new JsonError(msg, pos);
  }

  function unexpected(expect: string): never {
    const c = src[i];
    if (c === undefined) fail('内容意外结束，' + expect);
    if (hasOwn(PUNCT, c)) fail(PUNCT[c]);
    if (INVISIBLE.test(c)) fail(`这里有一个不可见字符 U+${hex4(c.charCodeAt(0))}（常见于从网页、微信、Word 复制），请删除它，或开启“宽松模式”`);
    if (c === "'" && !loose) fail('标准 JSON 不支持单引号，请改用双引号（或开启“宽松模式”）');
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) fail('标准 JSON 不支持注释（可开启“宽松模式”自动忽略）');
    fail(`意外的字符 ${JSON.stringify(c)}，${expect}`);
  }

  function ws(): void {
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || (c === '\uFEFF' && i === 0)) { i++; continue; }
      if (loose) {
        if (INVISIBLE.test(c)) { i++; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') {
          const j = src.indexOf('*/', i + 2);
          if (j < 0) fail('块注释 /* 没有结束的 */');
          i = j + 2;
          continue;
        }
      }
      break;
    }
  }

  function value(): JNode {
    ws();
    const c = src[i];
    if (c === '{') return obj();
    if (c === '[') return arr();
    if (c === '"' || (loose && c === "'")) return { t: 's', v: str() };
    if (c === '-' || (c >= '0' && c <= '9')) return num();
    if (src.startsWith('true', i)) { i += 4; return { t: 'b', v: true }; }
    if (src.startsWith('false', i)) { i += 5; return { t: 'b', v: false }; }
    if (src.startsWith('null', i)) { i += 4; return { t: 'z' }; }
    const py = /^(True|False|None|undefined|NaN|Infinity)\b/.exec(src.slice(i, i + 10));
    if (py) fail(`${py[1]} 不是合法的 JSON 值，应写作 ${PY_FIX[py[1]]}`);
    if (c === '}' || c === ']') fail(`此处应为一个值，却遇到了 ${c}（可能多了一个逗号）`);
    return unexpected('此处应为一个值（对象、数组、字符串、数字、true / false / null）');
  }

  function obj(): JNode {
    const open = i++;
    const items: [string, JNode][] = [];
    const seen = new Set<string>();
    ws();
    if (src[i] === '}') { i++; return { t: 'o', items }; }
    for (;;) {
      ws();
      const c = src[i];
      const keyPos = i;
      let key: string;
      if (c === '"' || (loose && c === "'")) key = str();
      else if (loose && c !== undefined && /[A-Za-z_$\u4e00-\u9fa5]/.test(c)) {
        while (i < n && /[\w$\u4e00-\u9fa5]/.test(src[i])) i++;
        key = src.slice(keyPos, i);
      } else if (c === undefined) return fail('这个 { 没有对应的结束括号 }', open);
      else if (/[A-Za-z_$]/.test(c)) return fail('键名必须用双引号包裹（或开启“宽松模式”）');
      else return unexpected('此处应为用双引号包裹的键名');

      if (seen.has(key)) warnings.push({ key, pos: keyPos });
      else seen.add(key);
      ws();
      if (src[i] !== ':') unexpected('键名后面应为冒号 :');
      i++;
      items.push([key, value()]);
      ws();
      const d = src[i];
      if (d === ',') {
        const comma = i++;
        ws();
        if (src[i] === '}') {
          if (loose) { i++; return { t: 'o', items }; }
          fail('最后一项后面多了一个逗号', comma);
        }
        continue;
      }
      if (d === '}') { i++; return { t: 'o', items }; }
      if (d === undefined) fail('这个 { 没有对应的结束括号 }', open);
      if (d === ']') fail('括号不匹配：对象应以 } 结束，这里却是 ]');
      if (d === '"') fail('缺少逗号 ,（上一项和这一项之间）');
      unexpected('此处应为逗号 , 或结束括号 }');
    }
  }

  function arr(): JNode {
    const open = i++;
    const items: JNode[] = [];
    ws();
    if (src[i] === ']') { i++; return { t: 'a', items }; }
    for (;;) {
      items.push(value());
      ws();
      const d = src[i];
      if (d === ',') {
        const comma = i++;
        ws();
        if (src[i] === ']') {
          if (loose) { i++; return { t: 'a', items }; }
          fail('最后一项后面多了一个逗号', comma);
        }
        continue;
      }
      if (d === ']') { i++; return { t: 'a', items }; }
      if (d === undefined) fail('这个 [ 没有对应的结束括号 ]', open);
      if (d === '}') fail('括号不匹配：数组应以 ] 结束，这里却是 }');
      if (/["\-\d[{tfn]/.test(d)) fail('缺少逗号 ,（上一项和这一项之间）');
      unexpected('此处应为逗号 , 或结束括号 ]');
    }
  }

  function str(): string {
    const q = src[i];
    const start = i++;
    let out = '';
    let run = i;
    for (;;) {
      if (i >= n) fail('字符串缺少结束引号', start);
      const c = src[i];
      if (c === q) { out += src.slice(run, i); i++; return out; }
      if (c === '\\') {
        out += src.slice(run, i);
        const e = src[i + 1];
        if (e === 'u') {
          const h = src.substr(i + 2, 4);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('无效的 Unicode 转义 \\u' + h);
          out += String.fromCharCode(parseInt(h, 16));
          i += 6;
        } else if (e !== undefined && hasOwn(ESC, e)) { out += ESC[e]; i += 2; }
        else if (loose && e === "'") { out += "'"; i += 2; }
        else fail('无效的转义字符 \\' + (e ?? ''));
        run = i;
        continue;
      }
      if (c < ' ') {
        fail(c === '\n' || c === '\r'
          ? '字符串里不能直接换行（请写成 \\n），或者这里少了结束引号'
          : '字符串里有未转义的控制字符（如 Tab），请写成 \\t 等转义形式');
      }
      i++;
    }
  }

  function num(): JNode {
    NUM.lastIndex = i;
    const m = NUM.exec(src);
    if (!m) return fail('无效的数字');
    i = NUM.lastIndex;
    if (/[\d.]/.test(src[i] ?? '')) fail('JSON 数字不能有前导 0，也不能以小数点结尾', m.index);
    return { t: 'n', raw: m[0] };
  }

  const root = value();
  ws();
  if (i < n) {
    fail(src[i] === ','
      ? '最外层只能有一个值，后面不能再用逗号接其他内容'
      : 'JSON 已经结束，后面还有多余内容（可能多了一个括号）');
  }
  return { root, warnings };
}

export function lineCol(src: string, pos: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let k = 0; k < pos && k < src.length; k++) {
    if (src.charCodeAt(k) === 10) { line++; last = k; }
  }
  return { line, col: pos - last };
}

// ---------------- 序列化 ----------------

const toAscii = (s: string) => s.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const qs = (s: string, ascii?: boolean) => (ascii ? toAscii(JSON.stringify(s)) : JSON.stringify(s));
const sortItems = (items: [string, JNode][]) => [...items].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

export const isBox = (nd: JNode): nd is JObj | JArr => nd.t === 'o' || nd.t === 'a';
export const childPath = (p: string, k: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(k) ? `${p}.${k}` : `${p}[${JSON.stringify(k)}]`;

function scalar(nd: JNode, ascii?: boolean): string {
  switch (nd.t) {
    case 's': return qs(nd.v, ascii);
    case 'n': return nd.raw;
    case 'b': return String(nd.v);
    case 'z': return 'null';
    case 'o': return '{}';
    case 'a': return '[]';
  }
}

export function stringify(node: JNode, opt: FmtOpt = {}): string {
  const ind = opt.indent ?? '  ';
  const nl = ind ? '\n' : '';
  const sep = ind ? ': ' : ':';
  const out: string[] = [];
  const w = (nd: JNode, lvl: number): void => {
    if (nd.t === 'o' && nd.items.length) {
      const it = opt.sort ? sortItems(nd.items) : nd.items;
      const pad = ind.repeat(lvl + 1);
      out.push('{' + nl);
      it.forEach(([k, v], idx) => {
        out.push(pad + qs(k, opt.ascii) + sep);
        w(v, lvl + 1);
        out.push((idx < it.length - 1 ? ',' : '') + nl);
      });
      out.push(ind.repeat(lvl) + '}');
      return;
    }
    if (nd.t === 'a' && nd.items.length) {
      const it = nd.items;
      const pad = ind.repeat(lvl + 1);
      out.push('[' + nl);
      it.forEach((v, idx) => {
        out.push(pad);
        w(v, lvl + 1);
        out.push((idx < it.length - 1 ? ',' : '') + nl);
      });
      out.push(ind.repeat(lvl) + ']');
      return;
    }
    out.push(scalar(nd, opt.ascii));
  };
  w(node, 0);
  return out.join('');
}

export function stats(node: JNode): { nodes: number; depth: number; bigNums: number } {
  let nodes = 0;
  let depth = 0;
  let bigNums = 0;
  const w = (nd: JNode, d: number): void => {
    nodes++;
    if (d > depth) depth = d;
    if (nd.t === 'o') nd.items.forEach((x) => w(x[1], d + 1));
    else if (nd.t === 'a') nd.items.forEach((x) => w(x, d + 1));
    else if (nd.t === 'n' && /^-?\d{16,}$/.test(nd.raw) && !Number.isSafeInteger(Number(nd.raw))) bigNums++;
  };
  w(node, 1);
  return { nodes, depth, bigNums };
}

// ---------------- YAML ----------------

function yStr(s: string): string {
  if (
    s === '' ||
    !/^[A-Za-z_\u4e00-\u9fa5][\w .\/\-@()\u4e00-\u9fa5]*$/.test(s) ||
    /\s$/.test(s) ||
    /^(true|false|yes|no|on|off|null|y|n)$/i.test(s)
  ) return JSON.stringify(s);
  return s;
}
const yScalar = (nd: JNode) => (nd.t === 's' ? yStr(nd.v) : scalar(nd));
const isLeaf = (nd: JNode) => !(isBox(nd) && nd.items.length);

export function toYAML(node: JNode, opt: { sort?: boolean } = {}): string {
  const w = (nd: JNode, lvl: number): string => {
    const pad = '  '.repeat(lvl);
    if (nd.t === 'o' && nd.items.length) {
      const it = opt.sort ? sortItems(nd.items) : nd.items;
      return it
        .map(([k, v]) => (isLeaf(v) ? `${pad}${yStr(k)}: ${yScalar(v)}` : `${pad}${yStr(k)}:\n${w(v, lvl + 1)}`))
        .join('\n');
    }
    if (nd.t === 'a' && nd.items.length) {
      return nd.items
        .map((v) => (isLeaf(v) ? `${pad}- ${yScalar(v)}` : `${pad}- ${w(v, lvl + 1).slice(pad.length + 2)}`))
        .join('\n');
    }
    return pad + yScalar(nd);
  };
  return w(node, 0) + '\n';
}

// ---------------- XML ----------------

const XML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => XML_ESC[c]);
function xmlName(k: string): string {
  let s = k.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  if (!/^[A-Za-z_\u4e00-\u9fa5]/.test(s)) s = '_' + s;
  return s;
}

export function toXML(node: JNode): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const w = (nd: JNode, tag: string, lvl: number): void => {
    const pad = '  '.repeat(lvl);
    if (nd.t === 'a') {
      if (!nd.items.length) lines.push(`${pad}<${tag}/>`);
      else nd.items.forEach((v) => w(v, tag, lvl));
      return;
    }
    if (nd.t === 'o') {
      if (!nd.items.length) { lines.push(`${pad}<${tag}/>`); return; }
      lines.push(`${pad}<${tag}>`);
      nd.items.forEach(([k, v]) => w(v, xmlName(k), lvl + 1));
      lines.push(`${pad}</${tag}>`);
      return;
    }
    if (nd.t === 'z') { lines.push(`${pad}<${tag}/>`); return; }
    const text = nd.t === 's' ? nd.v : nd.t === 'n' ? nd.raw : String(nd.v);
    lines.push(`${pad}<${tag}>${xmlEsc(text)}</${tag}>`);
  };
  if (node.t === 'o') w(node, 'root', 0);
  else {
    lines.push('<root>');
    (node.t === 'a' ? node.items : [node]).forEach((v) => w(v, 'item', 1));
    lines.push('</root>');
  }
  return lines.join('\n') + '\n';
}

// ---------------- CSV ----------------

export interface CsvResult { text: string; rows: number; cols: number; path: string }

/** 找到最适合当表格的数组：根是数组就用根；否则广度优先找第一个“元素是对象”的数组，比如 {"data":[...]} */
export function findTable(node: JNode): { rows: JNode[]; path: string } {
  if (node.t === 'a') return { rows: node.items, path: '' };
  if (node.t !== 'o') return { rows: [node], path: '' };
  const q: [JObj, string][] = [[node, '$']];
  while (q.length) {
    const [nd, p] = q.shift()!;
    for (const [k, v] of nd.items) {
      const cp = childPath(p, k);
      if (v.t === 'a' && v.items.some((x) => x.t === 'o')) return { rows: v.items, path: cp };
      if (v.t === 'o') q.push([v, cp]);
    }
  }
  return { rows: [node], path: '' };
}

const leafText = (nd: JNode) =>
  nd.t === 's' ? nd.v : nd.t === 'n' ? nd.raw : nd.t === 'b' ? String(nd.v) : nd.t === 'z' ? '' : stringify(nd, { indent: '' });

function flatten(nd: JNode, prefix: string, row: Map<string, string>): void {
  if (nd.t === 'o' && nd.items.length) nd.items.forEach(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k, row));
  else row.set(prefix || 'value', leafText(nd));
}

export function toCSV(node: JNode): CsvResult {
  const tb = findTable(node);
  const headers: string[] = [];
  const seen = new Set<string>();
  const data = tb.rows.map((r) => {
    const m = new Map<string, string>();
    flatten(r, '', m);
    for (const k of m.keys()) if (!seen.has(k)) { seen.add(k); headers.push(k); }
    return m;
  });
  const cell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const text = [headers.map(cell).join(','), ...data.map((m) => headers.map((h) => cell(m.get(h) ?? '')).join(','))].join('\r\n');
  return { text, rows: data.length, cols: headers.length, path: tb.path };
}

// ---------------- 文本类 ----------------

/** \u4e2d → 中。引号、反斜杠和控制字符保持转义，避免破坏 JSON 结构 */
export const unicodeToCn = (s: string): string =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h: string) => {
    const c = parseInt(h, 16);
    return c < 0x20 || c === 0x22 || c === 0x5c ? m : String.fromCharCode(c);
  });

export const cnToUnicode = (s: string): string => toAscii(s);

export const escapeStr = (s: string): string => JSON.stringify(s).slice(1, -1);

export function unescapeStr(s: string): string {
  const t = s.trim();
  try {
    return JSON.parse(/^"[\s\S]*"$/.test(t) ? t : `"${t}"`) as string;
  } catch {
    throw new Error('去转义失败：内容不是合法的转义字符串（检查是否有未转义的引号或换行）');
  }
}


// ---------------- 通用：带行列位置的错误、规范化、与 JS 值互转 ----------------

/** 非 JSON 格式（YAML / TOML / XML / CSV / TOON）的语法错误，带行列 */
export class LocError extends Error {
  line: number;
  col: number;
  label: string;
  constructor(message: string, line: number, col: number, label: string) {
    super(message);
    this.name = 'LocError';
    this.line = Math.max(1, line);
    this.col = Math.max(1, col);
    this.label = label;
  }
}

/** 字符位置 → LocError，方便各个解析器报错 */
export function locError(src: string, pos: number, message: string, label: string): LocError {
  const { line, col } = lineCol(src, pos);
  return new LocError(message, line, col, label);
}

/** 行列 → 字符位置（定位错误用） */
export function posOf(src: string, line: number, col: number): number {
  let pos = 0;
  for (let l = 1; l < line; l++) {
    const i = src.indexOf('\n', pos);
    if (i < 0) return src.length;
    pos = i + 1;
  }
  return Math.min(src.length, pos + Math.max(0, col - 1));
}

export const isIntRaw = (raw: string): boolean => /^-?\d+$/.test(raw);
export const isUnsafeInt = (raw: string): boolean => isIntRaw(raw) && !Number.isSafeInteger(Number(raw));

/** 数字的规范写法，用于比较：1.0 → 1，1e2 → 100，超长整数保持精确 */
export function normNum(raw: string): string {
  if (isIntRaw(raw)) return BigInt(raw).toString();
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

/** 规范化文本：键排序（数字可选规范化），用于判断两个值是否相等、去重 */
export function canonical(nd: JNode, numeric = true): string {
  switch (nd.t) {
    case 'o': return '{' + sortItems(nd.items).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v, numeric)).join(',') + '}';
    case 'a': return '[' + nd.items.map((v) => canonical(v, numeric)).join(',') + ']';
    case 'n': return numeric ? normNum(nd.raw) : nd.raw;
    default: return scalar(nd);
  }
}

/** 对象里某个键的值（有重复键时取最后一个，和 JSON.parse 一致） */
export function getKey(nd: JObj, key: string): JNode | undefined {
  for (let i = nd.items.length - 1; i >= 0; i--) if (nd.items[i][0] === key) return nd.items[i][1];
  return undefined;
}

function setProp(o: Record<string, unknown>, k: string, v: unknown): void {
  // "__proto__" 这样的键要按普通字段写入，不能改掉对象的原型
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}

/** JNode → 普通 JS 值。bigint=true 时超长整数转成 BigInt，不丢精度 */
export function toJS(nd: JNode, bigint = false): unknown {
  switch (nd.t) {
    case 'o': {
      const o: Record<string, unknown> = {};
      for (const [k, v] of nd.items) setProp(o, k, toJS(v, bigint));
      return o;
    }
    case 'a': return nd.items.map((v) => toJS(v, bigint));
    case 's': return nd.v;
    case 'b': return nd.v;
    case 'z': return null;
    case 'n': return bigint && isUnsafeInt(nd.raw) ? BigInt(nd.raw) : Number(nd.raw);
  }
}

/** fromJS 的统计：无法用 JSON 表示的值（NaN、Infinity、undefined 等）被转成了 null */
export interface FromJsInfo { lossy: number }

/** 普通 JS 值 → JNode。BigInt 保持精确，日期转成 ISO 字符串 */
export function fromJS(v: unknown, info: FromJsInfo = { lossy: 0 }): JNode {
  if (v === null) return { t: 'z' };
  switch (typeof v) {
    case 'string': return { t: 's', v };
    case 'boolean': return { t: 'b', v };
    case 'bigint': return { t: 'n', raw: v.toString() };
    case 'number':
      if (!Number.isFinite(v)) { info.lossy++; return { t: 'z' }; }
      return { t: 'n', raw: JSON.stringify(v) };
    case 'object': {
      if (v instanceof Date) return { t: 's', v: Number.isNaN(v.getTime()) ? String(v) : v.toISOString() };
      if (Array.isArray(v)) return { t: 'a', items: v.map((x) => fromJS(x, info)) };
      if (v instanceof Map) return { t: 'o', items: [...v].map(([k, x]) => [String(k), fromJS(x, info)] as [string, JNode]) };
      return { t: 'o', items: Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromJS(x, info)] as [string, JNode]) };
    }
    default:
      info.lossy++;
      return { t: 'z' };
  }
}

/** 统计超出安全范围的整数个数（用于提示“可能丢失精度”） */
export function countUnsafe(v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) && !Number.isSafeInteger(v) ? 1 : 0;
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + countUnsafe(x), 0);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).reduce((s: number, x) => s + countUnsafe(x), 0);
  return 0;
}
