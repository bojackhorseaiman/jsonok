/**
 * 哈希、HMAC、校验和。
 * - MD5 / SHA 系列 / SHA-3 / Keccak / RIPEMD / BLAKE 用 @noble/hashes（经过审计的开源库）
 * - MD2 / MD4 / SM3 / CRC / Adler-32 在这里自己实现，测试里用标准测试向量和 Node 自带的 crypto 交叉验证
 * - 所有算法都支持分块计算，几 GB 的文件也不用一次读进内存
 */
import { md5, ripemd160, sha1 } from '@noble/hashes/legacy.js';
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { keccak_224, keccak_256, keccak_384, keccak_512, sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from '@noble/hashes/sha3.js';
import { blake2b, blake2s } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { toBase64, toHex } from './bytes.ts';
import { ALGO_INFO, type AlgoInfo } from './hashList.ts';

export interface Hasher {
  update(data: Uint8Array): unknown;
  digest(): Uint8Array;
}

export interface Algo extends AlgoInfo {
  /** 输出位数 */
  bits: number;
  /** 分组长度（字节），HMAC 用 */
  block: number;
  create: () => Hasher;
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

// ================= 64 字节分组的 Merkle–Damgård 结构（MD4、SM3 共用） =================

abstract class Block64 implements Hasher {
  private buf = new Uint8Array(64);
  private pos = 0;
  private total = 0;
  private readonly bigEndianLength: boolean;
  constructor(bigEndianLength: boolean) {
    this.bigEndianLength = bigEndianLength;
  }
  protected abstract block(b: Uint8Array): void;
  protected abstract output(): Uint8Array;

  update(d: Uint8Array): this {
    let i = 0;
    this.total += d.length;
    if (this.pos) {
      const n = Math.min(64 - this.pos, d.length);
      this.buf.set(d.subarray(0, n), this.pos);
      this.pos += n;
      i = n;
      if (this.pos === 64) {
        this.block(this.buf);
        this.pos = 0;
      }
    }
    for (; i + 64 <= d.length; i += 64) this.block(d.subarray(i, i + 64));
    if (i < d.length) {
      this.buf.set(d.subarray(i), 0);
      this.pos = d.length - i;
    }
    return this;
  }

  digest(): Uint8Array {
    const bits = BigInt(this.total) * 8n;
    const pad = new Uint8Array(this.pos < 56 ? 56 - this.pos : 120 - this.pos);
    pad[0] = 0x80;
    const len = new Uint8Array(8);
    for (let i = 0; i < 8; i++) len[this.bigEndianLength ? 7 - i : i] = Number((bits >> BigInt(8 * i)) & 0xffn);
    this.update(pad);
    this.update(len);
    return this.output();
  }
}

// ================= MD4（RFC 1320） =================

class Md4 extends Block64 {
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  private x = new Int32Array(16);
  constructor() {
    super(false);
  }
  protected block(b: Uint8Array): void {
    const X = this.x;
    for (let i = 0; i < 16; i++) X[i] = b[i * 4] | (b[i * 4 + 1] << 8) | (b[i * 4 + 2] << 16) | (b[i * 4 + 3] << 24);
    let [a, bb, c, d] = this.h;
    const round = (f: (x: number, y: number, z: number) => number, ks: number[], ss: number[], add: number) => {
      for (let i = 0; i < 16; i++) {
        const r = rotl((a + f(bb, c, d) + X[ks[i]] + add) | 0, ss[i % 4]);
        a = d;
        d = c;
        c = bb;
        bb = r;
      }
    };
    round((x, y, z) => (x & y) | (~x & z), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [3, 7, 11, 19], 0);
    round((x, y, z) => (x & y) | (x & z) | (y & z), [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15], [3, 5, 9, 13], 0x5a827999);
    round((x, y, z) => x ^ y ^ z, [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15], [3, 9, 11, 15], 0x6ed9eba1);
    this.h = [(this.h[0] + a) | 0, (this.h[1] + bb) | 0, (this.h[2] + c) | 0, (this.h[3] + d) | 0];
  }
  protected output(): Uint8Array {
    const out = new Uint8Array(16);
    this.h.forEach((v, i) => {
      for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (8 * k)) & 0xff;
    });
    return out;
  }
}

// ================= SM3（国密 GB/T 32905-2016） =================

class Sm3 extends Block64 {
  private v = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];
  private w = new Int32Array(68);
  constructor() {
    super(true);
  }
  protected block(b: Uint8Array): void {
    const W = this.w;
    for (let i = 0; i < 16; i++) W[i] = (b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3];
    const p1 = (x: number) => x ^ rotl(x, 15) ^ rotl(x, 23);
    const p0 = (x: number) => x ^ rotl(x, 9) ^ rotl(x, 17);
    for (let j = 16; j < 68; j++) W[j] = p1(W[j - 16] ^ W[j - 9] ^ rotl(W[j - 3], 15)) ^ rotl(W[j - 13], 7) ^ W[j - 6];
    let [A, B, C, D, E, F, G, H] = this.v;
    for (let j = 0; j < 64; j++) {
      const T = j < 16 ? 0x79cc4519 : 0x7a879d8a;
      const a12 = rotl(A, 12);
      const ss1 = rotl((a12 + E + rotl(T, j % 32)) | 0, 7);
      const ss2 = ss1 ^ a12;
      const ff = j < 16 ? A ^ B ^ C : (A & B) | (A & C) | (B & C);
      const gg = j < 16 ? E ^ F ^ G : (E & F) | (~E & G);
      const tt1 = (ff + D + ss2 + (W[j] ^ W[j + 4])) | 0;
      const tt2 = (gg + H + ss1 + W[j]) | 0;
      D = C;
      C = rotl(B, 9);
      B = A;
      A = tt1;
      H = G;
      G = rotl(F, 19);
      F = E;
      E = p0(tt2);
    }
    const n = [A, B, C, D, E, F, G, H];
    this.v = this.v.map((x, i) => x ^ n[i]);
  }
  protected output(): Uint8Array {
    const out = new Uint8Array(32);
    this.v.forEach((x, i) => {
      for (let k = 0; k < 4; k++) out[i * 4 + k] = (x >>> (24 - 8 * k)) & 0xff;
    });
    return out;
  }
}

