// 文本编码：UTF-8 / GBK / UTF-16 / ISO-8859-1 和字节互转。
// 浏览器只能“解码” GBK，所以 GBK 编码表是第一次用到时，用解码器反推出来的（约 2 万个字符，几十毫秒）
import { utf8Bytes } from './bytes.ts';

export type Charset = 'utf-8' | 'gbk' | 'utf-16le' | 'utf-16be' | 'latin1';

export const CHARSET_OPTS: [Charset, string][] = [
  ['utf-8', 'UTF-8'],
  ['gbk', 'GBK'],
  ['utf-16le', 'UTF-16 LE'],
  ['utf-16be', 'UTF-16 BE'],
  ['latin1', 'ISO-8859-1'],
];

let gbkTable: Map<number, number> | null = null;

function gbk(): Map<number, number> {
  if (gbkTable) return gbkTable;
  const map = new Map<number, number>();
  const dec = new TextDecoder('gbk');
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const s = dec.decode(pair);
      if (s.length === 1 && s !== '\ufffd') {
        const cp = s.charCodeAt(0);
        if (!map.has(cp)) map.set(cp, (lead << 8) | trail);
      }
    }
  }
  map.set(0x20ac, 0x80); // €
  gbkTable = map;
  return map;
}

export interface Encoded { bytes: Uint8Array; /** 无法用这种编码表示、被替换成 ? 的字符数 */ lossy: number }

export function encodeText(s: string, cs: Charset): Encoded {
  if (cs === 'utf-8') return { bytes: utf8Bytes(s), lossy: 0 };
  const out: number[] = [];
  let lossy = 0;
  if (cs === 'utf-16le' || cs === 'utf-16be') {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (cs === 'utf-16le') out.push(c & 0xff, c >> 8);
      else out.push(c >> 8, c & 0xff);
    }
    return { bytes: Uint8Array.from(out), lossy };
  }
  const table = cs === 'gbk' ? gbk() : null;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cs === 'latin1') {
      if (cp <= 0xff) out.push(cp);
      else { out.push(0x3f); lossy++; }
    } else {
      const v = table!.get(cp);
      if (v === undefined) { out.push(0x3f); lossy++; }
      else if (v <= 0xff) out.push(v);
      else out.push(v >> 8, v & 0xff);
    }
  }
  return { bytes: Uint8Array.from(out), lossy };
}

/** 字节 → 文本。fatal=true 时遇到无效字节会报错（用于判断编码是否选对） */
export function decodeBytes(b: Uint8Array, cs: Charset, fatal = false): string {
  if (cs === 'latin1') {
    // 注意：浏览器里 "iso-8859-1" 实际按 windows-1252 解码，这里自己转，保证是真正的 ISO-8859-1
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return s;
  }
  return new TextDecoder(cs, { fatal }).decode(b);
}

export function charsetName(cs: Charset): string {
  return CHARSET_OPTS.find(([v]) => v === cs)?.[1] ?? cs;
}

/** 严格解码，失败时给出中文提示（例如 UTF-8 解不开，提示试试 GBK） */
export function decodeStrict(b: Uint8Array, cs: Charset): string {
  try {
    return decodeBytes(b, cs, true);
  } catch {
    let hint = '';
    if (cs === 'utf-8') {
      try {
        decodeBytes(b, 'gbk', true);
        hint = '，看起来像 GBK 编码，试试把“字符编码”改成 GBK';
      } catch {
        hint = '，可能是二进制数据，或者编码选错了';
      }
    }
    throw new Error(`这些字节不是有效的 ${charsetName(cs)} 文本${hint}`);
  }
}
