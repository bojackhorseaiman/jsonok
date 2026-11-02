/**
 * JWT：解析、验证签名、签发。
 * - HS 系列用 hash.ts 里的 HMAC；RS / PS / ES / EdDSA 用浏览器自带的 Web Crypto
 * - 密钥支持 PEM、只有 Base64 的 DER、JWK、JWKS；PKCS#1 格式的 RSA 密钥会先转换（用到时才加载 node-forge）
 */
import * as Core from './json.ts';
import { fromBase64, toBase64, utf8Bytes } from './bytes.ts';
import { getAlgo, hmac } from './hash.ts';
import { readKey } from './pem.ts';

const b64url = (b: Uint8Array) => toBase64(b, true, false);
const u8 = (b: Uint8Array) => new Uint8Array(b);

export interface Decoded {
  header: Core.JNode;
  payload: Core.JNode;
  headerJS: Record<string, unknown>;
  payloadJS: unknown;
  signature: Uint8Array;
  signingInput: string;
  alg: string;
}

function part(seg: string, idx: number, name: string): Core.JNode {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(seg).bytes;
  } catch {
    throw new Error(`第 ${idx} 段（${name}）不是有效的 Base64URL`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`第 ${idx} 段（${name}）解码后不是 UTF-8 文本`);
  }
  try {
    return Core.parse(text).root;
  } catch {
    throw new Error(`第 ${idx} 段（${name}）解码后不是 JSON：${text.slice(0, 60)}`);
  }
}

export function decodeJwt(token: string): Decoded {
  const t = token.trim().replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  if (!t) throw new Error('请输入 JWT');
  const parts = t.split('.');
  if (parts.length === 5) throw new Error('这是加密的 JWE（5 段），内容是加密的，不能直接查看。这里只支持签名的 JWT（3 段）');
  if (parts.length !== 3) throw new Error(`JWT 应该是用 . 分隔的 3 段（Header.Payload.Signature），现在是 ${parts.length} 段`);
  const header = part(parts[0], 1, 'Header');
  if (header.t !== 'o') throw new Error('Header 应该是 JSON 对象');
  const payload = part(parts[1], 2, 'Payload');
  let signature: Uint8Array;
  try {
    signature = parts[2] ? fromBase64(parts[2]).bytes : new Uint8Array(0);
  } catch {
    throw new Error('第 3 段（Signature）不是有效的 Base64URL');
  }
  const headerJS = Core.toJS(header) as Record<string, unknown>;
  return { header, payload, headerJS, payloadJS: Core.toJS(payload), signature, signingInput: `${parts[0]}.${parts[1]}`, alg: String(headerJS.alg ?? '') };
}

// ================= 时间 =================

export interface TimeItem { key: string; label: string; date: Date; rel: string }

const pad2 = (n: number) => String(n).padStart(2, '0');
export const fmtTime = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export function relTime(ms: number): string {
  const a = Math.abs(ms);
  const s = a < 60e3 ? `${Math.round(a / 1e3)} 秒` : a < 3600e3 ? `${Math.round(a / 60e3)} 分钟` : a < 86400e3 ? `${Math.round(a / 3600e3)} 小时` : `${Math.round(a / 86400e3)} 天`;
  return ms < 0 ? `${s}前` : `${s}后`;
}

/** 读取 iat / nbf / exp（单位是秒；数值特别大时按毫秒理解） */
export function timeClaims(payload: unknown, now = Date.now()): { items: TimeItem[]; expired: boolean; notYet: boolean } {
  const items: TimeItem[] = [];
  let expired = false;
  let notYet = false;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    for (const [key, label] of [['iat', '签发时间'], ['nbf', '生效时间'], ['exp', '过期时间']] as const) {
      const v = p[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const date = new Date(v > 1e11 ? v : v * 1000);
      items.push({ key, label, date, rel: relTime(date.getTime() - now) });
      if (key === 'exp' && date.getTime() <= now) expired = true;
      if (key === 'nbf' && date.getTime() > now) notYet = true;
    }
  }
  return { items, expired, notYet };
}

// ================= 算法和密钥 =================

type Fam = 'HS' | 'RS' | 'PS' | 'ES' | 'EdDSA';
interface AlgSpec { fam: Fam; bits: number; hash: string }

export const JWT_ALGS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

function algSpec(alg: string): AlgSpec {
  if (alg === 'EdDSA') return { fam: 'EdDSA', bits: 0, hash: '' };
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  if (!m) throw new Error(alg ? `不支持的签名算法：${alg}` : 'Header 里没有 alg（签名算法）');
  return { fam: m[1] as Fam, bits: Number(m[2]), hash: 'SHA-' + m[2] };
}

