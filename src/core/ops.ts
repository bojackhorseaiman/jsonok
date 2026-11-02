// JSON 结构操作：排序、清理、对比、合并。纯函数，不修改输入
import type { JArr, JBool, JNode, JNum, JObj, JStr } from './json.ts';
import { canonical, childPath, getKey, isIntRaw, normNum } from './json.ts';

// ================= 排序 =================

export interface SortOpt {
  /** 对象按键名还是按值排序 */
  by: 'key' | 'value';
  desc: boolean;
  /** 递归排序所有层级 */
  deep: boolean;
  /** 数组元素也排序 */
  arrays: boolean;
  /** 对象数组按这个字段排序（为空时按整个元素排序） */
  arrayKey: string;
  /** 自然排序：item2 排在 item10 前面，中文按拼音 */
  natural: boolean;
}

const collator = new Intl.Collator('zh-CN', { numeric: true });
const RANK: Record<JNode['t'], number> = { z: 0, b: 1, n: 2, s: 3, a: 4, o: 5 };

function cmpStr(a: string, b: string, nat: boolean): number {
  if (nat) return collator.compare(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNum(a: string, b: string): number {
  if (isIntRaw(a) && isIntRaw(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

/** 比较两个值：不同类型按 null < 布尔 < 数字 < 字符串 < 数组 < 对象 */
export function cmpValue(a: JNode, b: JNode, nat = false): number {
  if (a.t !== b.t) return RANK[a.t] - RANK[b.t];
  switch (a.t) {
    case 'n': return cmpNum(a.raw, (b as JNum).raw);
    case 's': return cmpStr(a.v, (b as JStr).v, nat);
    case 'b': return Number(a.v) - Number((b as JBool).v);
    case 'z': return 0;
    default: return cmpStr(canonical(a), canonical(b), false);
  }
}

export function sortNode(nd: JNode, o: SortOpt): JNode {
  const sign = o.desc ? -1 : 1;
  const sub = (x: JNode) => (o.deep ? sortNode(x, o) : x);
  if (nd.t === 'o') {
    const items = nd.items.map(([k, v]) => [k, sub(v)] as [string, JNode]);
    if (o.by === 'key') items.sort((a, b) => sign * cmpStr(a[0], b[0], o.natural));
    else items.sort((a, b) => sign * cmpValue(a[1], b[1], o.natural) || cmpStr(a[0], b[0], o.natural));
    return { t: 'o', items };
  }
  if (nd.t === 'a') {
    const items = nd.items.map(sub);
    if (o.arrays) {
      const key = o.arrayKey.trim();
      const pick = (x: JNode): JNode | undefined => (key ? (x.t === 'o' ? getKey(x, key) : undefined) : x);
      items.sort((a, b) => {
        const x = pick(a);
        const y = pick(b);
        // 缺少排序字段的元素放到最后
        if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
        return sign * cmpValue(x, y, o.natural);
      });
    }
    return { t: 'a', items };
  }
  return nd;
}

// ================= 清理 =================

export interface CleanOpt {
  nulls: boolean;
  emptyStr: boolean;
  emptyArr: boolean;
  emptyObj: boolean;
  /** 去掉字符串首尾空白 */
  trim: boolean;
  /** 数组里的元素也清理（会改变下标） */
  arrays: boolean;
}

export interface CleanResult { node: JNode; removed: number; trimmed: number }

/** 自底向上清理：子节点清理后变空的数组 / 对象也会被删除 */
export function cleanNode(root: JNode, o: CleanOpt): CleanResult {
  let removed = 0;
  let trimmed = 0;
  const drop = (x: JNode): boolean =>
    (o.nulls && x.t === 'z') ||
    (o.emptyStr && x.t === 's' && x.v === '') ||
    (o.emptyArr && x.t === 'a' && !x.items.length) ||
    (o.emptyObj && x.t === 'o' && !x.items.length);
  const walk = (x: JNode): JNode => {
    if (x.t === 's') {
      if (!o.trim) return x;
      const v = x.v.trim();
      if (v === x.v) return x;
      trimmed++;
      return { t: 's', v };
    }
    if (x.t === 'o') {
      const items: [string, JNode][] = [];
      for (const [k, v] of x.items) {
        const c = walk(v);
        if (drop(c)) removed++;
        else items.push([k, c]);
      }
      return { t: 'o', items };
    }
    if (x.t === 'a') {
      const items: JNode[] = [];
      for (const v of x.items) {
        const c = walk(v);
        if (o.arrays && drop(c)) removed++;
        else items.push(c);
      }
      return { t: 'a', items };
    }
    return x;
  };
  return { node: walk(root), removed, trimmed };
}

// ================= 对比 =================

export type DiffKind = 'add' | 'del' | 'mod';
export interface DiffItem { kind: DiffKind; path: string; a?: JNode; b?: JNode }
export interface DiffOpt {
  /** 忽略数组元素的顺序（按内容匹配） */
  ignoreOrder: boolean;
  /** 数字按数值比较：1.0 和 1 视为相同 */
  numeric: boolean;
  maxItems?: number;
}
export interface DiffResult { items: DiffItem[]; truncated: boolean }

export function diffNodes(a: JNode, b: JNode, o: DiffOpt): DiffResult {
  const out: DiffItem[] = [];
  const max = o.maxItems ?? 5000;
  let truncated = false;
  const push = (d: DiffItem): void => {
    if (out.length < max) out.push(d);
    else truncated = true;
  };
  const same = (x: JNode, y: JNode): boolean => {
    if (x.t !== y.t) return false;
    switch (x.t) {
      case 'n': return o.numeric ? normNum(x.raw) === normNum((y as JNum).raw) : x.raw === (y as JNum).raw;
      case 's': return x.v === (y as JStr).v;
      case 'b': return x.v === (y as JBool).v;
      case 'z': return true;
      default: return canonical(x, o.numeric) === canonical(y, o.numeric);
    }
  };
  const walkObj = (x: JObj, y: JObj, p: string): void => {
    const am = new Map(x.items);
    const bm = new Map(y.items);
    for (const [k, v] of am) {
      const cp = childPath(p, k);
      const w = bm.get(k);
      if (w === undefined) push({ kind: 'del', path: cp, a: v });
      else walk(v, w, cp);
    }
    for (const [k, w] of bm) if (!am.has(k)) push({ kind: 'add', path: childPath(p, k), b: w });
  };
  const walkArr = (x: JArr, y: JArr, p: string): void => {
    if (o.ignoreOrder) {
      // 按内容匹配：两边相同的元素互相抵消，剩下的就是删除和新增
      const pool = new Map<string, number[]>();
      y.items.forEach((w, j) => {
        const c = canonical(w, o.numeric);
        const l = pool.get(c);
        if (l) l.push(j);
        else pool.set(c, [j]);
      });
      const matched = new Set<number>();
      x.items.forEach((v, i) => {
        const l = pool.get(canonical(v, o.numeric));
        if (l && l.length) matched.add(l.shift()!);
        else push({ kind: 'del', path: `${p}[${i}]`, a: v });
      });
      y.items.forEach((w, j) => {
        if (!matched.has(j)) push({ kind: 'add', path: `${p}[${j}]`, b: w });
      });
      return;
    }
    const n = Math.max(x.items.length, y.items.length);
    for (let i = 0; i < n; i++) {
      const cp = `${p}[${i}]`;
      if (i >= y.items.length) push({ kind: 'del', path: cp, a: x.items[i] });
      else if (i >= x.items.length) push({ kind: 'add', path: cp, b: y.items[i] });
      else walk(x.items[i], y.items[i], cp);
    }
  };
  const walk = (x: JNode, y: JNode, p: string): void => {
    if (truncated) return;
    if (x.t === 'o' && y.t === 'o') walkObj(x, y, p);
    else if (x.t === 'a' && y.t === 'a') walkArr(x, y, p);
    else if (!same(x, y)) push({ kind: 'mod', path: p, a: x, b: y });
  };
  walk(a, b, '$');
  return { items: out, truncated };
}

// ================= 合并 =================

export interface MergeOpt {
  /** 两边都是数组时：替换 / 拼接 / 拼接并去重 / 按下标逐个合并 */
  arrays: 'replace' | 'concat' | 'union' | 'index';
  /** 值冲突时以哪边为准 */
  prefer: 'a' | 'b';
  /** null 也算有效值，可以覆盖另一边 */
  nullOverride: boolean;
}
export interface MergeResult { node: JNode; conflicts: number; added: number }

/** 深度合并 A 和 B：对象按键递归合并，数组按选项处理，其余值冲突时按 prefer 取舍 */
export function mergeNodes(a: JNode, b: JNode, o: MergeOpt): MergeResult {
  let conflicts = 0;
  let added = 0;
  const m = (x: JNode, y: JNode): JNode => {
    if (x.t === 'o' && y.t === 'o') {
      const am = new Map(x.items);
      const bm = new Map(y.items);
      const items: [string, JNode][] = [];
      for (const [k, v] of am) {
        const w = bm.get(k);
        items.push([k, w === undefined ? v : m(v, w)]);
      }
      for (const [k, w] of bm) {
        if (!am.has(k)) {
          items.push([k, w]);
          added++;
        }
      }
      return { t: 'o', items };
    }
    if (x.t === 'a' && y.t === 'a' && o.arrays !== 'replace') {
      if (o.arrays === 'concat') return { t: 'a', items: [...x.items, ...y.items] };
      if (o.arrays === 'union') {
        const seen = new Set<string>();
        return {
          t: 'a',
          items: [...x.items, ...y.items].filter((v) => {
            const c = canonical(v);
            if (seen.has(c)) return false;
            seen.add(c);
            return true;
          }),
        };
      }
      const n = Math.max(x.items.length, y.items.length);
      const items: JNode[] = [];
      for (let i = 0; i < n; i++) {
        if (i < x.items.length && i < y.items.length) items.push(m(x.items[i], y.items[i]));
        else items.push(i < x.items.length ? x.items[i] : y.items[i]);
      }
      return { t: 'a', items };
    }
    if (canonical(x) === canonical(y)) return x;
    if (!o.nullOverride) {
      if (y.t === 'z') return x;
      if (x.t === 'z') return y;
    }
    conflicts++;
    return o.prefer === 'b' ? y : x;
  };
  return { node: m(a, b), conflicts, added };
}
