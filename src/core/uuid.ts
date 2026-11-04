// UUID：生成（v4 / v7 / v3 / v5）和解析（RFC 9562）。随机数用浏览器自带的安全随机数
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { concat, randomBytes, toHex } from './bytes.ts';

/** RFC 9562 规定的 4 个标准命名空间 */
export const NAMESPACES: Record<string, string> = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
};

/** 写入版本号（第 7 个字节的高 4 位）和变体（第 9 个字节的高 2 位 = 10） */
function setVersion(b: Uint8Array, v: number): Uint8Array {
  b[6] = (b[6] & 0x0f) | (v << 4);
  b[8] = (b[8] & 0x3f) | 0x80;
  return b;
}

/** v4：122 位随机数 */
export const v4 = (): Uint8Array => setVersion(randomBytes(16), 4);

/**
 * v7：前 48 位是毫秒时间戳，后面是随机数。
 * 同一毫秒内生成多个时，用 12 位计数器保证严格递增（RFC 9562 第 6.2 节方法 1）；计数器用完就借用下一毫秒。
 */
export function v7Generator(now: () => number = Date.now, rnd: (n: number) => Uint8Array = randomBytes): () => Uint8Array {
  let lastMs = -1;
  let seq = 0;
  return () => {
    let ms = Math.floor(now());
    const b = rnd(16);
    if (ms <= lastMs) {
      // 同一毫秒，或者系统时间往回调了：沿用上一个时间戳，计数器加 1
      ms = lastMs;
      seq++;
      if (seq > 0xfff) {
        ms++;
        seq = 0;
      }
    } else {
      // 新的一毫秒：计数器从随机值开始（只用低 11 位，给递增留出空间）
      seq = ((b[6] << 8) | b[7]) & 0x7ff;
    }
    lastMs = ms;
    for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
    b[6] = 0x70 | (seq >> 8);
    b[7] = seq & 0xff;
    b[8] = (b[8] & 0x3f) | 0x80;
    return b;
  };
}

/** v3 / v5：命名空间 + 名字做哈希，同样的输入永远得到同样的 UUID */
const nameBased = (hash: (d: Uint8Array) => Uint8Array, v: number, ns: Uint8Array, name: Uint8Array): Uint8Array =>
  setVersion(hash(concat(ns, name)).slice(0, 16), v);
export const v3 = (ns: Uint8Array, name: Uint8Array): Uint8Array => nameBased(md5, 3, ns, name);
export const v5 = (ns: Uint8Array, name: Uint8Array): Uint8Array => nameBased(sha1, 5, ns, name);

// ================= 格式 =================

export interface UuidFmt { upper: boolean; hyphen: boolean; braces: boolean }

export function formatUuid(b: Uint8Array, f: UuidFmt = { upper: false, hyphen: true, braces: false }): string {
  const h = toHex(b);
  let s = f.hyphen ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : h;
  if (f.upper) s = s.toUpperCase();
  return f.braces ? `{${s}}` : s;
}

/** 读取 UUID：大小写、带不带横线、大括号 / 小括号、urn:uuid: 前缀都可以 */
export function uuidBytes(input: string): Uint8Array {
  let s = input.trim().replace(/^urn:uuid:/i, '');
  if (/^\{.*\}$/.test(s) || /^\(.*\)$/.test(s)) s = s.slice(1, -1).trim();
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^[0-9a-f]{32}$/i.test(s);
  if (!ok) {
    const bad = /[^0-9a-f-]/i.exec(s);
    const digits = s.replace(/-/g, '').length;
    if (bad) throw new Error(`不是有效的 UUID：包含字符 ${JSON.stringify(bad[0])}`);
    if (digits === 32) throw new Error('不是有效的 UUID：横线的位置不对，应该是 8-4-4-4-12 的格式');
    throw new Error(`不是有效的 UUID：应该是 32 位十六进制，现在是 ${digits} 位`);
  }
  const h = s.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// ================= 解析 =================

export interface UuidInfo {
  canonical: string;
  /** 0 表示 Nil / Max 或非标准 */
  version: number;
  label: string;
  variant: string;
  /** v1 / v6 / v7 里记录的生成时间 */
  time?: Date;
  notes: string[];
}

const LABELS: Record<number, string> = {
  1: 'v1（时间 + MAC 地址）',
  2: 'v2（DCE 安全）',
  3: 'v3（名字 + MD5）',
  4: 'v4（随机）',
  5: 'v5（名字 + SHA-1）',
  6: 'v6（时间，可排序）',
  7: 'v7（时间戳 + 随机，可排序）',
  8: 'v8（自定义）',
};

/** 1582-10-15（公历启用日）到 1970-01-01 之间的 100 纳秒数，v1 / v6 的时间从 1582 年算起 */
const GREGORIAN_OFFSET = 0x01b21dd213814000n;

export function inspectUuid(input: string): UuidInfo {
  const b = uuidBytes(input);
  const canonical = formatUuid(b);
  if (b.every((x) => x === 0)) return { canonical, version: 0, label: 'Nil（全 0）', variant: '', notes: ['特殊值，表示“没有 UUID”'] };
  if (b.every((x) => x === 0xff)) return { canonical, version: 0, label: 'Max（全 F）', variant: '', notes: ['特殊值，常用作“最大值”的占位'] };
  const b8 = b[8];
  const variant = (b8 & 0x80) === 0 ? 'NCS（已废弃）' : (b8 & 0xc0) === 0x80 ? 'RFC 9562' : (b8 & 0xe0) === 0xc0 ? '微软 GUID（旧格式）' : '保留';
  const version = b[6] >> 4;
  if (variant !== 'RFC 9562') {
    return { canonical, version: 0, label: '非标准', variant, notes: [`变体是 ${variant}，版本号没有标准含义`] };
  }
  const label = LABELS[version] ?? `v${version}（未定义的版本）`;
  const notes: string[] = [];
  let time: Date | undefined;
  const big = (i: number, n: number) => {
    let v = 0n;
    for (let k = 0; k < n; k++) v = (v << 8n) | BigInt(b[i + k]);
    return v;
  };
  if (version === 1 || version === 6) {
    const ts = version === 1
      ? ((big(6, 2) & 0x0fffn) << 48n) | (big(4, 2) << 32n) | big(0, 4)
      : (big(0, 4) << 28n) | (big(4, 2) << 12n) | (big(6, 2) & 0x0fffn);
    time = new Date(Number((ts - GREGORIAN_OFFSET) / 10000n));
    const node = [...b.subarray(10)].map((x) => x.toString(16).padStart(2, '0')).join(':');
    notes.push(`时钟序列 ${Number(big(8, 2) & 0x3fffn)}`);
    // 节点第一个字节最低位是 1（组播位）时，说明是随机生成的，不是网卡地址
    notes.push(b[10] & 1 ? `节点 ${node}（随机生成，不是真实 MAC 地址）` : `MAC 地址 ${node}`);
  } else if (version === 7) {
    time = new Date(Number(big(0, 6)));
  }
  return { canonical, version, label, variant, time, notes };
}
