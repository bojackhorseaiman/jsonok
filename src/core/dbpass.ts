/**
 * 数据库密码哈希：
 * - MySQL / MariaDB 的 mysql_native_password：* + 大写十六进制的 SHA1(SHA1(密码))，共 41 个字符
 * - PostgreSQL 的 md5：md5 + MD5(密码 + 用户名)
 * - PostgreSQL 的 SCRAM-SHA-256（RFC 5802 / 7677）：SCRAM-SHA-256$迭代次数:盐$StoredKey:ServerKey
 */
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { fromBase64, randomBytes, toBase64, toHex, utf8Bytes } from './bytes.ts';

export type DbKind = 'mysql' | 'pg-scram' | 'pg-md5';

// ================= MySQL / MariaDB =================

export const mysqlNative = (pw: string): string => '*' + toHex(sha1(sha1(utf8Bytes(pw))), true);

// ================= PostgreSQL md5 =================

export const pgMd5 = (pw: string, user: string): string => 'md5' + toHex(md5(utf8Bytes(pw + user)));

// ================= PostgreSQL SCRAM-SHA-256 =================

/** 非 ASCII 的空格，SASLprep 会换成普通空格 */
const NON_ASCII_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
/** SASLprep 规定“映射为空”的字符，直接删除 */
const MAP_TO_NOTHING = /[\u00AD\u034F\u1806\u180B-\u180D\u200B-\u200D\u2060\uFE00-\uFE0F\uFEFF]/g;
/** SASLprep 禁止的字符（控制字符、私用区、代理项等）。PostgreSQL 遇到这些字符时直接使用原密码 */
// eslint-disable-next-line no-control-regex
const PROHIBITED = /[\u0000-\u001F\u007F-\u009F\u0340\u0341\u200E\u200F\u202A-\u202E\u206A-\u206F\uE000-\uF8FF\uFFF9-\uFFFD]/;

/**
 * PostgreSQL 在计算 SCRAM 之前对密码做的 SASLprep 处理（RFC 4013 的常用部分）：
 * 换掉特殊空格、删掉不可见字符、做 NFKC 规范化（例如全角字母变成半角）。
 * 有禁止的字符时，PostgreSQL 按原样使用密码，这里也一样。
 */
export function saslPrep(pw: string): { text: string; changed: boolean; raw: boolean } {
  if (PROHIBITED.test(pw)) return { text: pw, changed: false, raw: true };
  const text = pw.replace(NON_ASCII_SPACE, ' ').replace(MAP_TO_NOTHING, '').normalize('NFKC');
  return { text, changed: text !== pw, raw: false };
}

export interface ScramParts { iter: number; salt: Uint8Array; storedKey: Uint8Array; serverKey: Uint8Array }

export async function scramKeys(pw: string, salt: Uint8Array, iter: number): Promise<{ storedKey: Uint8Array; serverKey: Uint8Array }> {
  if (!Number.isInteger(iter) || iter < 1 || iter > 10_000_000) throw new Error(`迭代次数应该是 1 ~ 10000000 的整数，现在是 ${iter}`);
  const salted = await pbkdf2Async(sha256, utf8Bytes(saslPrep(pw).text), salt, { c: iter, dkLen: 32 });
  const clientKey = hmac(sha256, salted, utf8Bytes('Client Key'));
  return { storedKey: sha256(clientKey), serverKey: hmac(sha256, salted, utf8Bytes('Server Key')) };
}

export const formatScram = (p: ScramParts): string =>
  `SCRAM-SHA-256$${p.iter}:${toBase64(p.salt)}$${toBase64(p.storedKey)}:${toBase64(p.serverKey)}`;

export async function pgScram(pw: string, iter = 4096, salt: Uint8Array = randomBytes(16)): Promise<string> {
  return formatScram({ iter, salt, ...(await scramKeys(pw, salt, iter)) });
}

const SCRAM_RE = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

export function parseScram(s: string): ScramParts {
  const m = SCRAM_RE.exec(s.trim());
  if (!m) throw new Error('不是 SCRAM-SHA-256 哈希：应该像 SCRAM-SHA-256$4096:盐$StoredKey:ServerKey');
  const dec = (x: string) => fromBase64(x).bytes;
  const p = { iter: Number(m[1]), salt: dec(m[2]), storedKey: dec(m[3]), serverKey: dec(m[4]) };
  if (p.storedKey.length !== 32 || p.serverKey.length !== 32) throw new Error('SCRAM-SHA-256 哈希里的两个密钥都应该是 32 字节，可能复制时少了字符');
  return p;
}

