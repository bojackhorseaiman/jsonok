/**
 * JSONPath 查询（参考 RFC 9535）：
 *   $ 根  .key / ['key'] 字段  [0] [-1] 下标  [0:5:2] 切片  * 全部  .. 递归  [a,b] 多选
 *   [?(@.price < 10 && @.tag == 'x')] 过滤：== != < <= > >= =~ /正则/  && || !  ()  length()
 * 另外兼容常见写法：@.list.length（数组长度）、省略开头的 $。
 */
import type { JNode } from './json.ts';
import { canonical, childPath } from './json.ts';

export interface Hit { node: JNode; path: string }

type Sel =
  | { t: 'name'; name: string }
  | { t: 'wild' }
  | { t: 'index'; i: number }
  | { t: 'slice'; start?: number; end?: number; step?: number }
  | { t: 'filter'; expr: Expr };

interface Seg { desc: boolean; sels: Sel[] }

type Expr =
  | { t: 'lit'; v: JNode }
  | { t: 're'; re: RegExp }
  | { t: 'path'; root: '$' | '@'; segs: Seg[] }
  | { t: 'not'; e: Expr }
  | { t: 'and' | 'or'; a: Expr; b: Expr }
  | { t: 'cmp'; op: string; a: Expr; b: Expr }
  | { t: 'len'; arg: Expr };

export class PathError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = 'PathError';
    this.pos = pos;
  }
}

const NAME = /[A-Za-z_$\u0080-\uffff][\w$\-\u0080-\uffff]*/y;
const INT = /-?\d+/y;
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const OP = /==|!=|<=|>=|<|>|=~/y;

