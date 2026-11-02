// JSON 编辑器的可编辑树：和 JNode 互相转换，以及修改类型、增删节点
import type { InjectionKey } from 'vue';
import type { JNode } from '../../core/json';

export type ET = JNode['t'];

export interface ENode {
  id: number;
  t: ET;
  /** 在对象里的键名（数组元素和根节点不用） */
  key: string;
  /** 字符串的内容；数字的原始写法；布尔的 'true' / 'false' */
  val: string;
  kids: ENode[];
  open: boolean;
}

let seq = 0;
export const newId = (): number => ++seq;

export function fromJNode(nd: JNode, key = '', depth = 0): ENode {
  const e: ENode = { id: newId(), t: nd.t, key, val: '', kids: [], open: depth < 2 };
  if (nd.t === 'o') e.kids = nd.items.map(([k, v]) => fromJNode(v, k, depth + 1));
  else if (nd.t === 'a') e.kids = nd.items.map((v) => fromJNode(v, '', depth + 1));
  else if (nd.t === 's') e.val = nd.v;
  else if (nd.t === 'n') e.val = nd.raw;
  else if (nd.t === 'b') e.val = String(nd.v);
  return e;
}

export function toJNode(e: ENode): JNode {
  switch (e.t) {
    case 'o': return { t: 'o', items: e.kids.map((k) => [k.key, toJNode(k)] as [string, JNode]) };
    case 'a': return { t: 'a', items: e.kids.map(toJNode) };
    case 's': return { t: 's', v: e.val };
    case 'n': return { t: 'n', raw: e.val };
    case 'b': return { t: 'b', v: e.val === 'true' };
    case 'z': return { t: 'z' };
  }
}

export const NUM_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export const TYPE_LABEL: [ET, string][] = [['o', '对象'], ['a', '数组'], ['s', '字符串'], ['n', '数字'], ['b', '布尔'], ['z', 'null']];

/** 修改节点类型，尽量保留原来的内容 */
export function changeType(e: ENode, t: ET): void {
  if (e.t === t) return;
  const from = e.t;
  if (t === 'o') {
    e.kids = from === 'a' ? e.kids.map((k, i) => ({ ...k, key: String(i) })) : [];
    e.open = true;
  } else if (t === 'a') {
    e.kids = from === 'o' ? e.kids.map((k) => ({ ...k, key: '' })) : [];
    e.open = true;
  } else {
    e.kids = [];
    if (t === 's') e.val = from === 'n' || from === 'b' ? e.val : from === 'z' ? 'null' : '';
    else if (t === 'n') e.val = NUM_RE.test(e.val.trim()) ? e.val.trim() : '0';
    else if (t === 'b') e.val = e.val === 'true' || (from === 'n' && e.val !== '0') ? 'true' : 'false';
    else e.val = '';
  }
  e.t = t;
}

/** 给对象生成一个不重复的新键名 */
export function freshKey(parent: ENode): string {
  const keys = new Set(parent.kids.map((k) => k.key));
  if (!keys.has('newKey')) return 'newKey';
  for (let i = 2; ; i++) if (!keys.has('newKey' + i)) return 'newKey' + i;
}

export const blank = (key: string): ENode => ({ id: newId(), t: 's', key, val: '', kids: [], open: false });

export function clone(e: ENode): ENode {
  return { ...e, id: newId(), kids: e.kids.map(clone) };
}

export function setOpenAll(e: ENode, open: boolean, budget = { n: 5000 }): void {
  if (e.t !== 'o' && e.t !== 'a') return;
  if (open && budget.n-- <= 0) return;
  e.open = open;
  e.kids.forEach((k) => setOpenAll(k, open, budget));
}

export interface EditCtx {
  /** 树被修改后调用：重新生成左侧代码、记录撤销 */
  changed: () => void;
}
export const EDIT_CTX: InjectionKey<EditCtx> = Symbol('edit');

/** 一次最多渲染多少个子节点 */
export const EDIT_CHUNK = 500;