// ================= 识别和验证 =================

export interface Detected { kind: DbKind; label: string; norm: string; note?: string }

/** 按格式认出是哪种数据库的哈希 */
export function detectDbHash(hash: string): Detected {
  const h = hash.trim().replace(/^['"]|['"]$/g, '');
  if (/^\*[0-9a-f]{40}$/i.test(h)) return { kind: 'mysql', label: 'MySQL / MariaDB（mysql_native_password）', norm: h.toUpperCase() };
  if (/^[0-9a-f]{40}$/i.test(h)) {
    return { kind: 'mysql', label: 'MySQL / MariaDB（mysql_native_password）', norm: '*' + h.toUpperCase(), note: '没有开头的 *，按 MySQL 哈希处理' };
  }
  if (/^md5[0-9a-f]{32}$/i.test(h)) return { kind: 'pg-md5', label: 'PostgreSQL md5', norm: h.toLowerCase() };
  if (/^SCRAM-SHA-256\$/i.test(h)) return { kind: 'pg-scram', label: 'PostgreSQL SCRAM-SHA-256', norm: h };
  if (/^\*[0-9a-f]+$/i.test(h)) throw new Error(`MySQL 哈希应该是 * 加 40 位十六进制，共 41 个字符，现在是 ${h.length} 个`);
  if (/^[0-9a-f]{16}$/i.test(h)) throw new Error('这是 MySQL 4.1 以前的旧格式（OLD_PASSWORD，16 位），已经不安全，这里不支持');
  if (/^\$A\$/.test(h)) throw new Error('这是 MySQL 8 的 caching_sha2_password 哈希，计算方式没有公开的标准，这里不支持');
  if (/^\$2[aby]\$|^\$scrypt\$/.test(h)) throw new Error('这是 Bcrypt / Scrypt 哈希，请使用“Bcrypt / Scrypt”工具');
  throw new Error('无法识别哈希格式：MySQL 是 * 开头的 41 个字符，PostgreSQL 是 md5 开头的 35 个字符或 SCRAM-SHA-256$ 开头');
}

export async function verifyDb(pw: string, hash: string, user: string): Promise<{ ok: boolean; d: Detected; detail: string }> {
  const d = detectDbHash(hash);
  if (d.kind === 'mysql') return { ok: mysqlNative(pw) === d.norm, d, detail: '' };
  if (d.kind === 'pg-md5') {
    if (!user) throw new Error('PostgreSQL md5 哈希里包含用户名，验证时需要填写用户名');
    return { ok: pgMd5(pw, user) === d.norm, d, detail: `用户名 ${user}` };
  }
  const p = parseScram(d.norm);
  const k = await scramKeys(pw, p.salt, p.iter);
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  return { ok: same(k.storedKey, p.storedKey) && same(k.serverKey, p.serverKey), d, detail: `迭代 ${p.iter} 次，盐 ${p.salt.length} 字节` };
}

// ================= SQL 语句 =================

const myStr = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const pgIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const pgStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface SqlLine { label: string; sql: string }

export function sqlFor(kind: DbKind, hash: string, user: string, host: string): SqlLine[] {
  const u = user || 'username';
  if (kind === 'mysql') {
    const acc = `${myStr(u)}@${myStr(host || '%')}`;
    return [
      { label: 'MySQL 创建用户', sql: `CREATE USER ${acc} IDENTIFIED WITH mysql_native_password AS ${myStr(hash)};` },
      { label: 'MySQL 修改密码', sql: `ALTER USER ${acc} IDENTIFIED WITH mysql_native_password AS ${myStr(hash)};` },
      { label: 'MariaDB 创建用户', sql: `CREATE USER ${acc} IDENTIFIED BY PASSWORD ${myStr(hash)};` },
      { label: 'MariaDB 修改密码', sql: `SET PASSWORD FOR ${acc} = ${myStr(hash)};` },
    ];
  }
  return [
    { label: '创建用户', sql: `CREATE ROLE ${pgIdent(u)} LOGIN PASSWORD ${pgStr(hash)};` },
    { label: '修改密码', sql: `ALTER ROLE ${pgIdent(u)} PASSWORD ${pgStr(hash)};` },
  ];
}
