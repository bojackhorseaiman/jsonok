// 文本类编解码：URL、HTML 实体、escape、UTF-8 字节写法、十六进制、摩斯密码、下载链接、邮箱防爬
import { fromBase64, fromHex, toBase64, toHex, utf8Bytes } from './bytes.ts';
import { type Charset, decodeStrict, encodeText } from './charset.ts';

// ================= URL 编解码 =================

export type UrlMode = 'component' | 'uri' | 'form' | 'all';

const KEEP: Record<UrlMode, RegExp> = {
  component: /[A-Za-z0-9\-_.!~*'()]/,
  uri: /[A-Za-z0-9\-_.!~*'();,/?:@&=+$#]/,
  form: /[A-Za-z0-9*\-._]/,
  all: /(?!)/,
};

export interface EncodeResult { text: string; lossy: number }

export function urlEncode(s: string, mode: UrlMode, cs: Charset, upper = true): EncodeResult {
  let out = '';
  let lossy = 0;
  const pct = (b: number) => '%' + (upper ? b.toString(16).toUpperCase() : b.toString(16)).padStart(2, '0');
  for (const ch of s) {
    if (ch.length === 1 && KEEP[mode].test(ch)) { out += ch; continue; }
    if (mode === 'form' && ch === ' ') { out += '+'; continue; }
    const e = encodeText(ch, cs);
    lossy += e.lossy;
    for (const b of e.bytes) out += pct(b);
  }
  return { text: out, lossy };
}

/** 解码一次。plusSpace：把 + 当作空格（表单格式） */
export function urlDecode(s: string, cs: Charset, plusSpace: boolean): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '%') {
      const h = s.substr(i + 1, 2);
      if (!/^[0-9a-fA-F]{2}$/.test(h)) {
        throw new Error(`第 ${i + 1} 个字符：% 后面应该是两位十六进制（例如 %20），这里是 ${JSON.stringify('%' + h)}`);
      }
      bytes.push(parseInt(h, 16));
      i += 2;
    } else if (c === '+' && plusSpace) {
      bytes.push(0x20);
    } else {
      const cp = s.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      if (ch.length === 2) i++;
      bytes.push(...encodeText(ch, cs).bytes);
    }
  }
  return decodeStrict(Uint8Array.from(bytes), cs);
}

/** 自动多次解码：结果里仍有 %XX 时继续解，最多 5 次 */
export function urlDecodeDeep(s: string, cs: Charset, plusSpace: boolean): { text: string; times: number } {
  let text = urlDecode(s, cs, plusSpace);
  let times = 1;
  while (times < 5 && /%[0-9a-fA-F]{2}/.test(text)) {
    try {
      const next = urlDecode(text, cs, plusSpace);
      if (next === text) break;
      text = next;
      times++;
    } catch {
      break;
    }
  }
  return { text, times };
}

// ================= HTML 实体 =================

/** 常用的命名实体（完整列表有 2000 多个，这里收录最常见的） */
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', middot: '·', bull: '•',
  times: '×', divide: '÷', deg: '°', plusmn: '±', sup1: '¹', sup2: '²', sup3: '³', frac12: '½', frac14: '¼',
  frac34: '¾', permil: '‰', prime: '′', Prime: '″', micro: 'µ', para: '¶', sect: '§', cent: '¢', pound: '£',
  yen: '¥', euro: '€', curren: '¤', iexcl: '¡', iquest: '¿', brvbar: '¦', uml: '¨', macr: '¯', acute: '´',
  cedil: '¸', ordf: 'ª', ordm: 'º', not: '¬', shy: '\u00ad', dagger: '†', Dagger: '‡', loz: '◊',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔',
  spades: '♠', clubs: '♣', hearts: '♥', diams: '♦', star: '☆', check: '✓',
  forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇', isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑',
  minus: '−', lowast: '∗', radic: '√', prop: '∝', infin: '∞', ang: '∠', and: '∧', or: '∨', cap: '∩', cup: '∪',
  int: '∫', there4: '∴', sim: '∼', cong: '≅', asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥', sub: '⊂',
  sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅', lceil: '⌈',
  rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '〈', rang: '〉', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι',
  Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ',
  Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  omicron: 'ο', pi: 'π', rho: 'ρ', sigmaf: 'ς', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ',
};
const REVERSE = new Map<string, string>(Object.entries(NAMED).map(([k, v]) => [v, k]));

export type EntityScope = 'basic' | 'nonascii' | 'all';
export type EntityStyle = 'named' | 'dec' | 'hex';

export function entityEncode(s: string, scope: EntityScope, style: EntityStyle): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const basic = ch === '&' || ch === '<' || ch === '>' || ch === '"' || ch === "'";
    const need = basic || (scope === 'nonascii' && cp > 0x7e) || (scope === 'all' && ch !== '\n' && ch !== '\r' && ch !== '\t');
    if (!need) { out += ch; continue; }
    const name = REVERSE.get(ch);
    if (style === 'named' && name) out += `&${name};`;
    else if (style === 'hex') out += `&#x${cp.toString(16)};`;
    else out += `&#${cp};`;
  }
  return out;
}

