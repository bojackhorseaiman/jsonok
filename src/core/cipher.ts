/**
 * 对称加密：AES / DES / 3DES / RC4 / Rabbit。
 * - 分组加密的核心运算用 crypto-js（和 CryptoJS 生成的密文完全互通），填充和 CTR 计数器自己实现：
 *   crypto-js 的去填充不检查是否正确（密钥错了也不报错），CTR 只递增最后 32 位，和 OpenSSL 不一致
 * - AES-GCM 用浏览器自带的 Web Crypto
 * - “口令”方式与 CryptoJS.AES.encrypt(文字, "口令")、openssl enc -md md5 兼容：MD5 推导密钥，密文以 Salted__ 开头
 */
import CryptoJS from 'crypto-js';
import { md5 } from '@noble/hashes/legacy.js';
import { concat, randomBytes, utf8Bytes } from './bytes.ts';

export type CipherAlgo = 'aes' | 'des' | '3des' | 'rc4' | 'rabbit';
export type CipherMode = 'cbc' | 'ecb' | 'cfb' | 'ofb' | 'ctr' | 'gcm';
export type Padding = 'pkcs7' | 'zero' | 'none' | 'iso10126' | 'ansix923' | 'iso97971';

interface Spec {
  label: string;
  /** 分组长度（字节），0 表示流加密 */
  block: number;
  /** 允许的密钥长度（字节）；RC4 为空表示 1~256 都可以 */
  keyLens: number[];
  ivLen: number;
  /** 口令方式推导出的密钥 / IV 长度（和 CryptoJS 一致） */
  passKey: number;
  passIv: number;
}

export const SPEC: Record<CipherAlgo, Spec> = {
  aes: { label: 'AES', block: 16, keyLens: [16, 24, 32], ivLen: 16, passKey: 32, passIv: 16 },
  des: { label: 'DES', block: 8, keyLens: [8], ivLen: 8, passKey: 8, passIv: 8 },
  '3des': { label: '3DES', block: 8, keyLens: [16, 24], ivLen: 8, passKey: 24, passIv: 8 },
  rc4: { label: 'RC4', block: 0, keyLens: [], ivLen: 0, passKey: 32, passIv: 0 },
  rabbit: { label: 'Rabbit', block: 0, keyLens: [16], ivLen: 8, passKey: 16, passIv: 8 },
};

export const PAD_LABEL: Record<Padding, string> = {
  pkcs7: 'PKCS7', zero: 'ZeroPadding', none: '不', iso10126: 'ISO 10126', ansix923: 'ANSI X.923', iso97971: 'ISO/IEC 9797-1',
};

export interface CipherOpt {
  algo: CipherAlgo;
  mode: CipherMode;
  padding: Padding;
  /** 密钥；口令方式下是口令 */
  key: Uint8Array;
  iv: Uint8Array;
  /** 口令方式（OpenSSL / CryptoJS 兼容） */
  pass: boolean;
  /** 加密：随机 IV 放在密文前面；解密：从密文前面读取 IV */
  ivPrefix: boolean;
  /** 密钥 / IV 长度不对时补 0 或截断 */
  fix: boolean;
  /** 口令方式的盐，只在测试时指定 */
  salt?: Uint8Array;
}

export interface CipherOut { bytes: Uint8Array; notes: string[] }

// ================= WordArray 转换 =================

type WA = CryptoJS.lib.WordArray;

function toWA(b: Uint8Array): WA {
  const words = new Array<number>(Math.ceil(b.length / 4)).fill(0);
  for (let i = 0; i < b.length; i++) words[i >>> 2] |= b[i] << (24 - (i % 4) * 8);
  return CryptoJS.lib.WordArray.create(words, b.length);
}