export function parsePath(input: string): Seg[] {
  const raw = input.trim();
  // 兼容省略 $ 的写法：store.book → $.store.book，[0] → $[0]
  const prefix = raw.startsWith('$') ? '' : raw.startsWith('[') || raw.startsWith('.') ? '$' : '$.';
  const s = prefix + raw;
  let i = 0;

  function fail(msg: string, at: number = i): never {
    throw new PathError(msg, Math.max(0, at - prefix.length));
  }
  function ws(): void {
    while (i < s.length && /\s/.test(s[i])) i++;
  }
  function match(re: RegExp): string | null {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return null;
    i = re.lastIndex;
    return m[0];
  }

  function segments(): Seg[] {
    const segs: Seg[] = [];
    for (;;) {
      if (s.startsWith('..', i)) {
        i += 2;
        segs.push({ desc: true, sels: s[i] === '[' ? bracket() : [dotSel()] });
      } else if (s[i] === '.') {
        i++;
        segs.push({ desc: false, sels: [dotSel()] });
      } else if (s[i] === '[') {
        segs.push({ desc: false, sels: bracket() });
      } else {
        return segs;
      }
    }
  }

  function dotSel(): Sel {
    if (s[i] === '*') {
      i++;
      return { t: 'wild' };
    }
    const name = match(NAME);
    if (name === null) return fail('点号后面应为字段名或 *');
    return { t: 'name', name };
  }

  function bracket(): Sel[] {
    const open = i++;
    const sels: Sel[] = [];
    for (;;) {
      ws();
      if (i >= s.length) return fail('方括号 [ 没有结束的 ]', open);
      sels.push(selector());
      ws();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ']') { i++; return sels; }
      return fail('这里应为逗号 , 或结束括号 ]');
    }
  }

  function selector(): Sel {
    const c = s[i];
    if (c === '*') { i++; return { t: 'wild' }; }
    if (c === "'" || c === '"') return { t: 'name', name: str() };
    if (c === '?') {
      i++;
      return { t: 'filter', expr: orExpr() };
    }
    const num = (): number | undefined => {
      const m = match(INT);
      return m === null ? undefined : Number(m);
    };
    const start = num();
    ws();
    if (s[i] === ':') {
      i++;
      ws();
      const end = num();
      ws();
      let step: number | undefined;
      if (s[i] === ':') {
        i++;
        ws();
        step = num();
        if (step === 0) fail('切片的步长不能为 0');
      }
      return { t: 'slice', start, end, step };
    }
    if (start === undefined) return fail("方括号里应为 'key'、下标、切片、* 或 ?() 过滤条件");
    return { t: 'index', i: start };
  }

  function str(): string {
    const q = s[i];
    const st = i++;
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const e = s[i + 1];
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        i += 2;
      } else {
        out += s[i++];
      }
    }
    if (i >= s.length) fail('字符串缺少结束引号', st);
    i++;
    return out;
  }

  function orExpr(): Expr {
    let a = andExpr();
    for (;;) {
      ws();
      if (!s.startsWith('||', i)) return a;
      i += 2;
      a = { t: 'or', a, b: andExpr() };
    }
  }
  function andExpr(): Expr {
    let a = notExpr();
    for (;;) {
      ws();
      if (!s.startsWith('&&', i)) return a;
      i += 2;
      a = { t: 'and', a, b: notExpr() };
    }
  }
  function notExpr(): Expr {
    ws();
    if (s[i] === '!' && s[i + 1] !== '=') {
      i++;
      return { t: 'not', e: notExpr() };
    }
    return cmpExpr();
  }
  function cmpExpr(): Expr {
    const a = primary();
    ws();
    const op = match(OP);
    if (op === null) return a;
    ws();
    return { t: 'cmp', op, a, b: primary() };
  }
  function primary(): Expr {
    ws();
    const c = s[i];
    if (c === '(') {
      const open = i++;
      const e = orExpr();
      ws();
      if (s[i] !== ')') fail('缺少右括号 )', open);
      i++;
      return e;
    }
    if (c === '@' || c === '$') {
      i++;
      return { t: 'path', root: c, segs: segments() };
    }
    if (c === "'" || c === '"') return { t: 'lit', v: { t: 's', v: str() } };
    if (c === '/') {
      const st = i++;
      let body = '';
      while (i < s.length && s[i] !== '/') {
        if (s[i] === '\\' && i + 1 < s.length) { body += s[i] + s[i + 1]; i += 2; }
        else body += s[i++];
      }
      if (i >= s.length) fail('正则表达式缺少结束的 /', st);
      i++;
      const flags = match(/[gimsuy]*/y) ?? '';
      try {
        return { t: 're', re: new RegExp(body, flags.replace('g', '')) };
      } catch {
        return fail('正则表达式无效', st);
      }
    }
    if (s.startsWith('length(', i)) {
      const open = i;
      i += 7;
      const arg = orExpr();
      ws();
      if (s[i] !== ')') fail('length( 缺少右括号 )', open);
      i++;
      return { t: 'len', arg };
    }
    const n = match(NUM);
    if (n !== null) return { t: 'lit', v: { t: 'n', raw: n } };
    for (const [w, v] of [['true', { t: 'b', v: true }], ['false', { t: 'b', v: false }], ['null', { t: 'z' }]] as [string, JNode][]) {
      if (s.startsWith(w, i)) {
        i += w.length;
        return { t: 'lit', v };
      }
    }
    return fail('过滤条件里应为 @.字段、字符串、数字、true / false / null');
  }

  ws();
  if (s[i] !== '$') fail('JSONPath 应以 $ 开头，例如 $.store.book[*].author');
  i++;
  const segs = segments();
  ws();
  if (i < s.length) fail(`无法识别的字符 ${JSON.stringify(s[i])}`);
  return segs;
}

// ================= 执行 =================

function children(h: Hit): Hit[] {
  const n = h.node;
  if (n.t === 'o') return n.items.map(([k, v]) => ({ node: v, path: childPath(h.path, k) }));
  if (n.t === 'a') return n.items.map((v, i) => ({ node: v, path: `${h.path}[${i}]` }));
  return [];
}

function descendants(h: Hit): Hit[] {
  const out: Hit[] = [];
  const stack: Hit[] = [h];
  while (stack.length) {
    const x = stack.pop()!;
    out.push(x);
    const c = children(x);
    for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
  }
  return out;
}

function applySel(h: Hit, sel: Sel, root: JNode, out: Hit[]): void {
  const n = h.node;
  switch (sel.t) {
    case 'name':
      if (n.t === 'o') {
        for (let i = n.items.length - 1; i >= 0; i--) {
          if (n.items[i][0] === sel.name) {
            out.push({ node: n.items[i][1], path: childPath(h.path, sel.name) });
            return;
          }
        }
      } else if (n.t === 'a' && sel.name === 'length') {
        // 兼容写法：数组的 .length
        out.push({ node: { t: 'n', raw: String(n.items.length) }, path: `${h.path}.length` });
      }
      return;
    case 'wild':
      out.push(...children(h));
      return;
    case 'index':
      if (n.t === 'a') {
        const i = sel.i < 0 ? n.items.length + sel.i : sel.i;
        if (i >= 0 && i < n.items.length) out.push({ node: n.items[i], path: `${h.path}[${i}]` });
      }
      return;
    case 'slice': {
      if (n.t !== 'a') return;
      const len = n.items.length;
      const step = sel.step ?? 1;
      const norm = (x: number) => (x < 0 ? Math.max(len + x, step > 0 ? 0 : -1) : Math.min(x, step > 0 ? len : len - 1));
      if (step > 0) {
        const st = norm(sel.start ?? 0);
        const en = norm(sel.end ?? len);
        for (let i = st; i < en; i += step) out.push({ node: n.items[i], path: `${h.path}[${i}]` });
      } else {
        const st = norm(sel.start ?? len - 1);
        const en = sel.end === undefined ? -1 : norm(sel.end);
        for (let i = st; i > en; i += step) out.push({ node: n.items[i], path: `${h.path}[${i}]` });
      }
      return;
    }
    case 'filter':
      for (const c of children(h)) if (truthy(ev(sel.expr, c, root))) out.push(c);
      return;
  }
}

