/**
 * Gzip / Zlib / Deflate 压缩和解压（fflate）。
 * - Gzip：1F 8B 开头，HTTP 的 Content-Encoding: gzip、.gz 文件、Java GZIPOutputStream、PHP gzencode
 * - Zlib：78 开头，Python zlib.compress、Java Deflater、PHP gzcompress、Node zlib.deflateSync
 * - Deflate（无头）：没有头和校验，Java Deflater(nowrap)、.NET DeflateStream、PHP gzdeflate
 * 解压时会核对 CRC32 / Adler-32，并限制解压后的大小，防止“压缩炸弹”把浏览器卡死。
 */
import { Gunzip, Inflate, Unzlib, deflateSync, gzipSync, zlibSync } from 'fflate';
import { concat, isUtf8, utf8Bytes, utf8Text } from './bytes.ts';

export type GzFmt = 'gzip' | 'zlib' | 'raw';
export const FMT_LABEL: Record<GzFmt, string> = { gzip: 'Gzip', zlib: 'Zlib', raw: 'Deflate（无头）' };

type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 压缩。Gzip 不写入时间（和 gzip -n 一样），所以同样的输入每次结果都相同 */
export function compress(data: Uint8Array, fmt: GzFmt, level = 6, filename?: string): Uint8Array {
  if (!Number.isInteger(level) || level < 0 || level > 9) throw new Error(`压缩级别应该是 0 ~ 9，现在是 ${level}`);
  const lv = level as Level;
  if (fmt === 'zlib') return zlibSync(data, { level: lv });
  if (fmt === 'raw') return deflateSync(data, { level: lv });
  // fflate 按单字节写文件名，先把 UTF-8 字节转成同样长度的字符串，中文文件名才不会乱
  const fn = filename ? String.fromCharCode(...utf8Bytes(filename.replace(/[\\/]/g, '_')).subarray(0, 255)) : undefined;
  const out = gzipSync(data, { level: lv, filename: fn });
  out.fill(0, 4, 8);
  return out;
}

// ================= 识别格式和读取 Gzip 头 =================

export function detectFmt(b: Uint8Array): GzFmt | null {
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  // Zlib 头：低 4 位是 8（Deflate），窗口不超过 32K，并且头两个字节组成的数能被 31 整除
  if (b.length >= 2 && (b[0] & 0x0f) === 8 && b[0] >> 4 <= 7 && ((b[0] << 8) | b[1]) % 31 === 0) return 'zlib';
  return null;
}

export interface GzHeader { filename?: string; mtime?: Date; comment?: string }

export function gzipHeader(b: Uint8Array): GzHeader {
  const h: GzHeader = {};
  if (b.length < 10) return h;
  const flg = b[3];
  const mt = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  if (mt) h.mtime = new Date(mt * 1000);
  let p = 10;
  if (flg & 4) p += 2 + (b[p] | (b[p + 1] << 8));
  const zstr = () => {
    const s = p;
    while (p < b.length && b[p]) p++;
    const raw = b.subarray(s, p);
    p++;
    // 标准规定用 Latin-1，但很多工具直接写 UTF-8
    return isUtf8(raw) ? utf8Text(raw) : String.fromCharCode(...raw);
  };
  if (flg & 8) h.filename = zstr();
  if (flg & 16) h.comment = zstr();
  return h;
}

// ================= 校验和 =================

let CRC_TABLE: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(b: Uint8Array): number {
  let a = 1;
  let s = 0;
  for (let i = 0; i < b.length; ) {
    const end = Math.min(b.length, i + 3800);
    for (; i < end; i++) {
      a += b[i];
      s += a;
    }
    a %= 65521;
    s %= 65521;
  }
  return ((s << 16) | a) >>> 0;
}

// ================= 解压 =================

/** 解压后的大小上限 */
export const MAX_OUT = 512 * 1024 * 1024;