const CURVE: Record<number, string> = { 256: 'P-256', 384: 'P-384', 512: 'P-521' };
const EC_SIG_LEN: Record<number, number> = { 256: 64, 384: 96, 512: 132 };

function importParams(s: AlgSpec): RsaHashedImportParams | EcKeyImportParams | Algorithm {
  if (s.fam === 'RS') return { name: 'RSASSA-PKCS1-v1_5', hash: s.hash };
  if (s.fam === 'PS') return { name: 'RSA-PSS', hash: s.hash };
  if (s.fam === 'ES') return { name: 'ECDSA', namedCurve: CURVE[s.bits] };
  return { name: 'Ed25519' };
}

function signParams(s: AlgSpec): Algorithm | RsaPssParams | EcdsaParams {
  if (s.fam === 'RS') return { name: 'RSASSA-PKCS1-v1_5' };
  if (s.fam === 'PS') return { name: 'RSA-PSS', saltLength: s.bits / 8 };
  if (s.fam === 'ES') return { name: 'ECDSA', hash: s.hash };
  return { name: 'Ed25519' };
}

type Jwk = JsonWebKey & { kid?: string; keys?: Jwk[] };

function parseJwk(text: string, kid?: string): Jwk {
  let j: Jwk;
  try {
    j = JSON.parse(text) as Jwk;
  } catch {
    throw new Error('密钥看起来是 JSON（JWK），但不是有效的 JSON');
  }
  if (Array.isArray(j.keys)) {
    const list = j.keys;
    const k = (kid && list.find((x) => x.kid === kid)) || list.find((x) => !x.use || x.use === 'sig') || list[0];
    if (!k) throw new Error('JWKS 里没有密钥');
    j = k;
  }
  return j;
}

function secretOf(keyText: string, fmt: 'text' | 'base64'): Uint8Array {
  const t = keyText.trim();
  if (t.startsWith('{')) {
    const j = parseJwk(t);
    if (j.kty !== 'oct' || typeof j.k !== 'string') throw new Error('HS 算法需要对称密钥：JWK 的 kty 应该是 oct');
    return fromBase64(j.k).bytes;
  }
  return fmt === 'base64' ? fromBase64(t).bytes : utf8Bytes(t);
}

const PRIVATE_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];

async function importKey(s: AlgSpec, alg: string, text: string, usage: 'sign' | 'verify', kid?: string): Promise<CryptoKey> {
  const t = text.trim();
  if (!t) throw new Error(usage === 'sign' ? `请填写 ${alg} 用的私钥` : `请填写 ${alg} 用的公钥`);
  const fail = (e: unknown): never => {
    const detail = e instanceof Error ? e.message : String(e ?? '');
    throw new Error(`密钥和算法 ${alg} 不匹配，或者密钥格式不对${detail ? `（${detail}）` : ''}`);
  };
  if (t.startsWith('{')) {
    const j: Record<string, unknown> = { ...parseJwk(t, kid) };
    for (const f of ['alg', 'use', 'key_ops', 'kid', 'ext']) delete j[f];
    if (usage === 'verify') for (const f of PRIVATE_FIELDS) delete j[f];
    else if (!('d' in j)) throw new Error('签发需要私钥，这个 JWK 是公钥（没有 d 字段）');
    try {
      return await crypto.subtle.importKey('jwk', j as JsonWebKey, importParams(s), false, [usage]);
    } catch (e) {
      return fail(e);
    }
  }
  const k = readKey(t);
  const rsa = s.fam === 'RS' || s.fam === 'PS';
  const fmt = usage === 'verify' ? 'spki' : 'pkcs8';
  let der = k.der;
  if (usage === 'verify') {
    if (k.label && k.label !== 'PUBLIC KEY') {
      if (!rsa) {
        if (k.label.includes('PRIVATE')) throw new Error('验证签名请粘贴公钥，不是私钥');
        throw new Error(`暂不支持 ${k.label}，请粘贴 -----BEGIN PUBLIC KEY----- 格式的公钥`);
      }
      der = (await import('./rsa.ts')).publicSpkiDer(t);
    }
  } else {
    if (k.label === 'EC PRIVATE KEY') throw new Error('这是 SEC1 格式的 EC 私钥，请先转成 PKCS#8：openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem');
    if (k.label && /PUBLIC KEY|CERTIFICATE/.test(k.label)) throw new Error('签发需要私钥，你粘贴的是公钥或证书');
    if (k.label === 'RSA PRIVATE KEY' || k.label === 'ENCRYPTED PRIVATE KEY') {
      if (!rsa) throw new Error(`${alg} 需要 EC / Ed25519 私钥，你粘贴的是 RSA 私钥`);
      der = (await import('./rsa.ts')).privatePkcs8Der(t);
    }
  }
  try {
    return await crypto.subtle.importKey(fmt, u8(der), importParams(s), false, [usage]);
  } catch (e) {
    if (!k.label && rsa) {
      // 只粘贴了 Base64：可能是 PKCS#1 格式
      try {
        const m = await import('./rsa.ts');
        der = usage === 'verify' ? m.publicSpkiDer(t) : m.privatePkcs8Der(t);
        return await crypto.subtle.importKey(fmt, u8(der), importParams(s), false, [usage]);
      } catch {
        // 按原来的错误报
      }
    }
    return fail(e);
  }
}