export function entityDecode(s: string): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const text = s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, e)) return NAMED[e];
    unknown.add(m);
    return m;
  });
  return { text, unknown: [...unknown] };
}

// ================= JS escape / unescape =================

export const jsEscape = (s: string): string => escape(s);

export const jsUnescape = (s: string): string => unescape(s);

// ================= UTF-8（字节写法） =================

export type ByteFmt = 'x' | 'pct' | 'hex0x' | 'space' | 'dec' | 'bin';

export const BYTE_FMT_OPTS: [ByteFmt, string][] = [
  ['x', '\\xE4\\xB8\\xAD'],
  ['pct', '%E4%B8%AD'],
  ['hex0x', '0xE4, 0xB8, 0xAD'],
  ['space', 'E4 B8 AD'],
  ['dec', '[228, 184, 173]'],
  ['bin', '11100100 10111000 …'],
];

/** 文本 → 字节写法。asciiKeep：\x 和 % 写法下，ASCII 字符保持原样 */
export function bytesFormat(s: string, cs: Charset, fmt: ByteFmt, upper: boolean, asciiKeep: boolean): EncodeResult {
  const hx = (b: number) => (upper ? b.toString(16).toUpperCase() : b.toString(16)).padStart(2, '0');
  if (fmt === 'x' || fmt === 'pct') {
    const pre = fmt === 'x' ? '\\x' : '%';
    let out = '';
    let lossy = 0;
    for (const ch of s) {
      if (asciiKeep && ch.charCodeAt(0) < 0x80 && !(fmt === 'pct' && ch === '%') && !(fmt === 'x' && ch === '\\')) { out += ch; continue; }
      const e = encodeText(ch, cs);
      lossy += e.lossy;
      for (const b of e.bytes) out += pre + hx(b);
    }
    return { text: out, lossy };
  }
  const e = encodeText(s, cs);
  const arr = [...e.bytes];
  let text: string;
  if (fmt === 'hex0x') text = arr.map((b) => '0x' + hx(b)).join(', ');
  else if (fmt === 'space') text = arr.map(hx).join(' ');
  else if (fmt === 'dec') text = `[${arr.join(', ')}]`;
  else text = arr.map((b) => b.toString(2).padStart(8, '0')).join(' ');
  return { text, lossy: e.lossy };
}

/** 字节写法 → 文本：自动识别 \x、%、0x、十进制数组、二进制、纯十六进制 */
export function bytesParse(s: string, cs: Charset): { text: string; fmt: string } {
  const t = s.trim();
  let bytes: Uint8Array;
  let fmt: string;
  if (/^([01]{8}[\s,]*)+$/.test(t)) {
    bytes = Uint8Array.from(t.split(/[\s,]+/).filter(Boolean).map((x) => parseInt(x, 2)));
    fmt = '二进制';
  } else if (/^\[?\s*\d{1,3}(\s*[,\s]\s*\d{1,3})*\s*\]?$/.test(t) && (t.includes(',') || t.startsWith('['))) {
    // 十进制字节：要有逗号或方括号，避免和“E4 B8 AD”这种空格分隔的十六进制混淆
    const nums = t.replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
    const bad = nums.find((n) => n > 255);
    if (bad !== undefined) throw new Error(`十进制字节应在 0~255 之间，这里有 ${bad}`);
    bytes = Uint8Array.from(nums);
    fmt = '十进制字节';
  } else if (/\\x[0-9a-fA-F]{2}|%[0-9a-fA-F]{2}/.test(t)) {
    // \x 或 % 写法，中间可以夹着普通字符
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const m = /^(\\x|%)([0-9a-fA-F]{2})/.exec(s.slice(i, i + 4));
      if (m) { out.push(parseInt(m[2], 16)); i += m[0].length - 1; continue; }
      const cp = s.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      if (ch.length === 2) i++;
      out.push(...encodeText(ch, cs).bytes);
    }
    bytes = Uint8Array.from(out);
    fmt = /\\x/.test(t) ? '\\x 写法' : '% 写法';
  } else {
    bytes = fromHex(t);
    fmt = '十六进制';
  }
  return { text: decodeStrict(bytes, cs), fmt };
}

// ================= 十六进制 ⇄ 文本 =================

export type HexSep = 'none' | 'space' | 'x' | '0x' | 'comma';

export function textToHex(s: string, cs: Charset, sep: HexSep, upper: boolean): EncodeResult {
  const e = encodeText(s, cs);
  const h = toHex(e.bytes, upper);
  const pairs = h.match(/.{2}/g) ?? [];
  const text =
    sep === 'none' ? h
      : sep === 'space' ? pairs.join(' ')
        : sep === 'x' ? pairs.map((p) => '\\x' + p).join('')
          : sep === '0x' ? pairs.map((p) => '0x' + p).join(' ')
            : pairs.map((p) => '0x' + p).join(', ');
  return { text, lossy: e.lossy };
}