function fromWA(w: WA): Uint8Array {
  const n = Math.max(0, w.sigBytes);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (w.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  return out;
}

// ================= 填充 =================

const BAD_PAD = '解密失败：填充不正确。通常是密钥、IV、模式或填充方式不对，也可能是密文不完整';

export function pad(d: Uint8Array, block: number, p: Padding): Uint8Array {
  if (p === 'none') {
    if (d.length % block) throw new Error(`不填充时，数据长度必须是 ${block} 字节的整数倍，现在是 ${d.length} 字节。可以换一种填充方式`);
    return d;
  }
  if (p === 'zero') {
    const n = (block - (d.length % block)) % block;
    return concat(d, new Uint8Array(n));
  }
  const n = block - (d.length % block);
  const tail = new Uint8Array(n);
  if (p === 'pkcs7') tail.fill(n);
  else if (p === 'ansix923') tail[n - 1] = n;
  else if (p === 'iso10126') {
    tail.set(randomBytes(n - 1));
    tail[n - 1] = n;
  } else tail[0] = 0x80; // iso97971
  return concat(d, tail);
}

export function unpad(d: Uint8Array, block: number, p: Padding): Uint8Array {
  if (p === 'none') return d;
  if (p === 'zero') {
    let end = d.length;
    while (end > 0 && d[end - 1] === 0) end--;
    return d.slice(0, end);
  }
  if (!d.length) throw new Error(BAD_PAD);
  if (p === 'iso97971') {
    let i = d.length - 1;
    while (i >= 0 && d[i] === 0) i--;
    if (i < 0 || d[i] !== 0x80 || d.length - i > block) throw new Error(BAD_PAD);
    return d.slice(0, i);
  }
  const n = d[d.length - 1];
  if (n < 1 || n > block || n > d.length) throw new Error(BAD_PAD);
  for (let i = d.length - n; i < d.length - 1; i++) {
    if (p === 'pkcs7' && d[i] !== n) throw new Error(BAD_PAD);
    if (p === 'ansix923' && d[i] !== 0) throw new Error(BAD_PAD);
  }
  return d.slice(0, d.length - n);
}

// ================= 核心运算 =================

const BLOCK_CIPHER = { aes: CryptoJS.AES, des: CryptoJS.DES, '3des': CryptoJS.TripleDES };
const MODE = { cbc: CryptoJS.mode.CBC, ecb: CryptoJS.mode.ECB, cfb: CryptoJS.mode.CFB, ofb: CryptoJS.mode.OFB };
type BlockAlgo = keyof typeof BLOCK_CIPHER;

function blockRaw(algo: BlockAlgo, mode: keyof typeof MODE, key: Uint8Array, iv: Uint8Array, data: Uint8Array, enc: boolean): Uint8Array {
  const C = BLOCK_CIPHER[algo];
  const cfg = { mode: MODE[mode], padding: CryptoJS.pad.NoPadding, ...(mode === 'ecb' ? {} : { iv: toWA(iv) }) };
  if (enc) return fromWA(C.encrypt(toWA(data), toWA(key), cfg).ciphertext);
  return fromWA(C.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: toWA(data) }), toWA(key), cfg));
}

/** 计数器整体按大端递增（和 OpenSSL、Java 一致） */
function increment(c: Uint8Array): void {
  for (let i = c.length - 1; i >= 0; i--) {
    c[i] = (c[i] + 1) & 0xff;
    if (c[i]) break;
  }
}

function ctr(algo: BlockAlgo, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const block = SPEC[algo].block;
  const out = new Uint8Array(data.length);
  const counter = iv.slice();
  const CHUNK = 256;
  for (let off = 0; off < data.length; off += block * CHUNK) {
    const n = Math.min(CHUNK, Math.ceil((data.length - off) / block));
    const blocks = new Uint8Array(n * block);
    for (let i = 0; i < n; i++) {
      blocks.set(counter, i * block);
      increment(counter);
    }
    const ks = blockRaw(algo, 'ecb', key, iv, blocks, true);
    for (let i = 0; i < ks.length && off + i < data.length; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}

function stream(algo: 'rc4' | 'rabbit', key: Uint8Array, iv: Uint8Array, data: Uint8Array, enc: boolean): Uint8Array {
  const C = algo === 'rc4' ? CryptoJS.RC4 : CryptoJS.Rabbit;
  const cfg = algo === 'rabbit' && iv.length ? { iv: toWA(iv) } : {};
  if (enc) return fromWA(C.encrypt(toWA(data), toWA(key), cfg).ciphertext);
  return fromWA(C.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: toWA(data) }), toWA(key), cfg));
}

const u8 = (b: Uint8Array) => new Uint8Array(b);

async function gcm(key: Uint8Array, iv: Uint8Array, data: Uint8Array, enc: boolean): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', u8(key), { name: 'AES-GCM' }, false, [enc ? 'encrypt' : 'decrypt']);
  const params = { name: 'AES-GCM', iv: u8(iv), tagLength: 128 };
  try {
    return new Uint8Array(enc ? await crypto.subtle.encrypt(params, k, u8(data)) : await crypto.subtle.decrypt(params, k, u8(data)));
  } catch {
    throw new Error(enc ? 'AES-GCM 加密失败' : '解密失败：GCM 认证标签校验不通过。密钥或 IV 不对，或者密文被修改过 / 不完整');
  }
}

type EffMode = CipherMode | 'stream';