// ================= 验证 / 签发 =================

export interface VerifyResult { ok: boolean; message: string }

export async function verifyJwt(d: Decoded, keyText: string, secretFmt: 'text' | 'base64'): Promise<VerifyResult> {
  if (d.alg === 'none') return { ok: false, message: '✗ alg 是 none：这个 JWT 没有签名，任何人都能伪造' };
  const s = algSpec(d.alg);
  const data = utf8Bytes(d.signingInput);
  let ok: boolean;
  if (s.fam === 'HS') {
    const mac = hmac(getAlgo('sha' + s.bits), secretOf(keyText, secretFmt), data);
    ok = mac.length === d.signature.length && mac.every((x, i) => x === d.signature[i]);
  } else {
    if (s.fam === 'ES' && d.signature.length !== EC_SIG_LEN[s.bits]) {
      return { ok: false, message: `✗ 签名长度 ${d.signature.length} 字节，${d.alg} 应该是 ${EC_SIG_LEN[s.bits]} 字节` };
    }
    const kid = typeof d.headerJS.kid === 'string' ? d.headerJS.kid : undefined;
    const key = await importKey(s, d.alg, keyText, 'verify', kid);
    ok = await crypto.subtle.verify(signParams(s), key, u8(d.signature), u8(data));
  }
  return ok ? { ok, message: `✓ 签名验证通过（${d.alg}）` } : { ok, message: '✗ 签名不正确：密钥不对，或者 JWT 被修改过' };
}

export interface SignOpt {
  alg: string;
  keyText: string;
  secretFmt: 'text' | 'base64';
  kid: string;
  /** 自动加上签发时间 iat */
  iat: boolean;
  /** 有效期（秒），0 表示不设置 exp */
  expSec: number;
  now: number;
}

export async function signJwt(payload: Core.JNode, o: SignOpt): Promise<{ token: string; exp: Date | null; warn: string }> {
  if (payload.t !== 'o') throw new Error('Payload 应该是 JSON 对象 {…}');
  const s = algSpec(o.alg);
  const items = payload.items.slice();
  const set = (k: string, v: Core.JNode) => {
    const i = items.findIndex(([x]) => x === k);
    if (i >= 0) items[i] = [k, v];
    else items.push([k, v]);
  };
  const now = Math.floor(o.now / 1000);
  if (o.iat) set('iat', { t: 'n', raw: String(now) });
  let exp: Date | null = null;
  if (o.expSec > 0) {
    set('exp', { t: 'n', raw: String(now + o.expSec) });
    exp = new Date((now + o.expSec) * 1000);
  } else {
    const e = Core.getKey({ t: 'o', items }, 'exp');
    if (e && e.t === 'n') exp = new Date(Number(e.raw) * 1000);
  }
  const headerItems: [string, Core.JNode][] = [['alg', { t: 's', v: o.alg }], ['typ', { t: 's', v: 'JWT' }]];
  if (o.kid.trim()) headerItems.push(['kid', { t: 's', v: o.kid.trim() }]);
  const enc = (n: Core.JNode) => b64url(utf8Bytes(Core.stringify(n, { indent: '' })));
  const input = `${enc({ t: 'o', items: headerItems })}.${enc({ t: 'o', items })}`;
  let sig: Uint8Array;
  let warn = '';
  if (s.fam === 'HS') {
    const secret = secretOf(o.keyText, o.secretFmt);
    if (!secret.length) throw new Error(`请填写 ${o.alg} 用的密钥`);
    if (secret.length < s.bits / 8) warn = `⚠ 密钥只有 ${secret.length} 字节，${o.alg} 建议至少 ${s.bits / 8} 字节`;
    sig = hmac(getAlgo('sha' + s.bits), secret, utf8Bytes(input));
  } else {
    const key = await importKey(s, o.alg, o.keyText, 'sign');
    sig = new Uint8Array(await crypto.subtle.sign(signParams(s), key, u8(utf8Bytes(input))));
  }
  return { token: `${input}.${b64url(sig)}`, exp, warn };
}