// ================= MD2（RFC 1319） =================

/** RFC 1319 里的 PI_SUBST 表（由圆周率的数字生成） */
const MD2_S = Uint8Array.from([
  41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19, 98, 167, 5, 243, 192, 199, 115, 140, 152, 147, 43, 217, 188, 76, 130, 202,
  30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111, 24, 138, 23, 229, 18, 190, 78, 196, 214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122,
  169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137, 11, 34, 95, 33, 128, 127, 93, 154, 90, 144, 50, 39, 53, 62, 204, 231, 191, 247, 151, 3,
  255, 25, 48, 179, 72, 165, 181, 209, 215, 94, 146, 42, 172, 86, 170, 198, 79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4, 241,
  69, 157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2, 27, 96, 37, 173, 174, 176, 185, 246, 28, 70, 97, 105, 52, 64, 126, 15,
  85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206, 186, 197, 234, 38, 44, 83, 13, 110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82,
  106, 220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12, 189, 177, 74, 120, 136, 149, 139, 227, 99, 232, 109, 233, 203, 213, 254, 59, 0, 29, 57,
  242, 239, 183, 14, 102, 88, 208, 228, 166, 119, 114, 248, 235, 117, 75, 10, 49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131, 20,
]);

class Md2 implements Hasher {
  private x = new Uint8Array(48);
  private c = new Uint8Array(16);
  private l = 0;
  private buf = new Uint8Array(16);
  private pos = 0;
  update(d: Uint8Array): this {
    for (let i = 0; i < d.length; i++) {
      this.buf[this.pos++] = d[i];
      if (this.pos === 16) {
        this.block(this.buf, true);
        this.pos = 0;
      }
    }
    return this;
  }
  private block(m: Uint8Array, checksum: boolean): void {
    const x = this.x;
    for (let j = 0; j < 16; j++) {
      x[16 + j] = m[j];
      x[32 + j] = x[16 + j] ^ x[j];
    }
    let t = 0;
    for (let j = 0; j < 18; j++) {
      for (let k = 0; k < 48; k++) t = x[k] ^= MD2_S[t];
      t = (t + j) & 0xff;
    }
    if (checksum) {
      for (let j = 0; j < 16; j++) {
        this.c[j] ^= MD2_S[m[j] ^ this.l];
        this.l = this.c[j];
      }
    }
  }
  digest(): Uint8Array {
    const n = 16 - this.pos;
    this.update(new Uint8Array(n).fill(n));
    this.block(this.c.slice(), false);
    return this.x.slice(0, 16);
  }
}

