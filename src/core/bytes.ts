// 字节相关的基础工具：UTF-8、十六进制、Base64、随机数、文件类型识别。纯函数，浏览器和 Node 都能用

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8Bytes = (s: string): Uint8Array => encoder.encode(s);
export const utf8Text = (b: Uint8Array): string => decoder.decode(b);

export function isUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ================= 十六进制 =================

const HEX = '0123456789abcdef';

export function toHex(b: Uint8Array, upper = false, sep = ''): string {
  const out = new Array<string>(b.length);
  for (let i = 0; i < b.length; i++) out[i] = HEX[b[i] >> 4] + HEX[b[i] & 15];
  const s = out.join(sep);
  return upper ? s.toUpperCase() : s;
}

/** 宽松的十六进制解析：忽略空格、逗号、冒号、换行，以及 0x、\x、% 前缀 */
export function fromHex(s: string): Uint8Array {
  const t = s.replace(/0x|\\x|%/gi, '').replace(/[\s,:;]/g, '');
  const bad = /[^0-9a-f]/i.exec(t);
  if (bad) throw new Error(`不是有效的十六进制：包含字符 ${JSON.stringify(bad[0])}`);
  if (t.length % 2) throw new Error(`十六进制的位数应为偶数（每 2 位表示 1 个字节），现在是 ${t.length} 位`);
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

// ================= Base64 =================

export function toBase64(b: Uint8Array, urlSafe = false, pad = true): string {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  let s = btoa(bin);
  if (urlSafe) s = s.replace(/\+/g, '-').replace(/\//g, '_');
  if (!pad) s = s.replace(/=+$/, '');
  return s;
}

export interface B64In { bytes: Uint8Array; mime?: string }

/** 宽松的 Base64 解析：支持 Data URI 前缀、换行、URL Safe 字符、缺少末尾的 = */
export function fromBase64(s: string): B64In {
  let t = s.trim();
  let mime: string | undefined;
  let offset = s.indexOf(t);
  const m = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(t);
  if (m) {
    if (!/;base64$/i.test(m[2])) throw new Error('这个 Data URI 不是 Base64 编码的（缺少 ;base64）');
    mime = m[1] || undefined;
    t = t.slice(m[0].length);
    offset += m[0].length;
  }
  const bad = /[^A-Za-z0-9+/=_\-\s]/.exec(t);
  if (bad) throw new Error(`不是有效的 Base64：第 ${offset + bad.index + 1} 个字符 ${JSON.stringify(bad[0])} 不属于 Base64 字符`);
  t = t.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (t.includes('=')) throw new Error('不是有效的 Base64：= 只能出现在末尾');
  if (t.length % 4 === 1) throw new Error('Base64 的长度不对，可能复制时少了或多了字符');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, mime };
}

// ================= 随机数 =================

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

/** 0 ~ max-1 的均匀随机整数（拒绝采样，没有取模偏差） */
export function randomInt(max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

// ================= 文件类型识别（按文件头） =================

export interface FileKind { ext: string; mime: string; label: string }

type Sig = [ext: string, mime: string, label: string, test: (b: Uint8Array) => boolean];

const at = (b: Uint8Array, off: number, sig: number[] | string): boolean => {
  const arr = typeof sig === 'string' ? [...sig].map((c) => c.charCodeAt(0)) : sig;
  if (b.length < off + arr.length) return false;
  return arr.every((v, i) => b[off + i] === v);
};
const ftyp = (b: Uint8Array, brands: string[]) => at(b, 4, 'ftyp') && brands.some((x) => at(b, 8, x));

const SIGS: Sig[] = [
  ['png', 'image/png', 'PNG 图片', (b) => at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['jpg', 'image/jpeg', 'JPEG 图片', (b) => at(b, 0, [0xff, 0xd8, 0xff])],
  ['gif', 'image/gif', 'GIF 图片', (b) => at(b, 0, 'GIF87a') || at(b, 0, 'GIF89a')],
  ['webp', 'image/webp', 'WebP 图片', (b) => at(b, 0, 'RIFF') && at(b, 8, 'WEBP')],
  ['bmp', 'image/bmp', 'BMP 图片', (b) => at(b, 0, 'BM') && b.length > 26],
  ['ico', 'image/x-icon', 'ICO 图标', (b) => at(b, 0, [0, 0, 1, 0]) && b.length > 6],
  ['avif', 'image/avif', 'AVIF 图片', (b) => ftyp(b, ['avif', 'avis'])],
  ['heic', 'image/heic', 'HEIC 图片', (b) => ftyp(b, ['heic', 'heix', 'mif1'])],
  ['tif', 'image/tiff', 'TIFF 图片', (b) => at(b, 0, [0x49, 0x49, 0x2a, 0]) || at(b, 0, [0x4d, 0x4d, 0, 0x2a])],
  ['pdf', 'application/pdf', 'PDF 文档', (b) => at(b, 0, '%PDF-')],
  ['zip', 'application/zip', 'ZIP 压缩包（也可能是 docx / xlsx / apk / jar）', (b) => at(b, 0, [0x50, 0x4b, 3, 4]) || at(b, 0, [0x50, 0x4b, 5, 6])],
  ['gz', 'application/gzip', 'Gzip 压缩数据', (b) => at(b, 0, [0x1f, 0x8b])],
  ['7z', 'application/x-7z-compressed', '7z 压缩包', (b) => at(b, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
  ['rar', 'application/vnd.rar', 'RAR 压缩包', (b) => at(b, 0, 'Rar!')],
  ['mp3', 'audio/mpeg', 'MP3 音频', (b) => at(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && b.length > 4)],
  ['wav', 'audio/wav', 'WAV 音频', (b) => at(b, 0, 'RIFF') && at(b, 8, 'WAVE')],
  ['mp4', 'video/mp4', 'MP4 视频', (b) => at(b, 4, 'ftyp')],
  ['webm', 'video/webm', 'WebM / MKV 视频', (b) => at(b, 0, [0x1a, 0x45, 0xdf, 0xa3])],
  ['woff2', 'font/woff2', 'WOFF2 字体', (b) => at(b, 0, 'wOF2')],
  ['woff', 'font/woff', 'WOFF 字体', (b) => at(b, 0, 'wOFF')],
  ['exe', 'application/vnd.microsoft.portable-executable', 'Windows 程序（exe / dll）', (b) => at(b, 0, 'MZ') && b.length > 64],
  ['class', 'application/java-vm', 'Java class 文件', (b) => at(b, 0, [0xca, 0xfe, 0xba, 0xbe])],
  ['wasm', 'application/wasm', 'WebAssembly', (b) => at(b, 0, [0, 0x61, 0x73, 0x6d])],
  ['sqlite', 'application/vnd.sqlite3', 'SQLite 数据库', (b) => at(b, 0, 'SQLite format 3\0')],
  ['torrent', 'application/x-bittorrent', 'BT 种子文件', (b) => at(b, 0, 'd8:announce') || at(b, 0, 'd4:info') || at(b, 0, 'd13:announce-list')],
];

export function detectType(b: Uint8Array): FileKind | null {
  for (const [ext, mime, label, test] of SIGS) if (test(b)) return { ext, mime, label };
  return null;
}

/** 字节数据看起来是不是文本：已知的二进制格式、或控制字符太多都算二进制 */
export function looksLikeText(text: string, b: Uint8Array): boolean {
  if (detectType(b)) return false;
  if (!text.length) return true;
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) bad++;
  }
  return bad / text.length < 0.02;
}

/** 十六进制预览：每行 16 字节，带偏移和 ASCII */
export function hexDump(b: Uint8Array, max = 256): string {
  const lines: string[] = [];
  const n = Math.min(b.length, max);
  for (let i = 0; i < n; i += 16) {
    const row = b.subarray(i, Math.min(i + 16, n));
    const hex = toHex(row, false, ' ').padEnd(47, ' ');
    const ascii = [...row].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  if (b.length > max) lines.push(`…… 共 ${b.length} 字节，只显示前 ${max} 字节`);
  return lines.join('\n');
}

export const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