export const hexToText = (s: string, cs: Charset): string => decodeStrict(fromHex(s), cs);

// ================= 摩斯密码 =================

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-',
  L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-',
  W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-', '"': '.-..-.',
  $: '...-..-', '@': '.--.-.',
};
const MORSE_REV = new Map(Object.entries(MORSE).map(([k, v]) => [v, k]));

export interface MorseOpt { dot: string; dash: string; letterSep: string; wordSep: string }

export function morseEncode(s: string, o: MorseOpt): { text: string; skipped: string[] } {
  const skipped = new Set<string>();
  const words = s.trim().split(/\s+/).filter(Boolean).map((w) =>
    [...w.toUpperCase()]
      .map((ch) => {
        const m = MORSE[ch];
        if (!m) { skipped.add(ch); return ''; }
        return m.replace(/\./g, o.dot).replace(/-/g, o.dash);
      })
      .filter(Boolean)
      .join(o.letterSep),
  );
  return { text: words.filter(Boolean).join(o.wordSep), skipped: [...skipped] };
}

export function morseDecode(s: string, lower: boolean): { text: string; unknown: string[] } {
  const norm = s
    .replace(/[·•∙⋅]/g, '.')
    .replace(/[−—–_]/g, '-')
    .trim();
  const unknown = new Set<string>();
  const words = norm.split(/\s*[/|]\s*|\s{3,}|\n+/).filter((w) => w.trim());
  const text = words
    .map((w) =>
      w.trim().split(/\s+/).map((code) => {
        if (!/^[.-]+$/.test(code)) { unknown.add(code); return '?'; }
        const ch = MORSE_REV.get(code);
        if (!ch) { unknown.add(code); return '?'; }
        return ch;
      }).join(''),
    )
    .join(' ');
  return { text: lower ? text.toLowerCase() : text, unknown: [...unknown] };
}

// ================= 迅雷 / 快车 / 旋风 下载链接 =================

export interface LinkInfo { kind: string; url: string }

function b64Text(b64: string): string {
  const { bytes } = fromBase64(b64);
  try {
    return decodeStrict(bytes, 'utf-8');
  } catch {
    return decodeStrict(bytes, 'gbk'); // 早期的链接大多是 GBK 编码
  }
}

export function decodeDownloadLink(link: string): LinkInfo {
  const s = link.trim();
  let m: RegExpExecArray | null;
  if ((m = /^thunder:\/\/([A-Za-z0-9+/=_-]+)/i.exec(s))) {
    const t = b64Text(m[1]);
    return { kind: '迅雷', url: t.replace(/^AA/, '').replace(/ZZ$/, '') };
  }
  if ((m = /^flashget:\/\/([A-Za-z0-9+/=_-]+)/i.exec(s))) {
    const t = b64Text(m[1]);
    return { kind: '快车', url: t.replace(/^\[FLASHGET\]/i, '').replace(/\[FLASHGET\]$/i, '') };
  }
  if ((m = /^qqdl:\/\/([A-Za-z0-9+/=_-]+)/i.exec(s))) {
    return { kind: '旋风', url: b64Text(m[1]) };
  }
  throw new Error('不是迅雷（thunder://）、快车（flashget://）或旋风（qqdl://）链接');
}

export function encodeDownloadLinks(url: string): LinkInfo[] {
  const u = url.trim();
  const b = (s: string) => toBase64(utf8Bytes(s));
  return [
    { kind: '迅雷', url: 'thunder://' + b('AA' + u + 'ZZ') },
    { kind: '快车', url: 'flashget://' + b('[FLASHGET]' + u + '[FLASHGET]') },
    { kind: '旋风', url: 'qqdl://' + b(u) },
  ];
}

// ================= 邮箱地址防爬 =================

export type EmailStyle = 'entity' | 'js' | 'text' | 'css';

export const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export function emailObfuscate(email: string, style: EmailStyle): string {
  const ent = (s: string) => [...s].map((c) => `&#${c.codePointAt(0)};`).join('');
  if (style === 'entity') return `<a href="${ent('mailto:' + email)}">${ent(email)}</a>`;
  if (style === 'text') return email.replace('@', ' [at] ').replace(/\./g, ' [dot] ');
  if (style === 'css') {
    const rev = [...email].reverse().join('');
    return `<span style="unicode-bidi:bidi-override;direction:rtl">${rev.replace(/</g, '&lt;')}</span>`;
  }
  const [user, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)];
  const parts = (s: string) => s.match(/.{1,3}/g)!.map((p) => JSON.stringify(p)).join(' + ');
  return `<script>\n  (function () {\n    var u = ${parts(user)};\n    var d = ${parts(domain)};\n    var e = u + '@' + d;\n    document.write('<a href="mailto:' + e + '">' + e + '</a>');\n  })();\n</script>`;
}