function select(hits: Hit[], seg: Seg, root: JNode): Hit[] {
  const base = seg.desc ? hits.flatMap(descendants) : hits;
  const out: Hit[] = [];
  for (const h of base) for (const sel of seg.sels) applySel(h, sel, root, out);
  return out;
}

type Val = { k: 'nodes'; v: JNode[] } | { k: 'val'; v: JNode } | { k: 'bool'; v: boolean } | { k: 're'; v: RegExp };

function ev(e: Expr, cur: Hit, root: JNode): Val {
  switch (e.t) {
    case 'lit': return { k: 'val', v: e.v };
    case 're': return { k: 're', v: e.re };
    case 'path': {
      let hs: Hit[] = [e.root === '@' ? cur : { node: root, path: '$' }];
      for (const sg of e.segs) hs = select(hs, sg, root);
      return { k: 'nodes', v: hs.map((h) => h.node) };
    }
    case 'not': return { k: 'bool', v: !truthy(ev(e.e, cur, root)) };
    case 'and': return { k: 'bool', v: truthy(ev(e.a, cur, root)) && truthy(ev(e.b, cur, root)) };
    case 'or': return { k: 'bool', v: truthy(ev(e.a, cur, root)) || truthy(ev(e.b, cur, root)) };
    case 'len': {
      const x = single(ev(e.arg, cur, root));
      const n = !x ? -1 : x.t === 's' ? [...x.v].length : x.t === 'a' || x.t === 'o' ? x.items.length : -1;
      return n < 0 ? { k: 'nodes', v: [] } : { k: 'val', v: { t: 'n', raw: String(n) } };
    }
    case 'cmp': return { k: 'bool', v: compare(e.op, ev(e.a, cur, root), ev(e.b, cur, root)) };
  }
}

/** 条件为真：路径存在（至少匹配到一个节点），或布尔结果为真 */
function truthy(v: Val): boolean {
  if (v.k === 'nodes') return v.v.length > 0;
  if (v.k === 'bool') return v.v;
  if (v.k === 'val') return !(v.v.t === 'z' || (v.v.t === 'b' && !v.v.v));
  return true;
}

function single(v: Val): JNode | undefined {
  if (v.k === 'nodes') return v.v.length === 1 ? v.v[0] : undefined;
  if (v.k === 'val') return v.v;
  if (v.k === 'bool') return { t: 'b', v: v.v };
  return undefined;
}

function compare(op: string, A: Val, B: Val): boolean {
  if (op === '=~') {
    const x = single(A);
    if (!x || x.t !== 's') return false;
    let re: RegExp;
    if (B.k === 're') re = B.v;
    else {
      const y = single(B);
      if (!y || y.t !== 's') return false;
      try { re = new RegExp(y.v); } catch { return false; }
    }
    return re.test(x.v);
  }
  const x = single(A);
  const y = single(B);
  if (op === '==' || op === '!=') {
    const eq = x === undefined || y === undefined ? x === y : canonical(x) === canonical(y);
    return op === '==' ? eq : !eq;
  }
  if (!x || !y) return false;
  let c: number;
  if (x.t === 'n' && y.t === 'n') c = Number(x.raw) - Number(y.raw);
  else if (x.t === 's' && y.t === 's') c = x.v < y.v ? -1 : x.v > y.v ? 1 : 0;
  else return false;
  return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
}

/** 执行查询，返回匹配到的节点和路径 */
export function queryPath(root: JNode, expr: string): Hit[] {
  const segs = parsePath(expr);
  let hits: Hit[] = [{ node: root, path: '$' }];
  for (const seg of segs) hits = select(hits, seg, root);
  return hits;
}
