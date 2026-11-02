/**
 * RSA：生成密钥对（Web Crypto）、加解密和签名验签（node-forge）。
 * forge 支持 PKCS#1 v1.5 加密、PKCS#1 格式的密钥和证书，这些 Web Crypto 都不支持。
 */
import forge from 'node-forge';
import { concat } from './bytes.ts';
import { readKey, toPem } from './pem.ts';

type Pub = forge.pki.rsa.PublicKey;
type Priv = forge.pki.rsa.PrivateKey;

/** 字节 → forge 使用的“二进制字符串” */
export function bin(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}
export function unbin(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function asn1Of(der: Uint8Array): forge.asn1.Asn1 {
  try {
    return forge.asn1.fromDer(bin(der));
  } catch {
    throw new Error('密钥内容不完整，或者不是有效的 PEM / DER');
  }
}

const PRIV_HELP = '请粘贴 RSA 私钥（-----BEGIN PRIVATE KEY----- 或 -----BEGIN RSA PRIVATE KEY-----），也可以只粘贴中间的 Base64';
const PUB_HELP = '请粘贴 RSA 公钥（-----BEGIN PUBLIC KEY----- 或 -----BEGIN RSA PUBLIC KEY-----）、证书，或者只有中间的 Base64';

export function parsePrivateKey(text: string): Priv {
  if (!text.trim()) throw new Error('请填写私钥');
  const k = readKey(text);
  if (k.label === 'ENCRYPTED PRIVATE KEY' || /ENCRYPTED/.test(text.slice(0, 200))) {
    throw new Error('这是加了密码的私钥，请先去掉密码再使用：openssl pkey -in key.pem -out key-plain.pem');
  }
  if (k.label === 'EC PRIVATE KEY') throw new Error('这是 EC（椭圆曲线）私钥，不是 RSA 私钥');
  if (k.label && /PUBLIC KEY|CERTIFICATE/.test(k.label)) throw new Error('这里需要私钥，你粘贴的是公钥或证书');
  const asn = asn1Of(k.der);
  try {
    return forge.pki.privateKeyFromAsn1(asn) as Priv;
  } catch {
    throw new Error('无法识别私钥：' + PRIV_HELP);
  }
}

export function parsePublicKey(text: string): { key: Pub; from: '公钥' | '私钥' | '证书' } {
  if (!text.trim()) throw new Error('请填写公钥');
  const k = readKey(text);
  if (k.label === 'CERTIFICATE') {
    try {
      return { key: forge.pki.certificateFromAsn1(asn1Of(k.der)).publicKey as Pub, from: '证书' };
    } catch {
      throw new Error('无法读取证书里的公钥：只支持 RSA 证书');
    }
  }
  if (k.label && /PRIVATE KEY/.test(k.label)) {
    const p = parsePrivateKey(text);
    return { key: forge.pki.setRsaPublicKey(p.n, p.e), from: '私钥' };
  }
  const asn = asn1Of(k.der);
  try {
    return { key: forge.pki.publicKeyFromAsn1(asn) as Pub, from: '公钥' };
  } catch {
    // 只粘贴了 Base64 时，也可能是私钥
  }
  if (!k.label) {
    try {
      const p = forge.pki.privateKeyFromAsn1(asn) as Priv;
      return { key: forge.pki.setRsaPublicKey(p.n, p.e), from: '私钥' };
    } catch {
      // 继续往下报错
    }
  }
  throw new Error('无法识别公钥：' + PUB_HELP);
}

export const keyBits = (k: Pub | Priv): number => k.n.bitLength();
const keyBytes = (k: Pub | Priv) => Math.ceil(keyBits(k) / 8);

// ================= 加解密 =================

export type RsaPad = 'pkcs1' | 'oaep1' | 'oaep256' | 'oaep256j';

function oaep(p: RsaPad) {
  if (p === 'oaep1') return { md: forge.md.sha1.create(), mgf1: { md: forge.md.sha1.create() } };
  if (p === 'oaep256') return { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } };
  return { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha1.create() } };
}

/** 一次能加密的最大字节数 */
export function maxPlain(k: Pub | Priv, p: RsaPad): number {
  const kb = keyBytes(k);
  return p === 'pkcs1' ? kb - 11 : kb - 2 * (p === 'oaep1' ? 20 : 32) - 2;
}

export interface RsaOut { bytes: Uint8Array; segments: number }

