/**
 * htpasswd（Nginx / Apache 的 Basic 认证文件）：每行一个 用户名:哈希。
 * 生成：Bcrypt（$2y$）、APR1-MD5（$apr1$）、SHA-1（{SHA}）
 * 验证：以上三种，另外还能认 MD5-crypt（$1$）、{SSHA}、{PLAIN}
 */
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { concat, fromBase64, randomBytes, toBase64, utf8Bytes } from './bytes.ts';
import { bcryptHash, bcryptVerify } from './kdf.ts';

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 随机盐：8 个字符，取自 ./0-9A-Za-z（256 能被 64 整除，所以分布均匀） */
export const randomSalt = (n = 8): string => [...randomBytes(n)].map((b) => ITOA64[b & 63]).join('');

/**
 * MD5-crypt（Poul-Henning Kamp 的算法）。APR1 是 Apache 的版本，算法相同，只是开头标记换成 $apr1$。
 * 盐最多 8 个字符；固定迭代 1000 次。
 */
export function md5crypt(password: string, salt: string, magic: '$apr1$' | '$1$'): string {
  const pw = utf8Bytes(password);
  const sl = salt.slice(0, 8);
  const s = utf8Bytes(sl);
  const alt = md5(concat(pw, s, pw));
  const parts: Uint8Array[] = [pw, utf8Bytes(magic), s];
  for (let i = pw.length; i > 0; i -= 16) parts.push(alt.subarray(0, Math.min(16, i)));
  for (let i = pw.length; i; i >>= 1) parts.push(i & 1 ? new Uint8Array(1) : pw.subarray(0, 1));
  let fin = md5(concat(...parts));
  for (let i = 0; i < 1000; i++) {
    const p: Uint8Array[] = [i & 1 ? pw : fin];
    if (i % 3) p.push(s);
    if (i % 7) p.push(pw);
    p.push(i & 1 ? fin : pw);
    fin = md5(concat(...p));
  }
  let out = '';
  const to64 = (v: number, n: number) => {
    for (; n > 0; n--, v >>= 6) out += ITOA64[v & 0x3f];
  };
  for (const [a, b, c] of [[0, 6, 12], [1, 7, 13], [2, 8, 14], [3, 9, 15], [4, 10, 5]]) to64((fin[a] << 16) | (fin[b] << 8) | fin[c], 4);
  to64(fin[11], 2);
  return `${magic}${sl}$${out}`;
}

export const apr1 = (pw: string, salt: string = randomSalt()): string => md5crypt(pw, salt, '$apr1$');
export const shaHash = (pw: string): string => '{SHA}' + toBase64(sha1(utf8Bytes(pw)));

export type HtAlgo = 'bcrypt' | 'apr1' | 'sha1';

export async function htHash(pw: string, algo: HtAlgo, cost = 10): Promise<string> {
  if (algo === 'bcrypt') return bcryptHash(pw, { cost, prefix: '2y' });
  if (algo === 'apr1') return apr1(pw);
  return shaHash(pw);
}

// ================= 解析 =================

export interface Account { user: string; pw: string; line: number }

/** 生成用的输入：每行 用户名:密码，按第一个冒号分开（用户名不能有冒号，密码可以有） */
export function parseAccounts(text: string): { list: Account[]; warns: string[] } {
  const list: Account[] = [];
  const warns: string[] = [];
  const seen = new Map<string, number>();
  text.split('\n').forEach((raw, i) => {
    const l = raw.replace(/\r$/, '');
    if (!l.trim()) return;
    const n = i + 1;
    const k = l.indexOf(':');
    if (k < 0) throw new Error(`第 ${n} 行缺少冒号：格式应该是 用户名:密码，例如 admin:123456`);
    const user = l.slice(0, k).trim();
    const pw = l.slice(k + 1);
    if (!user) throw new Error(`第 ${n} 行没有用户名`);
    if (/\s/.test(user)) throw new Error(`第 ${n} 行的用户名“${user}”里有空格，Nginx / Apache 不支持`);
    if (utf8Bytes(user).length > 255) throw new Error(`第 ${n} 行的用户名太长，最多 255 个字节`);
    if (!pw) warns.push(`${user} 的密码是空的`);
    const first = seen.get(user);
    if (first) warns.push(`用户名 ${user} 在第 ${first} 行和第 ${n} 行重复，服务器只认第一个`);
    else seen.set(user, n);
    list.push({ user, pw, line: n });
  });
  if (!list.length) throw new Error('请输入账号，每行一个：用户名:密码');
  return { list, warns };
}

export interface HtEntry { user: string; hash: string; line: number }

/** 读取 htpasswd 文件：跳过空行和 # 注释；没有冒号的单独一行当作只有哈希 */
export function parseHtpasswd(text: string): HtEntry[] {
  const out: HtEntry[] = [];
  text.split('\n').forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith('#')) return;
    const k = l.indexOf(':');
    if (k < 0) out.push({ user: '', hash: l, line: i + 1 });
    else out.push({ user: l.slice(0, k), hash: l.slice(k + 1).split(':')[0].trim(), line: i + 1 });
  });
  return out;
}

// ================= 验证 =================

const LABEL = {
  bcrypt: 'Bcrypt',
  apr1: 'APR1-MD5',
  md5crypt: 'MD5-crypt（$1$）',
  sha1: 'SHA-1（{SHA}）',
  ssha: '加盐 SHA-1（{SSHA}）',
  plain: '明文（{PLAIN}）',
};

export async function htVerify(pw: string, hash: string): Promise<{ ok: boolean; label: string }> {
  const h = hash.trim();
  if (/^\$2[aby]\$/.test(h)) {
    const r = await bcryptVerify(pw, h);
    return { ok: r.ok, label: `${LABEL.bcrypt} ${r.info.prefix}，强度 ${r.info.cost}` };
  }
  const mc = /^(\$apr1\$|\$1\$)([^$]{1,8})\$([./0-9A-Za-z]{22})$/.exec(h);
  if (mc) return { ok: md5crypt(pw, mc[2], mc[1] as '$1$') === h, label: mc[1] === '$1$' ? LABEL.md5crypt : LABEL.apr1 };
  if (/^\$apr1\$|^\$1\$/.test(h)) throw new Error('APR1 / MD5-crypt 哈希格式不对：应该像 $apr1$8位盐$22位哈希，可能复制时少了字符');
  if (h.startsWith('{SHA}')) return { ok: shaHash(pw) === h, label: LABEL.sha1 };
  if (h.startsWith('{SSHA}')) {
    const b = fromBase64(h.slice(6)).bytes;
    if (b.length <= 20) throw new Error('{SSHA} 哈希太短，应该是 20 字节哈希加上盐');
    const salt = b.subarray(20);
    const want = sha1(concat(utf8Bytes(pw), salt));
    return { ok: want.every((x, i) => x === b[i]), label: LABEL.ssha };
  }
  if (h.startsWith('{PLAIN}')) return { ok: h.slice(7) === pw, label: LABEL.plain };
  if (/^\$[56]\$/.test(h)) throw new Error('这是 SHA-256 / SHA-512 crypt（$5$ / $6$）哈希，暂不支持验证');
  if (/^[./0-9A-Za-z]{13}$/.test(h)) throw new Error('这像是传统的 crypt（DES）哈希：只用密码的前 8 个字符，已经不安全，这里不支持');
  throw new Error('无法识别哈希格式：htpasswd 里常见的是 $2y$（Bcrypt）、$apr1$（APR1-MD5）、{SHA}（SHA-1）开头');
}
