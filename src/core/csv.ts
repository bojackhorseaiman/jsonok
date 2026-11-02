// CSV → JSON：标准 CSV（RFC 4180）解析，自动识别分隔符；支持 a.b 这样的列名还原成嵌套对象
import type { JNode, JObj } from './json.ts';
import { locError, parse } from './json.ts';
import { insertPath } from './convert.ts';

export type Delim = 'auto' | ',' | '\t' | ';' | '|';

export interface CsvOpt {
  delimiter: Delim;
  /** 第一行是表头 */
  header: boolean;
  /** 自动识别数字、布尔、空值，以及单元格里的 JSON */
  types: boolean;
  /** 列名 a.b 还原成嵌套对象 */
  nest: boolean;
}

export interface CsvJsonResult { root: JNode; rows: number; cols: number; delimiter: string }

/** 根据第一行（引号外）各分隔符出现的次数猜分隔符 */
export function detectDelimiter(src: string): string {
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0, '|': 0 };
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && (c === '\n' || c === '\r')) break;
    else if (!inQ && c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of ['\t', ';', '|']) if (counts[d] > counts[best]) best = d;
  return best;
}

export function parseCsv(src: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = src.length;
  let quoted = false;
  let cellStart = i;
  while (i < n) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === '' && i === cellStart) { quoted = true; i++; continue; }
    if (c === delimiter) { row.push(cell); cell = ''; i++; cellStart = i; continue; }
    if (c === '\r' || c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
      cellStart = i;
      continue;
    }
    cell += c;
    i++;
  }
  if (quoted) {
    // 找到这个没闭合的引号开始的位置，方便定位
    throw locError(src, Math.max(0, cellStart), '引号没有闭合：单元格以 " 开头，但没有找到结束的 "', 'CSV');
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // 去掉末尾的空行
  while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
  return rows;
}

function typed(s: string, types: boolean): JNode {
  if (!types) return { t: 's', v: s };
  const t = s.trim();
  if (t === '') return { t: 'z' };
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { t: 'n', raw: t };
  if (/^(true|false)$/i.test(t)) return { t: 'b', v: t.toLowerCase() === 'true' };
  if (t === 'null') return { t: 'z' };
  if (/^[[{]/.test(t)) {
    try {
      return parse(t).root;
    } catch {
      // 不是 JSON，按文本
    }
  }
  return { t: 's', v: s };
}

export function csvToJson(src: string, o: CsvOpt): CsvJsonResult {
  const delimiter = o.delimiter === 'auto' ? detectDelimiter(src) : o.delimiter;
  const rows = parseCsv(src, delimiter);
  if (!rows.length) return { root: { t: 'a', items: [] }, rows: 0, cols: 0, delimiter };
  if (!o.header) {
    const items = rows.map((r) => ({ t: 'a', items: r.map((c) => typed(c, o.types)) }) as JNode);
    return { root: { t: 'a', items }, rows: rows.length, cols: Math.max(...rows.map((r) => r.length)), delimiter };
  }
  const seen = new Map<string, number>();
  const heads = rows[0].map((h, i) => {
    const base = h.trim() || `column${i + 1}`;
    const c = seen.get(base) ?? 0;
    seen.set(base, c + 1);
    return c ? `${base}_${c + 1}` : base;
  });
  const items = rows.slice(1).map((r) => {
    const obj: JObj = { t: 'o', items: [] };
    heads.forEach((h, i) => {
      const v = typed(r[i] ?? '', o.types);
      if (o.nest && h.includes('.')) insertPath(obj, h.split('.'), v);
      else obj.items.push([h, v]);
    });
    return obj as JNode;
  });
  return { root: { t: 'a', items }, rows: items.length, cols: heads.length, delimiter };
}

/** 表格（Excel 读出来的二维数组）→ CSV 文本，交给 csvToJson 继续处理 */
export function tableToCsv(rows: unknown[][]): string {
  const cell = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().replace(/T00:00:00\.000Z$/, '') : String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}