// ================= CRC / Adler-32 =================

const be = (v: number, bytes: number) => {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (v >>> (8 * (bytes - 1 - i))) & 0xff;
  return out;
};

/** 反射（低位在前）的 CRC 表：CRC32 和 CRC16/MODBUS */
function reflectedTable(poly: number): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC32_T = reflectedTable(0xedb88320);
const MODBUS_T = reflectedTable(0xa001);
/** 非反射（高位在前）的 CRC16 表：CCITT 多项式 0x1021 */
const CCITT_T = (() => {
  const t = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[n] = c;
  }
  return t;
})();

class Crc32 implements Hasher {
  private c = 0xffffffff;
  update(d: Uint8Array): this {
    let c = this.c;
    for (let i = 0; i < d.length; i++) c = CRC32_T[(c ^ d[i]) & 0xff] ^ (c >>> 8);
    this.c = c;
    return this;
  }
  digest(): Uint8Array {
    return be((this.c ^ 0xffffffff) >>> 0, 4);
  }
}

class Crc16Modbus implements Hasher {
  private c = 0xffff;
  update(d: Uint8Array): this {
    let c = this.c;
    for (let i = 0; i < d.length; i++) c = (c >>> 8) ^ MODBUS_T[(c ^ d[i]) & 0xff];
    this.c = c;
    return this;
  }
  digest(): Uint8Array {
    return be(this.c, 2);
  }
}

class Crc16Ccitt implements Hasher {
  private c: number;
  constructor(init: number) {
    this.c = init;
  }
  update(d: Uint8Array): this {
    let c = this.c;
    for (let i = 0; i < d.length; i++) c = ((c << 8) & 0xffff) ^ CCITT_T[((c >>> 8) ^ d[i]) & 0xff];
    this.c = c;
    return this;
  }
  digest(): Uint8Array {
    return be(this.c, 2);
  }
}

