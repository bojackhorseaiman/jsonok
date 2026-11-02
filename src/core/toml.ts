// JSON ⇄ TOML（解析和生成用 smol-toml）
import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';
import type { JNode } from './json.ts';
import { LocError, fromJS, isUnsafeInt } from './json.ts';

/** JNode → TOML 能接受的 JS 值；TOML 没有 null，遇到就跳过并计数 */
function toTomlJS(nd: JNode, dropped: { n: number }): unknown {
  switch (nd.t) {
    case 'o': {
      const o: Record<string, unknown> = {};
      for (const [k, v] of nd.items) {
        if (v.t === 'z') { dropped.n++; continue; }
        const x = toTomlJS(v, dropped);
        if (k === '__proto__') Object.defineProperty(o, k, { value: x, enumerable: true, writable: true, configurable: true });
        else o[k] = x;
      }
      return o;
    }
    case 'a': {
      const out: unknown[] = [];
      for (const v of nd.items) {
        if (v.t === 'z') { dropped.n++; continue; }
        out.push(toTomlJS(v, dropped));
      }
      return out;
    }
    case 'n': return isUnsafeInt(nd.raw) ? BigInt(nd.raw) : Number(nd.raw);
    case 's': return nd.v;
    case 'b': return nd.v;
    case 'z': return null;
  }
}

export function jsonToToml(root: JNode): { text: string; dropped: number } {
  if (root.t !== 'o') throw new Error('TOML 的最外层必须是对象 {…}，不能是数组或单个值');
  const dropped = { n: 0 };
  const obj = toTomlJS(root, dropped);
  const text = stringifyToml(obj);
  return { text: text.endsWith('\n') ? text : text + '\n', dropped: dropped.n };
}

export function tomlToJson(src: string): JNode {
  try {
    return fromJS(parseToml(src, { integersAsBigInt: 'asNeeded' }));
  } catch (e) {
    if (e instanceof TomlError) {
      const msg = e.message.split('\n')[0].replace(/^Invalid TOML document:\s*/, '');
      throw new LocError(`TOML 语法错误：${msg}`, e.line, e.column, 'TOML');
    }
    throw e;
  }
}
