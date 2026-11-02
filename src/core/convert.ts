// 不依赖第三方库的格式转换：GET 参数、Postman 批量编辑格式、PHP 数组、SQL
import type { JNode, JObj } from './json.ts';
import { findTable, isIntRaw, parse, stringify } from './json.ts';

const compact = (nd: JNode) => stringify(nd, { indent: '' });
const scalarText = (nd: JNode): string =>
  nd.t === 's' ? nd.v : nd.t === 'n' ? nd.raw : nd.t === 'b' ? String(nd.v) : nd.t === 'z' ? '' : compact(nd);
const isScalar = (nd: JNode) => nd.t !== 'o' && nd.t !== 'a';

// ================= 键路径：a[b][0] / a.b / a[] =================

type KeySeg = string | null; // null 表示 []（追加到数组末尾）

/** 解析 user[name]、user.name、tags[]、list[0][id] 这样的键 */
export function parseKey(key: string, dots: boolean): KeySeg[] {
  const m = /^[^[.]*/.exec(key)!;
  const base = dots ? m[0] : /^[^[]*/.exec(key)![0];
  const segs: KeySeg[] = [base];
  let rest = key.slice(base.length);
  // 不是规范的嵌套写法（比如 a[b 少了 ]），就整个当作普通键
  while (rest) {
    let mm: RegExpExecArray | null;
    if ((mm = /^\[([^\]]*)\]/.exec(rest))) segs.push(mm[1] === '' ? null : mm[1]);
    else if (dots && (mm = /^\.([^[.]+)/.exec(rest))) segs.push(mm[1]);
    else return [key];
    rest = rest.slice(mm[0].length);
  }
  return segs;
}

/** 按键路径把值放进对象树；重复的键自动变成数组 */
export function insertPath(root: JObj, segs: KeySeg[], value: JNode): void {
  let cur: JNode = root;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const nextIsIndex = !last && (segs[i + 1] === null || /^\d+$/.test(segs[i + 1] as string));
    const fresh = (): JNode => (last ? value : nextIsIndex ? { t: 'a', items: [] } : { t: 'o', items: [] });
    if (cur.t === 'a') {
      const idx: number = seg === null ? cur.items.length : Number(seg);
      if (seg !== null && !/^\d+$/.test(seg)) {
        // 数组里出现了字段名：把数组转成以下标为键的对象
        const obj: JObj = { t: 'o', items: cur.items.map((v, j) => [String(j), v] as [string, JNode]) };
        cur.items.length = 0;
        Object.assign(cur, obj);
        i--;
        continue;
      }
      if (idx < cur.items.length && !last) cur = cur.items[idx];
      else {
        const nv = fresh();
        if (idx < cur.items.length) cur.items[idx] = nv;
        else cur.items.push(nv);
        cur = nv;
      }
      continue;
    }
    if (cur.t !== 'o') return;
    const key = seg ?? '';
    const pos = cur.items.findIndex(([k]) => k === key);
    if (pos < 0) {
      const nv = fresh();
      cur.items.push([key, nv]);
      cur = nv;
    } else if (last) {
      // 重复的键：a=1&a=2 → a: [1, 2]
      const ex = cur.items[pos][1];
      if (ex.t === 'a') ex.items.push(value);
      else cur.items[pos][1] = { t: 'a', items: [ex, value] };
    } else {
      cur = cur.items[pos][1];
    }
  }
}

const NUM_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** 文本 → 值：开启 types 时自动识别数字、布尔、null，以及 JSON 数组 / 对象 */
function typed(text: string, types: boolean, json = false): JNode {
  if (!types) return { t: 's', v: text };
  if (NUM_TEXT.test(text)) return { t: 'n', raw: text };
  if (text === 'true' || text === 'false') return { t: 'b', v: text === 'true' };
  if (text === 'null') return { t: 'z' };
  if (json && /^[[{]/.test(text.trim())) {
    try {
      return parse(text).root;
    } catch {
      // 不是合法 JSON，按字符串处理
    }
  }
  return { t: 's', v: text };
}

// ================= GET 参数 =================

export interface QueryOpt {
  /** 嵌套对象的写法 */
  nest: 'bracket' | 'dot' | 'json';
  /** 数组的写法 */
  arr: 'repeat' | 'bracket' | 'index' | 'comma';
  /** URL 编码 */
  encode: boolean;
}

export function jsonToQuery(root: JNode, o: QueryOpt): string {
  if (root.t !== 'o') throw new Error('转成 GET 参数需要输入对象，例如 {"page":1,"size":20}');
  const pairs: [string, string][] = [];
  const enc = (s: string) => (o.encode ? encodeURIComponent(s) : s);
  const child = (base: string, k: string) => (o.nest === 'dot' ? `${base}.${enc(k)}` : `${base}[${enc(k)}]`);
  const walk = (key: string, v: JNode): void => {
    if (isScalar(v)) { pairs.push([key, enc(scalarText(v))]); return; }
    const flatArr = v.t === 'a' && v.items.every(isScalar);
    // 对象（以及含对象的数组）在 JSON 字符串模式下整体转成 JSON；简单数组仍按“数组”选项处理
    if (o.nest === 'json' && !flatArr) { pairs.push([key, enc(compact(v))]); return; }
    if (v.t === 'o') {
      if (!v.items.length) pairs.push([key, '']);
      for (const [k, x] of v.items) walk(child(key, k), x);
      return;
    }
    const arr = v as { t: 'a'; items: JNode[] };
    const flat = arr.items.every(isScalar);
    if (flat && o.arr === 'comma') { pairs.push([key, arr.items.map((x) => enc(scalarText(x))).join(',')]); return; }
    arr.items.forEach((x, i) => {
      if (flat && o.arr === 'repeat') walk(key, x);
      else if (flat && o.arr === 'bracket') walk(`${key}[]`, x);
      else walk(`${key}[${i}]`, x);
    });
  };
  for (const [k, v] of root.items) walk(enc(k), v);
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export interface QueryInOpt {
  /** 自动识别数字、布尔 */
  types: boolean;
  /** a.b=1 也当作嵌套 */
  dots: boolean;
}

export function queryToJson(src: string, o: QueryInOpt): JNode {
  let s = src.trim();
  const qm = s.indexOf('?');
  if (qm >= 0) s = s.slice(qm + 1);
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(0, hash);
  const dec = (x: string) => {
    try {
      return decodeURIComponent(x.replace(/\+/g, ' '));
    } catch {
      return x;
    }
  };
  const root: JObj = { t: 'o', items: [] };
  for (const part of s.split(/&|\r?\n/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    const k = dec(eq < 0 ? part : part.slice(0, eq)).trim();
    const v = eq < 0 ? '' : dec(part.slice(eq + 1));
    if (!k) continue;
    insertPath(root, parseKey(k, o.dots), typed(v, o.types));
  }
  return root;
}

// ================= Postman 批量编辑（key:value 每行一个） =================

export interface PostmanOutOpt { nest: 'json' | 'bracket' | 'dot' }

export function jsonToPostman(root: JNode, o: PostmanOutOpt): { text: string; escaped: number } {
  if (root.t !== 'o') throw new Error('需要输入对象，例如 {"username":"admin","password":"123456"}');
  const lines: string[] = [];
  let escaped = 0;
  const val = (s: string) => {
    if (/[\r\n]/.test(s)) escaped++;
    return s.replace(/\r?\n/g, '\\n');
  };
  const walk = (key: string, v: JNode): void => {
    if (isScalar(v) || o.nest === 'json') { lines.push(`${key}:${val(scalarText(v))}`); return; }
    const entries: [string, JNode][] = v.t === 'o' ? v.items : (v as { items: JNode[] }).items.map((x, i) => [String(i), x] as [string, JNode]);
    if (!entries.length) lines.push(`${key}:`);
    for (const [k, x] of entries) walk(o.nest === 'dot' && v.t === 'o' ? `${key}.${k}` : `${key}[${k}]`, x);
  };
  for (const [k, v] of root.items) walk(k, v);
  return { text: lines.join('\n'), escaped };
}

export interface PostmanInOpt {
  types: boolean;
  /** 按 a[b] / a.b 还原成嵌套对象 */
  nest: boolean;
  /** 包含被禁用（// 开头）的行 */
  disabled: boolean;
}

export function postmanToJson(src: string, o: PostmanInOpt): { root: JNode; skipped: number } {
  const root: JObj = { t: 'o', items: [] };
  let skipped = 0;
  for (const raw of src.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//')) {
      if (!o.disabled) { skipped++; continue; }
      line = line.slice(2).trim();
    }
    const c = line.indexOf(':');
    const k = (c < 0 ? line : line.slice(0, c)).trim();
    const v = c < 0 ? '' : line.slice(c + 1).trim();
    if (!k) continue;
    insertPath(root, o.nest ? parseKey(k, true) : [k], typed(v, o.types, true));
  }
  return { root, skipped };
}

// ================= PHP 数组 =================

export interface PhpOpt { short: boolean; varName: string }

const phpStr = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

export function jsonToPhp(root: JNode, o: PhpOpt): string {
  const [open, close] = o.short ? ['[', ']'] : ['array(', ')'];
  const w = (nd: JNode, lvl: number): string => {
    const pad = '    '.repeat(lvl + 1);
    const end = '    '.repeat(lvl);
    if (nd.t === 'o') {
      if (!nd.items.length) return open + close;
      return `${open}\n${nd.items.map(([k, v]) => `${pad}${phpStr(k)} => ${w(v, lvl + 1)},`).join('\n')}\n${end}${close}`;
    }
    if (nd.t === 'a') {
      if (!nd.items.length) return open + close;
      return `${open}\n${nd.items.map((v) => `${pad}${w(v, lvl + 1)},`).join('\n')}\n${end}${close}`;
    }
    if (nd.t === 's') return phpStr(nd.v);
    if (nd.t === 'z') return 'null';
    if (nd.t === 'b') return String(nd.v);
    return nd.raw;
  };
  const name = (o.varName.trim().replace(/^\$/, '') || 'data').replace(/[^\w\u0080-\uffff]/g, '_');
  return `<?php\n\n$${name} = ${w(root, 0)};\n`;
}

// ================= SQL =================

export type Dialect = 'mysql' | 'postgres' | 'sqlite' | 'sqlserver' | 'oracle';

export interface SqlOpt {
  table: string;
  dialect: Dialect;
  /** 生成建表语句 */
  create: boolean;
  /** 多行合并成一条 INSERT */
  batch: boolean;
}

export interface SqlResult { text: string; rows: number; cols: number; table: string; path: string }

type ColKind = 'null' | 'bool' | 'int' | 'big' | 'huge' | 'float' | 'date' | 'datetime' | 'string' | 'json' | 'mixed';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function valueKind(v: JNode): ColKind {
  switch (v.t) {
    case 'z': return 'null';
    case 'b': return 'bool';
    case 'n': {
      if (!isIntRaw(v.raw)) return 'float';
      const x = BigInt(v.raw) < 0n ? -BigInt(v.raw) : BigInt(v.raw);
      return x <= 2147483647n ? 'int' : x <= 9223372036854775807n ? 'big' : 'huge';
    }
    case 's': return DATETIME.test(v.v) ? 'datetime' : DATE.test(v.v) ? 'date' : 'string';
    default: return 'json';
  }
}

function mergeKind(a: ColKind, b: ColKind): ColKind {
  if (a === b || b === 'null') return a;
  if (a === 'null') return b;
  const nums: ColKind[] = ['int', 'big', 'huge'];
  if (nums.includes(a) && nums.includes(b)) return nums[Math.max(nums.indexOf(a), nums.indexOf(b))];
  if ([...nums, 'float'].includes(a) && [...nums, 'float'].includes(b)) return 'float';
  if (['date', 'datetime', 'string'].includes(a) && ['date', 'datetime', 'string'].includes(b)) return 'string';
  return 'mixed';
}

const TYPES: Record<Dialect, Record<Exclude<ColKind, 'string' | 'null' | 'mixed'>, string> & { text: string; varchar: (n: number) => string; maxVarchar: number }> = {
  mysql: { bool: 'TINYINT(1)', int: 'INT', big: 'BIGINT', huge: 'DECIMAL(65,0)', float: 'DOUBLE', date: 'DATE', datetime: 'DATETIME', json: 'JSON', text: 'TEXT', varchar: (n) => `VARCHAR(${n})`, maxVarchar: 2000 },
  postgres: { bool: 'BOOLEAN', int: 'INTEGER', big: 'BIGINT', huge: 'NUMERIC', float: 'DOUBLE PRECISION', date: 'DATE', datetime: 'TIMESTAMP', json: 'JSONB', text: 'TEXT', varchar: (n) => `VARCHAR(${n})`, maxVarchar: 2000 },
  sqlite: { bool: 'INTEGER', int: 'INTEGER', big: 'INTEGER', huge: 'NUMERIC', float: 'REAL', date: 'TEXT', datetime: 'TEXT', json: 'TEXT', text: 'TEXT', varchar: () => 'TEXT', maxVarchar: Infinity },
  sqlserver: { bool: 'BIT', int: 'INT', big: 'BIGINT', huge: 'DECIMAL(38,0)', float: 'FLOAT', date: 'DATE', datetime: 'DATETIME2', json: 'NVARCHAR(MAX)', text: 'NVARCHAR(MAX)', varchar: (n) => `NVARCHAR(${n})`, maxVarchar: 4000 },
  oracle: { bool: 'NUMBER(1)', int: 'NUMBER(10)', big: 'NUMBER(19)', huge: 'NUMBER(38)', float: 'NUMBER', date: 'DATE', datetime: 'TIMESTAMP', json: 'CLOB', text: 'CLOB', varchar: (n) => `VARCHAR2(${n} CHAR)`, maxVarchar: 4000 },
};

const quoteId = (d: Dialect, s: string) =>
  d === 'mysql' ? '`' + s.replace(/`/g, '``') + '`' : d === 'sqlserver' ? '[' + s.replace(/]/g, ']]') + ']' : '"' + s.replace(/"/g, '""') + '"';

function sqlLiteral(v: JNode | undefined, d: Dialect, kind: ColKind): string {
  if (!v || v.t === 'z') return 'NULL';
  if (v.t === 'b') return d === 'sqlserver' || d === 'oracle' || d === 'sqlite' || d === 'mysql' ? (v.v ? '1' : '0') : v.v ? 'TRUE' : 'FALSE';
  if (v.t === 'n' && kind !== 'string' && kind !== 'mixed') return v.raw;
  const text = v.t === 's' ? v.v : v.t === 'n' ? v.raw : compact(v);
  let s = text.replace(/'/g, "''");
  if (d === 'mysql') s = s.replace(/\\/g, '\\\\');
  if (d === 'oracle' && (kind === 'date' || kind === 'datetime')) {
    return kind === 'date' ? `DATE '${s}'` : `TIMESTAMP '${s}'`;
  }
  return (d === 'sqlserver' ? 'N' : '') + `'${s}'`;
}

export function jsonToSql(root: JNode, o: SqlOpt): SqlResult {
  const tb = findTable(root);
  const rows = tb.rows;
  if (!rows.length) throw new Error('没有找到可以转换的数据：请输入对象数组，例如 [{"id":1,"name":"张三"}]');
  const objRows: JObj[] = rows.map((r) => (r.t === 'o' ? r : { t: 'o', items: [['value', r]] }));
  const cols: string[] = [];
  const kinds = new Map<string, ColKind>();
  const maxLen = new Map<string, number>();
  const present = new Map<string, number>();
  for (const r of objRows) {
    const seen = new Set<string>();
    for (const [k, v] of r.items) {
      if (!kinds.has(k)) { cols.push(k); kinds.set(k, 'null'); }
      kinds.set(k, mergeKind(kinds.get(k)!, valueKind(v)));
      const len = [...scalarText(v)].length;
      maxLen.set(k, Math.max(maxLen.get(k) ?? 0, len));
      if (v.t !== 'z' && !seen.has(k)) { present.set(k, (present.get(k) ?? 0) + 1); seen.add(k); }
    }
  }
  const d = o.dialect;
  const T = TYPES[d];
  const tableName = o.table.trim() || (tb.path ? tb.path.replace(/^.*[.[\]"]+/, '').replace(/["\]]/g, '') : '') || 'my_table';
  const table = tableName.split('.').map((p) => quoteId(d, p)).join('.');
  const colType = (k: string): string => {
    const kind = kinds.get(k)!;
    if (kind === 'string' || kind === 'mixed' || kind === 'null') {
      const n = kind === 'null' ? 255 : maxLen.get(k)!;
      if (n > T.maxVarchar) return T.text;
      const size = [32, 64, 128, 255, 512, 1024, 2000, 4000].find((x) => x >= n) ?? 4000;
      return T.varchar(size);
    }
    return T[kind];
  };
  const get = (r: JObj, k: string): JNode | undefined => {
    for (let i = r.items.length - 1; i >= 0; i--) if (r.items[i][0] === k) return r.items[i][1];
    return undefined;
  };
  const out: string[] = [];
  if (o.create) {
    const idOk = cols.includes('id') && ['int', 'big'].includes(kinds.get('id')!) &&
      present.get('id') === objRows.length && new Set(objRows.map((r) => get(r, 'id') && scalarText(get(r, 'id')!))).size === objRows.length;
    const defs = cols.map((k) => {
      const notNull = present.get(k) === objRows.length;
      return `  ${quoteId(d, k)} ${colType(k)}${k === 'id' && idOk ? ' PRIMARY KEY' : notNull ? ' NOT NULL' : ''}`;
    });
    out.push(`CREATE TABLE ${table} (\n${defs.join(',\n')}\n);`);
  }
  const colList = cols.map((k) => quoteId(d, k)).join(', ');
  const tuple = (r: JObj) => `(${cols.map((k) => sqlLiteral(get(r, k), d, kinds.get(k)!)).join(', ')})`;
  if (o.batch && d !== 'oracle') {
    for (let i = 0; i < objRows.length; i += 500) {
      const chunk = objRows.slice(i, i + 500);
      out.push(`INSERT INTO ${table} (${colList}) VALUES\n${chunk.map((r) => '  ' + tuple(r)).join(',\n')};`);
    }
  } else {
    out.push(objRows.map((r) => `INSERT INTO ${table} (${colList}) VALUES ${tuple(r)};`).join('\n'));
  }
  return { text: out.join('\n\n') + '\n', rows: objRows.length, cols: cols.length, table: tableName, path: tb.path };
}