class Adler32 implements Hasher {
  private a = 1;
  private b = 0;
  update(d: Uint8Array): this {
    let { a, b } = this;
    // 每 5552 字节取一次模，不会溢出，也比每个字节取模快
    for (let i = 0; i < d.length; ) {
      const end = Math.min(d.length, i + 5552);
      for (; i < end; i++) {
        a += d[i];
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
    this.a = a;
    this.b = b;
    return this;
  }
  digest(): Uint8Array {
    return be(((this.b << 16) | this.a) >>> 0, 4);
  }
}

// ================= 算法表 =================

interface NobleHash { create(): Hasher; blockLen: number; outputLen: number }
type Impl = Pick<Algo, 'bits' | 'block' | 'create'>;
const noble = (h: NobleHash): Impl => ({ bits: h.outputLen * 8, block: h.blockLen, create: () => h.create() });
const own = (bits: number, block: number, create: () => Hasher): Impl => ({ bits, block, create });

const IMPL: Record<string, Impl> = {
  md5: noble(md5 as unknown as NobleHash),
  md4: own(128, 64, () => new Md4()),
  md2: own(128, 16, () => new Md2()),
  sha1: noble(sha1 as unknown as NobleHash),
  sha224: noble(sha224 as unknown as NobleHash),
  sha256: noble(sha256 as unknown as NobleHash),
  sha384: noble(sha384 as unknown as NobleHash),
  sha512: noble(sha512 as unknown as NobleHash),
  'sha512-224': noble(sha512_224 as unknown as NobleHash),
  'sha512-256': noble(sha512_256 as unknown as NobleHash),
  'sha3-224': noble(sha3_224 as unknown as NobleHash),
  'sha3-256': noble(sha3_256 as unknown as NobleHash),
  'sha3-384': noble(sha3_384 as unknown as NobleHash),
  'sha3-512': noble(sha3_512 as unknown as NobleHash),
  shake128: own(256, shake128.blockLen, () => shake128.create({ dkLen: 32 }) as unknown as Hasher),
  shake256: own(512, shake256.blockLen, () => shake256.create({ dkLen: 64 }) as unknown as Hasher),
  'keccak-224': noble(keccak_224 as unknown as NobleHash),
  'keccak-256': noble(keccak_256 as unknown as NobleHash),
  'keccak-384': noble(keccak_384 as unknown as NobleHash),
  'keccak-512': noble(keccak_512 as unknown as NobleHash),
  sm3: own(256, 64, () => new Sm3()),
  ripemd160: noble(ripemd160 as unknown as NobleHash),
  'blake2b-512': noble(blake2b as unknown as NobleHash),
  'blake2s-256': noble(blake2s as unknown as NobleHash),
  blake3: noble(blake3 as unknown as NobleHash),
  crc32: own(32, 0, () => new Crc32()),
  'crc16-modbus': own(16, 0, () => new Crc16Modbus()),
  'crc16-ccitt': own(16, 0, () => new Crc16Ccitt(0xffff)),
  'crc16-xmodem': own(16, 0, () => new Crc16Ccitt(0)),
  adler32: own(32, 0, () => new Adler32()),
};

export const ALGOS: Algo[] = ALGO_INFO.map((i) => {
  const impl = IMPL[i.id];
  if (!impl) throw new Error('缺少算法实现：' + i.id);
  return { ...i, ...impl };
});
const BY_ID = new Map(ALGOS.map((a) => [a.id, a]));

export function getAlgo(id: string): Algo {
  const a = BY_ID.get(id);
  if (!a) throw new Error('不支持的算法：' + id);
  return a;
}
export const pickAlgos = (ids: string[]): Algo[] => ids.map(getAlgo);

export function digest(a: Algo, data: Uint8Array): Uint8Array {
  const h = a.create();
  h.update(data);
  return h.digest();
}

/** HMAC（RFC 2104）：适用于这里所有 hmac=true 的算法 */
export function hmac(a: Algo, key: Uint8Array, msg: Uint8Array): Uint8Array {
  if (!a.hmac || !a.block) throw new Error(`${a.label} 不能用作 HMAC`);
  const B = a.block;
  const k0 = new Uint8Array(B);
  k0.set(key.length > B ? digest(a, key) : key);
  const ipad = k0.map((x) => x ^ 0x36);
  const opad = k0.map((x) => x ^ 0x5c);
  const inner = a.create();
  inner.update(ipad);
  inner.update(msg);
  const outer = a.create();
  outer.update(opad);
  outer.update(inner.digest());
  return outer.digest();
}

export interface BlobHooks {
  progress?: (done: number, total: number) => void;
  /** 返回 true 时停止计算（例如用户又打开了别的文件） */
  stale?: () => boolean;
}

/** 分块读取文件，同时计算多种哈希。文件不会一次读进内存 */
export async function digestBlob(blob: Blob, algos: Algo[], hooks: BlobHooks = {}, chunk = 4 * 1024 * 1024): Promise<Uint8Array[]> {
  const hs = algos.map((a) => a.create());
  for (let off = 0; off < blob.size; off += chunk) {
    if (hooks.stale?.()) throw new Error('已取消');
    const buf = new Uint8Array(await blob.slice(off, off + chunk).arrayBuffer());
    for (const h of hs) h.update(buf);
    hooks.progress?.(Math.min(blob.size, off + chunk), blob.size);
    // 让出主线程，页面不会卡住
    await new Promise((r) => setTimeout(r, 0));
  }
  return hs.map((h) => h.digest());
}

export type OutFmt = 'hex' | 'HEX' | 'base64';

export const formatDigest = (b: Uint8Array, f: OutFmt): string => (f === 'base64' ? toBase64(b) : toHex(b, f === 'HEX'));

/** 对比值和结果是否一致：支持大小写、空格 / 冒号分隔的十六进制、Base64，以及 “哈希值  文件名” 这种格式 */
export function matchDigest(expect: string, b: Uint8Array): boolean {
  const e = expect.trim();
  if (!e) return false;
  const hex = toHex(b);
  const b64 = toBase64(b);
  const candidates = [e, ...e.split(/\s+/)];
  return candidates.some((x) => {
    const h = x.replace(/[\s:-]/g, '').toLowerCase();
    if (/^[0-9a-f]+$/.test(h) && h === hex) return true;
    const s = x.replace(/\s/g, '');
    return s === b64 || s === b64.replace(/=+$/, '') || s === toBase64(b, true, false);
  });
}