function effMode(o: CipherOpt): EffMode {
  if (SPEC[o.algo].block === 0) return 'stream';
  if (o.mode === 'gcm' && o.algo !== 'aes') throw new Error('GCM 模式只支持 AES');
  return o.mode;
}

/** 除 GCM 以外的运算（同步） */
function run(algo: CipherAlgo, mode: EffMode, padding: Padding, key: Uint8Array, iv: Uint8Array, data: Uint8Array, enc: boolean): Uint8Array {
  if (mode === 'stream') return stream(algo as 'rc4', key, iv, data, enc);
  const a = algo as BlockAlgo;
  const block = SPEC[a].block;
  if (mode === 'ctr') return ctr(a, key, iv, data);
  if (mode === 'cfb' || mode === 'ofb') return blockRaw(a, mode, key, iv, data, enc);
  if (mode === 'gcm') throw new Error('GCM 需要异步处理');
  if (enc) return blockRaw(a, mode, key, iv, pad(data, block, padding), true);
  if (data.length % block) {
    throw new Error(`密文长度 ${data.length} 字节，不是 ${block} 字节的整数倍。可能密文不完整，或者“密文格式”（Base64 / 十六进制）选错了`);
  }
  return unpad(blockRaw(a, mode, key, iv, data, false), block, padding);
}

// ================= 口令（OpenSSL EVP_BytesToKey，MD5，1 次迭代） =================

const SALTED = utf8Bytes('Salted__');

export function evpKdf(pass: Uint8Array, salt: Uint8Array, keyLen: number, ivLen: number): { key: Uint8Array; iv: Uint8Array } {
  let d = new Uint8Array(0);
  let prev = new Uint8Array(0);
  while (d.length < keyLen + ivLen) {
    prev = md5(concat(prev, pass, salt));
    d = concat(d, prev);
  }
  return { key: d.slice(0, keyLen), iv: d.slice(keyLen, keyLen + ivLen) };
}

// ================= 长度检查 =================

function fit(b: Uint8Array, lens: number[], fix: boolean, what: '密钥' | 'IV', label: string, notes: string[]): Uint8Array {
  if (lens.includes(b.length)) return b;
  const want = lens.map((n) => `${n} 字节（${n * 8} 位）`).join(' / ');
  if (!fix) {
    const tip = what === '密钥' ? '可以勾选“长度不对时补 0”，或者把“密钥方式”改成“口令”' : '可以勾选“长度不对时补 0”';
    throw new Error(`${label} 的${what === 'IV' ? ' IV ' : '密钥'}必须是 ${want}，现在是 ${b.length} 字节。${tip}`);
  }
  const target = lens.find((n) => n >= b.length) ?? lens[lens.length - 1];
  const out = new Uint8Array(target);
  out.set(b.subarray(0, target));
  notes.push(`${what === 'IV' ? 'IV ' : '密钥'}长度 ${b.length} 字节，已${b.length < target ? '补 0 到' : '截断到'} ${target} 字节`);
  return out;
}

function checkKey(o: CipherOpt, notes: string[]): Uint8Array {
  const s = SPEC[o.algo];
  if (!o.key.length) throw new Error('请填写密钥');
  if (o.algo === 'rc4') {
    if (o.key.length > 256) throw new Error(`RC4 的密钥最长 256 字节，现在是 ${o.key.length} 字节`);
    return o.key;
  }
  const k = fit(o.key, s.keyLens, o.fix, '密钥', s.label, notes);
  if (o.algo === '3des' && k.length === 16) {
    notes.push('16 字节密钥按 K1 K2 K1 使用（双倍长 3DES）');
    return concat(k, k.subarray(0, 8));
  }
  return k;
}

const needsIv = (mode: EffMode) => mode === 'cbc' || mode === 'cfb' || mode === 'ofb' || mode === 'ctr' || mode === 'gcm';
const ivLenOf = (o: CipherOpt, mode: EffMode) => (mode === 'gcm' ? 12 : SPEC[o.algo].ivLen);

function checkIv(o: CipherOpt, mode: EffMode, notes: string[]): Uint8Array {
  const s = SPEC[o.algo];
  if (o.algo === 'rabbit') return o.iv.length ? fit(o.iv, [8], o.fix, 'IV', s.label, notes) : o.iv;
  if (!needsIv(mode)) {
    if (o.iv.length && mode === 'ecb') notes.push('ECB 模式不使用 IV，已忽略');
    return new Uint8Array(0);
  }
  const len = ivLenOf(o, mode);
  if (!o.iv.length) throw new Error(`${mode.toUpperCase()} 模式需要 IV（${len} 字节）。请在上方填写 IV，或者勾选“随机 IV 放在密文前面”`);
  if (mode === 'gcm') {
    if (o.iv.length !== 12) notes.push(`GCM 的 IV 一般是 12 字节，现在是 ${o.iv.length} 字节`);
    return o.iv;
  }
  return fit(o.iv, [s.ivLen], o.fix, 'IV', s.label, notes);
}

