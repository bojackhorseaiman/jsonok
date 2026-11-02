// Base32 / Base58 / Base62 / Base85（Ascii85）/ Base100（emoji）编解码

export type BaseKind = 'base32' | 'base58' | 'base62' | 'base85' | 'base100';

export const BASE_OPTS: [BaseKind, string][] = [
  ['base32', 'Base32'],
  ['base58', 'Base58（比特币）'],
  ['base62', 'Base62'],
  ['base85', 'Base85（Ascii85）'],
  ['base100', 'Base100（emoji）'],
];

// ================= Base32（RFC 4648） =================

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(b: Uint8Array, pad = true): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const x of b) {
    value = (value << 8) | x;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  if (pad) while (out.length % 8) out += '=';
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const t = s.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < t.length; i++) {
    const v = B32.indexOf(t[i]);
    if (v < 0) throw new Error(`不是有效的 Base32：第 ${i + 1} 个字符 ${JSON.stringify(t[i])} 不在 A-Z、2-7 里`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

// ================= Base58 / Base62（大数进制转换） =================

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function baseXEncode(src: Uint8Array, alpha: string): string {
  if (!src.length) return '';
  const base = alpha.length;
  let zeros = 0;
  while (zeros < src.length && src[zeros] === 0) zeros++;
  const size = Math.ceil(((src.length - zeros) * Math.log(256)) / Math.log(base)) + 1;
  const digits = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < src.length; i++) {
    let carry = src[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * digits[k];
      digits[k] = carry % base;
      carry = Math.floor(carry / base);
    }
    length = j;
  }
  let it = size - length;
  while (it < size && digits[it] === 0) it++;
  let out = alpha[0].repeat(zeros);
  for (; it < size; it++) out += alpha[digits[it]];
  return out;
}

function baseXDecode(input: string, alpha: string, label: string): Uint8Array {
  const s = input.replace(/\s+/g, '');
  if (!s) return new Uint8Array(0);
  const base = alpha.length;
  let zeros = 0;
  while (zeros < s.length && s[zeros] === alpha[0]) zeros++;
  const size = Math.floor(((s.length - zeros) * Math.log(base)) / Math.log(256)) + 1;
  const bytes = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < s.length; i++) {
    const v = alpha.indexOf(s[i]);
    if (v < 0) throw new Error(`不是有效的 ${label}：第 ${i + 1} 个字符 ${JSON.stringify(s[i])} 不在字母表里`);
    let carry = v;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += base * bytes[k];
      bytes[k] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = j;
  }
  let it = size - length;
  while (it < size && bytes[it] === 0) it++;
  const out = new Uint8Array(zeros + (size - it));
  out.set(bytes.subarray(it), zeros);
  return out;
}

// ================= Base85（Ascii85） =================

export function base85Encode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 4) {
    const n = Math.min(4, b.length - i);
    let v = 0;
    for (let j = 0; j < 4; j++) v = v * 256 + (j < n ? b[i + j] : 0);
    if (v === 0 && n === 4) {
      out += 'z';
      continue;
    }
    const chars = new Array<string>(5);
    for (let j = 4; j >= 0; j--) {
      chars[j] = String.fromCharCode((v % 85) + 33);
      v = Math.floor(v / 85);
    }
    out += chars.slice(0, n + 1).join('');
  }
  return out;
}

export function base85Decode(input: string): Uint8Array {
  let s = input.replace(/\s+/g, '');
  if (s.startsWith('<~')) s = s.slice(2);
  if (s.endsWith('~>')) s = s.slice(0, -2);
  const out: number[] = [];
  let group: number[] = [];
  const flush = (g: number[], final: boolean): void => {
    const n = g.length;
    while (g.length < 5) g.push(84);
    let v = 0;
    for (const c of g) v = v * 85 + c;
    if (v > 0xffffffff) throw new Error('不是有效的 Base85：有一组字符的值超出范围');
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...(final ? bytes.slice(0, n - 1) : bytes));
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'z') {
      if (group.length) throw new Error(`不是有效的 Base85：第 ${i + 1} 个字符 z 只能出现在一组的开头`);
      out.push(0, 0, 0, 0);
      continue;
    }
    const v = c.charCodeAt(0) - 33;
    if (v < 0 || v > 84) throw new Error(`不是有效的 Base85：第 ${i + 1} 个字符 ${JSON.stringify(c)} 不在 ! 到 u 的范围内`);
    group.push(v);
    if (group.length === 5) {
      flush(group, false);
      group = [];
    }
  }
  if (group.length === 1) throw new Error('不是有效的 Base85：最后一组只有 1 个字符');
  if (group.length) flush(group, true);
  return Uint8Array.from(out);
}

// ================= Base100（每个字节对应一个 emoji） =================

const B100 = 0x1f3f7;

export function base100Encode(b: Uint8Array): string {
  let out = '';
  for (const x of b) out += String.fromCodePoint(B100 + x);
  return out;
}

export function base100Decode(s: string): Uint8Array {
  const out: number[] = [];
  let i = 0;
  for (const ch of s) {
    i++;
    if (/\s/.test(ch)) continue;
    const v = ch.codePointAt(0)! - B100;
    if (v < 0 || v > 255) throw new Error(`不是有效的 Base100：第 ${i} 个字符 ${JSON.stringify(ch)} 不是 Base100 使用的 emoji`);
    out.push(v);
  }
  return Uint8Array.from(out);
}

// ================= 统一入口 =================

export function baseEncode(kind: BaseKind, b: Uint8Array): string {
  switch (kind) {
    case 'base32': return base32Encode(b);
    case 'base58': return baseXEncode(b, B58);
    case 'base62': return baseXEncode(b, B62);
    case 'base85': return base85Encode(b);
    case 'base100': return base100Encode(b);
  }
}

export function baseDecode(kind: BaseKind, s: string): Uint8Array {
  switch (kind) {
    case 'base32': return base32Decode(s);
    case 'base58': return baseXDecode(s, B58, 'Base58');
    case 'base62': return baseXDecode(s, B62, 'Base62');
    case 'base85': return base85Decode(s);
    case 'base100': return base100Decode(s);
  }
}
