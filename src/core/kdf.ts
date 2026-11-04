/**
 * 密码哈希：Bcrypt（bcryptjs）和 Scrypt（@noble/hashes）。
 * - Bcrypt 输出 $2a$ / $2b$ / $2y$ 三种前缀（算法相同，只是不同语言的习惯写法），验证时三种都能认
 * - Scrypt 输出 PHC 标准字符串 $scrypt$ln=14,r=8,p=1$盐$哈希（和 Python passlib 一致），也能用“密钥 + 盐 + 参数”验证
 */
import bcrypt from 'bcryptjs';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { fromBase64, fromHex, randomBytes, toBase64, utf8Bytes } from './bytes.ts';

// ================= Bcrypt =================

export type BcryptPrefix = '2a' | '2b' | '2y';

/** $2b$10$ + 22 位盐 + 31 位哈希 */
export const BCRYPT_RE = /^\$2([abxy])\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/;

/** Bcrypt 只使用密码的前 72 个字节，超出的部分不起作用 */
export const BCRYPT_MAX_BYTES = 72;
export const bcryptOverLimit = (pw: string): number => Math.max(0, utf8Bytes(pw).length - BCRYPT_MAX_BYTES);

type HashFn = (pw: string, salt: number | string, cb?: undefined, progress?: (f: number) => void) => Promise<string>;
type CompareFn = (pw: string, hash: string, cb?: undefined, progress?: (f: number) => void) => Promise<boolean>;

export interface BcryptOpt {
  /** 强度（轮数的 2 的幂），4 ~ 31 */
  cost: number;
  prefix: BcryptPrefix;
  /** 指定盐（完整的 $2a$05$ + 22 位），只在测试时使用 */
  salt?: string;
  onProgress?: (f: number) => void;
}

export async function bcryptHash(pw: string, o: BcryptOpt): Promise<string> {
  if (!Number.isInteger(o.cost) || o.cost < 4 || o.cost > 31) throw new Error(`Bcrypt 的强度应该是 4 ~ 31，现在是 ${o.cost}`);
  const h = await (bcrypt.hash as unknown as HashFn)(pw, o.salt ?? o.cost, undefined, o.onProgress);
  return o.salt ? h : h.replace(/^\$2[ab]\$/, `$${o.prefix}$`);
}

export interface BcryptInfo { prefix: string; cost: number; salt: string }

export function parseBcrypt(hash: string): BcryptInfo {
  const h = hash.trim();
  const m = BCRYPT_RE.exec(h);
  if (!m) {
    if (/^\$2[abxy]\$/.test(h)) throw new Error(`Bcrypt 哈希的长度应该是 60 个字符，现在是 ${h.length} 个。可能复制时少了或多了字符`);
    throw new Error('不是 Bcrypt 哈希：应该以 $2a$、$2b$ 或 $2y$ 开头，例如 $2y$10$…，共 60 个字符');
  }
  if (m[1] === 'x') throw new Error('$2x$ 是早期有缺陷的 Bcrypt 实现生成的，不支持验证');
  const cost = Number(m[2]);
  if (cost < 4 || cost > 31) throw new Error(`Bcrypt 的强度应该是 4 ~ 31，这个哈希里是 ${cost}`);
  return { prefix: `$2${m[1]}$`, cost, salt: m[3] };
}

export async function bcryptVerify(pw: string, hash: string, onProgress?: (f: number) => void): Promise<{ ok: boolean; info: BcryptInfo }> {
  const info = parseBcrypt(hash);
  const ok = await (bcrypt.compare as unknown as CompareFn)(pw, hash.trim(), undefined, onProgress);
  return { ok, info };
}

// ================= Scrypt =================

export interface ScryptParams {
  /** N = 2^ln */
  ln: number;
  r: number;
  p: number;
  dkLen: number;
}

/** 大约需要的内存（字节）：128 × N × r */
export const scryptMemory = (prm: Pick<ScryptParams, 'ln' | 'r'>): number => 128 * 2 ** prm.ln * prm.r;
const MAX_MEM = 512 * 1024 * 1024;

export function checkScryptParams(prm: ScryptParams): void {
  const int = (v: number, min: number, max: number, name: string) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name}应该是 ${min} ~ ${max} 的整数，现在是 ${v}`);
  };
  int(prm.ln, 1, 22, 'N 的指数');
  int(prm.r, 1, 32, 'r（块大小）');
  int(prm.p, 1, 16, 'p（并行度）');
  int(prm.dkLen, 1, 128, '密钥长度');
  const mem = scryptMemory(prm);
  if (mem > MAX_MEM) {
    throw new Error(`参数太大：需要约 ${Math.round(mem / 1048576)} MB 内存（128 × N × r），浏览器可能卡死。请减小 N 或 r，最多 512 MB`);
  }
}

export interface DeriveHooks {
  onProgress?: (f: number) => void;
  /** 返回 true 时停止计算 */
  stale?: () => boolean;
}

export async function scryptDerive(pw: Uint8Array, salt: Uint8Array, prm: ScryptParams, hooks: DeriveHooks = {}): Promise<Uint8Array> {
  checkScryptParams(prm);
  return scryptAsync(pw, salt, {
    N: 2 ** prm.ln,
    r: prm.r,
    p: prm.p,
    dkLen: prm.dkLen,
    maxmem: MAX_MEM + 1024 * 1024,
    onProgress: (f: number) => {
      if (hooks.stale?.()) throw new Error('已取消');
      hooks.onProgress?.(f);
    },
  });
}

const b64 = (b: Uint8Array) => toBase64(b, false, false);

export const scryptPhc = (prm: ScryptParams, salt: Uint8Array, key: Uint8Array): string =>
  `$scrypt$ln=${prm.ln},r=${prm.r},p=${prm.p}$${b64(salt)}$${b64(key)}`;

const PHC_RE = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/.]+)\$([A-Za-z0-9+/.]+)$/;

/** 读取 PHC 字符串；盐和哈希支持标准 Base64 和 passlib 的写法（用 . 代替 +） */
export function parseScryptPhc(s: string): { prm: ScryptParams; salt: Uint8Array; key: Uint8Array } {
  const t = s.trim();
  const m = PHC_RE.exec(t);
  if (!m) throw new Error('不是 Scrypt 的标准字符串：应该像 $scrypt$ln=14,r=8,p=1$盐$哈希');
  const dec = (x: string) => fromBase64(x.replace(/\./g, '+')).bytes;
  const key = dec(m[5]);
  return { prm: { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]), dkLen: key.length }, salt: dec(m[4]), key };
}

export const isScryptPhc = (s: string): boolean => s.trim().startsWith('$scrypt$');

/** 读取盐或密钥：文字 / 十六进制 / Base64 */
export function readBytes(text: string, fmt: 'text' | 'hex' | 'base64'): Uint8Array {
  if (fmt === 'hex') return fromHex(text);
  if (fmt === 'base64') return fromBase64(text).bytes;
  return utf8Bytes(text);
}

/** 自动识别十六进制或 Base64 */
export function readKey(text: string): Uint8Array {
  const t = text.trim();
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0) return fromHex(t);
  return fromBase64(t).bytes;
}

export const newSalt = (): Uint8Array => randomBytes(16);

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