function describe(o: CipherOpt, keyLen: number, mode: EffMode): string {
  const s = SPEC[o.algo];
  if (mode === 'stream') return s.label;
  const name = o.algo === 'aes' ? `AES-${keyLen * 8}` : s.label;
  const padText = mode === 'cbc' || mode === 'ecb' ? `，${o.padding === 'none' ? '不填充' : PAD_LABEL[o.padding] + ' 填充'}` : '';
  return `${name}-${mode.toUpperCase()}${padText}`;
}

// ================= 对外接口 =================

export async function encrypt(data: Uint8Array, o: CipherOpt): Promise<CipherOut> {
  const s = SPEC[o.algo];
  const mode = effMode(o);
  const notes: string[] = [];
  if (o.pass) {
    if (mode === 'gcm') throw new Error('口令方式不支持 GCM 模式，请改用“直接使用密钥”，或者换成 CBC 模式');
    if (!o.key.length) throw new Error('请填写口令');
    const salt = o.salt ?? randomBytes(8);
    const { key, iv } = evpKdf(o.key, salt, s.passKey, s.passIv);
    const ct = run(o.algo, mode, o.padding, key, iv, data, true);
    notes.push(`${describe(o, key.length, mode)} · 口令方式（和 CryptoJS / OpenSSL 互通，每次加密的盐都不同，结果也不同）`);
    return { bytes: concat(SALTED, salt, ct), notes };
  }
  const key = checkKey(o, notes);
  let iv: Uint8Array;
  let prefix = new Uint8Array(0);
  if (o.ivPrefix && (needsIv(mode) || o.algo === 'rabbit')) {
    iv = randomBytes(o.algo === 'rabbit' ? 8 : ivLenOf(o, mode));
    prefix = iv;
    notes.push(`随机 IV（${iv.length} 字节）放在了密文最前面`);
  } else {
    iv = checkIv(o, mode, notes);
  }
  const ct = mode === 'gcm' ? await gcm(key, iv, data, true) : run(o.algo, mode, o.padding, key, iv, data, true);
  notes.unshift(describe(o, key.length, mode) + (mode === 'gcm' ? '（最后 16 字节是认证标签）' : ''));
  return { bytes: concat(prefix, ct), notes };
}

export async function decrypt(data: Uint8Array, o: CipherOpt): Promise<CipherOut> {
  const s = SPEC[o.algo];
  const mode = effMode(o);
  const notes: string[] = [];
  if (o.pass) {
    if (mode === 'gcm') throw new Error('口令方式不支持 GCM 模式，请改用“直接使用密钥”，或者换成 CBC 模式');
    if (!o.key.length) throw new Error('请填写口令');
    const head = data.subarray(0, 8);
    if (data.length < 16 || !head.every((x, i) => x === SALTED[i])) {
      throw new Error('这段密文不是口令方式加密的：解码后没有以 Salted__ 开头（Base64 一般是 U2FsdGVkX1 开头）。如果加密时直接用了密钥和 IV，请把“密钥方式”改成“直接使用密钥”');
    }
    const { key, iv } = evpKdf(o.key, data.subarray(8, 16), s.passKey, s.passIv);
    const pt = run(o.algo, mode, o.padding, key, iv, data.subarray(16), false);
    notes.push(`${describe(o, key.length, mode)} · 口令方式`);
    return { bytes: pt, notes };
  }
  const key = checkKey(o, notes);
  let iv: Uint8Array;
  let body = data;
  if (o.ivPrefix && (needsIv(mode) || o.algo === 'rabbit')) {
    const len = o.algo === 'rabbit' ? 8 : ivLenOf(o, mode);
    if (data.length < len) throw new Error(`密文只有 ${data.length} 字节，前面放不下 ${len} 字节的 IV`);
    iv = data.slice(0, len);
    body = data.subarray(len);
    notes.push(`已从密文前面读取 IV（${len} 字节）`);
  } else {
    iv = checkIv(o, mode, notes);
  }
  if (mode === 'gcm' && body.length < 16) throw new Error('密文太短：GCM 密文的最后 16 字节是认证标签');
  const pt = mode === 'gcm' ? await gcm(key, iv, body, false) : run(o.algo, mode, o.padding, key, iv, body, false);
  notes.unshift(describe(o, key.length, mode));
  return { bytes: pt, notes };
}