export function rsaEncrypt(pub: Pub, data: Uint8Array, p: RsaPad, segment: boolean): RsaOut {
  const max = maxPlain(pub, p);
  if (max < 1) throw new Error(`${keyBits(pub)} 位密钥太短，不能使用这种填充方式`);
  if (data.length > max && !segment) {
    throw new Error(`内容 ${data.length} 字节，超过了 ${keyBits(pub)} 位密钥一次能加密的上限 ${max} 字节。可以勾选“内容太长时分段加密”，或者用对称加密加密内容、RSA 只加密对称密钥`);
  }
  const chunks: Uint8Array[] = [];
  if (!data.length) chunks.push(data);
  for (let off = 0; off < data.length; off += max) chunks.push(data.subarray(off, off + max));
  const out = chunks.map((ch) =>
    unbin(p === 'pkcs1' ? pub.encrypt(bin(ch), 'RSAES-PKCS1-V1_5') : pub.encrypt(bin(ch), 'RSA-OAEP', oaep(p))),
  );
  return { bytes: concat(...out), segments: chunks.length };
}

export function rsaDecrypt(priv: Priv, data: Uint8Array, p: RsaPad): RsaOut {
  const kb = keyBytes(priv);
  if (!data.length || data.length % kb) {
    throw new Error(`密文 ${data.length} 字节，应该是 ${kb} 字节（${keyBits(priv)} 位密钥）的整数倍。可能密文不完整、“密文格式”选错了，或者私钥和加密用的公钥不是一对`);
  }
  const out: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += kb) {
    const block = bin(data.subarray(off, off + kb));
    try {
      out.push(unbin(p === 'pkcs1' ? priv.decrypt(block, 'RSAES-PKCS1-V1_5') : priv.decrypt(block, 'RSA-OAEP', oaep(p))));
    } catch {
      throw new Error('解密失败：私钥和加密用的公钥不是一对，或者填充方式不对（加密时用的是 PKCS#1 v1.5 还是 OAEP？）');
    }
  }
  return { bytes: concat(...out), segments: out.length };
}

// ================= 签名 =================

export type SignAlg = 'sha256' | 'sha1' | 'sha384' | 'sha512' | 'md5' | 'pss256';

export const SIGN_LABEL: Record<SignAlg, string> = {
  sha256: 'SHA256withRSA', sha1: 'SHA1withRSA', sha384: 'SHA384withRSA', sha512: 'SHA512withRSA', md5: 'MD5withRSA', pss256: 'SHA256withRSA/PSS',
};

function digestOf(a: SignAlg, data: Uint8Array): forge.md.MessageDigest {
  const md =
    a === 'sha1' ? forge.md.sha1.create()
      : a === 'sha384' ? forge.md.sha384.create()
        : a === 'sha512' ? forge.md.sha512.create()
          : a === 'md5' ? forge.md.md5.create()
            : forge.md.sha256.create();
  md.update(bin(data));
  return md;
}

/** PSS：SHA-256、MGF1-SHA-256、盐长 32（和 Java 的 SHA256withRSA/PSS 默认值一致） */
const pss = () =>
  forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 32 });

export function rsaSign(priv: Priv, data: Uint8Array, a: SignAlg): Uint8Array {
  const md = digestOf(a, data);
  return unbin(a === 'pss256' ? priv.sign(md, pss()) : priv.sign(md));
}

export function rsaVerify(pub: Pub, data: Uint8Array, sig: Uint8Array, a: SignAlg): boolean {
  const digest = digestOf(a, data).digest().bytes();
  try {
    return a === 'pss256' ? pub.verify(digest, bin(sig), pss()) : pub.verify(digest, bin(sig));
  } catch {
    return false;
  }
}

// ================= 生成密钥对、格式转换 =================

export interface KeyPair { pub: string; priv: string }

export async function generateRsa(bits: number, privFmt: 'pkcs8' | 'pkcs1'): Promise<KeyPair> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const priv = privFmt === 'pkcs1'
    ? forge.pki.privateKeyToPem(forge.pki.privateKeyFromAsn1(asn1Of(pkcs8))).replace(/\r\n/g, '\n')
    : toPem('PRIVATE KEY', pkcs8);
  return { pub: toPem('PUBLIC KEY', spki), priv };
}

/** 任意格式的 RSA 公钥（PKCS#1、证书、私钥）→ SubjectPublicKeyInfo（DER），给 Web Crypto 用 */
export function publicSpkiDer(text: string): Uint8Array {
  const { key } = parsePublicKey(text);
  return unbin(forge.asn1.toDer(forge.pki.publicKeyToAsn1(key)).getBytes());
}

/** 任意格式的 RSA 私钥（PKCS#1 / PKCS#8）→ PKCS#8（DER），给 Web Crypto 用 */
export function privatePkcs8Der(text: string): Uint8Array {
  const k = parsePrivateKey(text);
  return unbin(forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(k))).getBytes());
}
