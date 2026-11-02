// PEM 文本和 DER 字节互转（不依赖第三方库）
import { fromBase64, toBase64 } from './bytes.ts';

export interface KeyData {
  /** PEM 的类型，例如 PUBLIC KEY、RSA PRIVATE KEY；只粘贴了 Base64 时为 null */
  label: string | null;
  der: Uint8Array;
}

export function parsePem(text: string): KeyData | null {
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!m) return null;
  // 去掉 Proc-Type 这类头部行
  const body = m[2].replace(/^[A-Za-z-]+:.*$/gm, '');
  return { label: m[1], der: fromBase64(body).bytes };
}

export function toPem(label: string, der: Uint8Array): string {
  const b = toBase64(der);
  return `-----BEGIN ${label}-----\n${(b.match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;
}

/** PEM，或者只有中间 Base64 的内容 → DER */
export function readKey(text: string): KeyData {
  const pem = parsePem(text);
  if (pem) return pem;
  const t = text.replace(/\s+/g, '');
  if (/-----BEGIN/.test(text)) throw new Error('PEM 不完整：没有找到对应的 -----END …----- 结尾');
  if (!t || !/^[A-Za-z0-9+/=_-]+$/.test(t)) throw new Error('无法识别密钥：请粘贴 PEM 格式（-----BEGIN … -----），或者只有中间 Base64 的部分');
  return { label: null, der: fromBase64(t).bytes };
}
