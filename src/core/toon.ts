// JSON ⇄ TOON（面向大模型的紧凑格式，https://toonformat.dev ，编解码用官方库）
import { DELIMITERS, ToonDecodeError, decode, encode, rawString } from '@toon-format/toon';
import type { JNode } from './json.ts';
import { LocError, countUnsafe, fromJS, isUnsafeInt, stringify } from './json.ts';

export interface ToonOpt {
  delimiter: 'comma' | 'tab' | 'pipe';
  indent: number;
}

// 超长整数先变成带标记的字符串，编码时再原样输出，避免丢精度或被加上引号
const MARK = '\u0000kj-num:';

function toToonJS(nd: JNode): unknown {
  switch (nd.t) {
    case 'o': {
      const o: Record<string, unknown> = {};
      for (const [k, v] of nd.items) {
        const x = toToonJS(v);
        if (k === '__proto__') Object.defineProperty(o, k, { value: x, enumerable: true, writable: true, configurable: true });
        else o[k] = x;
      }
      return o;
    }
    case 'a': return nd.items.map(toToonJS);
    case 'n': return isUnsafeInt(nd.raw) ? MARK + nd.raw : Number(nd.raw);
    case 's': return nd.v;
    case 'b': return nd.v;
    case 'z': return null;
  }
}

export interface ToonResult { text: string; jsonChars: number; toonChars: number }

export function jsonToToon(root: JNode, o: ToonOpt): ToonResult {
  const text = encode(toToonJS(root), {
    delimiter: DELIMITERS[o.delimiter],
    indentSize: o.indent,
    replacer: (_k, v) => (typeof v === 'string' && v.startsWith(MARK) ? rawString(v.slice(MARK.length)) : v),
  });
  return { text, jsonChars: stringify(root, { indent: '' }).length, toonChars: text.length };
}

export function toonToJson(src: string, strict: boolean): { root: JNode; lossy: number } {
  try {
    const v = decode(src, { strict });
    return { root: fromJS(v), lossy: countUnsafe(v) };
  } catch (e) {
    if (e instanceof ToonDecodeError) {
      const msg = e.message.replace(/^Line \d+:\s*/, '');
      throw new LocError(`TOON 格式错误：${msg}`, e.line ?? 1, 1, 'TOON');
    }
    throw e;
  }
}