export interface Inflated {
  bytes: Uint8Array;
  fmt: GzFmt;
  /** Gzip 的成员个数（多个 .gz 首尾相连时大于 1） */
  members: number;
  header?: GzHeader;
  /** 是否核对了校验和 */
  checked: boolean;
}

const hex2 = (b: Uint8Array) => [...b.subarray(0, 2)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const mb = (n: number) => `${Math.round(n / 1048576)} MB`;

class TooLarge extends Error {}

function friendly(e: unknown, fmt: GzFmt): Error {
  if (e instanceof TooLarge) return e;
  const m = e instanceof Error ? e.message : String(e);
  const what = FMT_LABEL[fmt];
  if (/unexpected EOF/i.test(m)) return new Error(`数据不完整：解压到一半数据就结束了，可能复制时少了字符（按 ${what} 解压）`);
  if (/invalid gzip/i.test(m)) return new Error('Gzip 头信息不对，数据可能已损坏');
  if (/invalid zlib/i.test(m)) return new Error('Zlib 头信息不对，数据可能已损坏');
  if (/invalid (block type|length|distance)/i.test(m)) return new Error(`压缩数据已损坏，无法按 ${what} 解压（${m}）`);
  return new Error(`解压失败（按 ${what} 解压）：${m}`);
}

export function decompress(b: Uint8Array, want: GzFmt | 'auto' = 'auto', limit = MAX_OUT): Inflated {
  if (!b.length) throw new Error('没有要解压的数据');
  const det = detectFmt(b);
  if (want === 'gzip' && det !== 'gzip') throw new Error(`不是 Gzip 数据：开头应该是 1F 8B，现在是 ${hex2(b)}`);
  if (want === 'zlib' && det !== 'zlib') throw new Error(`不是 Zlib 数据：开头两个字节 ${hex2(b)} 不符合 Zlib 格式（一般是 78 9C、78 DA、78 01）`);
  const fmt: GzFmt = want === 'auto' ? det ?? 'raw' : want;
  if (fmt === 'zlib' && b[1] & 0x20) throw new Error('这个 Zlib 数据用了预设字典，需要原来的字典才能解压，这里不支持');

  const chunks: Uint8Array[] = [];
  let total = 0;
  let members = 1;
  const on = (c: Uint8Array) => {
    total += c.length;
    if (total > limit) throw new TooLarge(`解压后超过 ${mb(limit)}，为防止浏览器卡死已停止。可能是文件太大，也可能是“压缩炸弹”`);
    chunks.push(c);
  };
  const s = fmt === 'gzip' ? new Gunzip(on) : fmt === 'zlib' ? new Unzlib(on) : new Inflate(on);
  if (s instanceof Gunzip) s.onmember = (off) => { if (off > 0) members++; };
  try {
    const STEP = 1 << 16;
    for (let i = 0; i < b.length; i += STEP) s.push(b.subarray(i, i + STEP), i + STEP >= b.length);
  } catch (e) {
    if (want === 'auto' && !det && !(e instanceof TooLarge)) {
      throw new Error('无法识别格式：开头不是 Gzip（1F 8B）也不是 Zlib（78 …），按无头 Deflate 解压也失败了。请确认这是压缩过的数据，并检查“输入格式”是否选对');
    }
    throw friendly(e, fmt);
  }
  const bytes = concat(...chunks);
  const r: Inflated = { bytes, fmt, members, checked: false };
  const u32le = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  if (fmt === 'gzip') {
    r.header = gzipHeader(b);
    if (members === 1 && b.length >= 18) {
      if (u32le(b.length - 8) !== crc32(bytes) || u32le(b.length - 4) !== bytes.length % 2 ** 32) {
        throw new Error('校验不一致（CRC32），数据不完整或已损坏，可能复制时少了字符');
      }
      r.checked = true;
    }
  } else if (fmt === 'zlib' && b.length >= 6) {
    const p = b.length - 4;
    const want32 = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    if (want32 !== adler32(bytes)) throw new Error('校验不一致（Adler-32），数据不完整或已损坏，可能复制时少了字符');
    r.checked = true;
  }
  return r;
}
