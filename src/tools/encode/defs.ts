// 编码 / 加密类工具的定义（3.1 文本编码）。具体的转换逻辑在 src/core 里，用到时才加载
import { escapeHtml } from '../../core/text';
import { ALGO_INFO, COMMON_FILE, COMMON_HASH } from '../../core/hashList';
import type { OptDef, Opts, Result, RunCtx, ToolDef } from '../json/types';
import { bool, str } from '../json/types';

const tc = () => import('../../core/textcodec');
const bx = () => import('../../core/basex');
const by = () => import('../../core/bytes');
const cs = () => import('../../core/charset');
const hs = () => import('../../core/hash');

type Charset = 'utf-8' | 'gbk' | 'utf-16le' | 'utf-16be' | 'latin1';
const CHARSETS: [string, string][] = [['utf-8', 'UTF-8'], ['gbk', 'GBK'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE'], ['latin1', 'ISO-8859-1']];
const O_CS: OptDef = { key: 'cs', label: '字符编码', type: 'select', options: CHARSETS, def: 'utf-8', title: '文字和字节互转时使用的编码；国内老系统的数据常用 GBK' };
const O_UPPER: OptDef = { key: 'upper', label: '大写字母', type: 'check', def: true };
const TEXT = { jsonIn: () => false } as const;
const onDir = (...d: string[]) => (_o: Opts, x: string) => d.includes(x);
const charset = (o: Opts) => str(o, 'cs') as Charset;
const join = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' · ');
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const lossyNote = (n: number, o: Opts) => (n ? `⚠ ${n} 个字符无法用 ${CHARSETS.find(([v]) => v === str(o, 'cs'))?.[1]} 表示，已替换成 ?` : '');
const help = (rows: [string, string][], intro = '') =>
  (intro ? `<p>${intro}</p>` : '') + `<table class="help-t">${rows.map(([a, b]) => `<tr><td><code>${escapeHtml(a)}</code></td><td>${escapeHtml(b)}</td></tr>`).join('')}</table>`;

/** 字节结果：能当文本显示就显示文本，否则当作文件（可以预览图片、下载） */
async function bytesOut(bytes: Uint8Array, c: Charset, base: string, note = '', mimeHint?: string): Promise<Result> {
  const [B, C] = await Promise.all([by(), cs()]);
  const kind = B.detectType(bytes);
  const binaryHint = !!mimeHint && !/^text\/|json|xml|javascript/.test(mimeHint);
  if (!kind && !binaryHint) {
    try {
      const text = C.decodeBytes(bytes, c, true);
      if (B.looksLikeText(text, bytes)) return { kind: 'text', text, note };
    } catch {
      // 不是这种编码的文本，按二进制处理
    }
  }
  const mime = kind?.mime ?? mimeHint ?? 'application/octet-stream';
  const ext = (kind?.ext ?? (mimeHint ? mimeHint.split('/')[1]?.split(/[+;]/)[0] : '')) || 'bin';
  const label = kind?.label ?? (mimeHint ? `${mimeHint} 文件` : '二进制数据（不是文本）');
  return { kind: 'bin', bytes, mime, name: `${base}.${ext}`, text: B.hexDump(bytes, 512), note: join(`结果是 ${label}，${size(bytes.length)}`, note) };
}

// ================= Base64 =================

const base64: ToolDef = {
  ...TEXT,
  dirs: [['encode', '编码'], ['decode', '解码']],
  flip: { encode: 'decode', decode: 'encode' },
  opts: [
    O_CS,
    { key: 'urlSafe', label: 'URL Safe', type: 'check', def: false, title: '用 - 和 _ 代替 + 和 /，可以直接放进网址', show: onDir('encode') },
    { key: 'noPad', label: '去掉末尾的 =', type: 'check', def: false, show: onDir('encode') },
    { key: 'wrap', label: '每 76 个字符换行', type: 'check', def: false, title: '邮件（MIME）使用的格式', show: onDir('encode') },
    { key: 'dataUri', label: '文件输出为 Data URI', type: 'check', def: true, title: '编码文件时输出 data:类型;base64,…，可以直接放进 <img src="…">', show: onDir('encode') },
  ],
  inTitles: (d) => [d === 'encode' ? '输入文字（也可以打开任意文件）' : '输入 Base64（支持 Data URI）'],
  outTitle: (d) => (d === 'encode' ? 'Base64' : '解码结果'),
  placeholder: (d) => (d === 'encode' ? '输入要编码的文字，或点“打开文件”选择图片等任意文件…' : '粘贴 Base64 或 data:image/png;base64,… ；解码出来是图片会直接显示预览'),
  sample: (d) => [d === 'encode' ? "快JSON：数据只在本地处理 ✓" : "5b+rSlNPTu+8muaVsOaNruWPquWcqOacrOWcsOWkhOeQhiDinJM="],
  accept: '*/*',
  readFile: (f, d) => {
    const textLike = /^text\//.test(f.type) || /\.(txt|b64|base64|json|csv|log)$/i.test(f.name);
    if (d === 'decode' && textLike) return null;
    return f.arrayBuffer().then((buf) => ({
      text: `📎 已载入文件：${f.name}（${size(buf.byteLength)}）\n现在编码的是这个文件的内容。在这里改动文字会取消文件，改为编码文字。`,
      bin: new Uint8Array(buf),
      dir: 'encode',
      note: `已载入 ${f.name}，右侧是文件内容的 Base64`,
    }));
  },
  help: '<p>编码：可以编码文字，也可以点“打开文件”编码图片等任意文件（文件不会上传）。解码：结果是图片会直接显示预览，其他文件可以下载。中文乱码时，把“字符编码”改成 GBK 试试。</p>',
  run: async (c) => {
    const [B, C] = await Promise.all([by(), cs()]);
    if (c.dir === 'encode') {
      let bytes: Uint8Array;
      let lossy = 0;
      if (c.file) bytes = c.file.bytes;
      else {
        const e = C.encodeText(c.src[0], charset(c.o));
        bytes = e.bytes;
        lossy = e.lossy;
      }
      let text = B.toBase64(bytes, bool(c.o, 'urlSafe'), !bool(c.o, 'noPad'));
      if (bool(c.o, 'wrap')) text = text.replace(/.{76}(?=.)/g, '$&\n');
      if (c.file && bool(c.o, 'dataUri')) text = `data:${c.file.type || B.detectType(bytes)?.mime || 'application/octet-stream'};base64,${text}`;
      return { kind: 'text', text, note: join(c.file ? `文件 ${c.file.name}` : '', `${size(bytes.length)} → ${text.length} 个字符`, lossyNote(lossy, c.o)) };
    }
    const r = B.fromBase64(c.src[0]);
    return bytesOut(r.bytes, charset(c.o), 'kuaijson-base64', r.mime ? `Data URI 类型 ${r.mime}` : '', r.mime);
  },
  ext: () => 'txt',
};

// ================= Base32 / 58 / 62 / 85 / 100 =================

const BASEX_SAMPLE: Record<string, string> = {"base32": "JBSWY3DPFQQOLP5LJJJU6TRB", "base58": "32UWxgjUxdDKzaEC5RxyN", "base62": "X5HJSwXeAXJHFHF5VXI9", "base85": "87cURD_*$m^T0t*:JN&", "base100": "🐿👜👣👣👦🐣🐗📜💶💢👁👊👆👅🐘"};

const basex: ToolDef = {
  ...TEXT,
  dirs: [['encode', '编码'], ['decode', '解码']],
  flip: { encode: 'decode', decode: 'encode' },
  opts: [
    { key: 'kind', label: '编码方式', type: 'select', options: [['base32', 'Base32'], ['base58', 'Base58（比特币）'], ['base62', 'Base62'], ['base85', 'Base85（Ascii85）'], ['base100', 'Base100（emoji）']], def: 'base58' },
    O_CS,
  ],
  outTitle: (d) => (d === 'encode' ? '编码结果' : '解码结果'),
  sample: (d, o) => [d === 'encode' ? "Hello, 快JSON!" : BASEX_SAMPLE[str(o, 'kind')] ?? ''],
  help: help([
    ['Base32', 'A-Z 和 2-7，不区分大小写，常用于两步验证密钥（TOTP）'],
    ['Base58', '去掉了容易看错的 0 O I l，比特币地址、IPFS 使用'],
    ['Base62', '只有字母和数字，常用于短网址'],
    ['Base85', 'Ascii85，比 Base64 更紧凑，PDF、PostScript 使用'],
    ['Base100', '每个字节变成一个 emoji，好玩用'],
  ]),
  run: async (c) => {
    const m = await bx();
    const k = str(c.o, 'kind') as 'base58';
    if (c.dir === 'encode') {
      const e = (await cs()).encodeText(c.src[0], charset(c.o));
      const text = m.baseEncode(k, e.bytes);
      return { kind: 'text', text, note: join(`${size(e.bytes.length)} → ${[...text].length} 个字符`, lossyNote(e.lossy, c.o)) };
    }
    return bytesOut(m.baseDecode(k, c.src[0]), charset(c.o), 'kuaijson-' + k);
  },
  ext: () => 'txt',
};

// ================= URL =================

const url: ToolDef = {
  ...TEXT,
  dirs: [['encode', '编码'], ['decode', '解码']],
  flip: { encode: 'decode', decode: 'encode' },
  opts: [
    { key: 'mode', label: '编码范围', type: 'select', options: [['component', '参数值（encodeURIComponent）'], ['uri', '完整网址（encodeURI）'], ['form', '表单格式（空格变 +）'], ['all', '全部字符']], def: 'component', show: onDir('encode') },
    { ...O_UPPER, show: onDir('encode') },
    { key: 'plus', label: '+ 当作空格', type: 'check', def: true, title: '表单提交的数据里空格写成 +', show: onDir('decode') },
    { key: 'deep', label: '自动多次解码', type: 'check', def: true, title: '结果里还有 %XX 时继续解码（最多 5 次），适合被重复编码过的网址', show: onDir('decode') },
    O_CS,
  ],
  outTitle: (d) => (d === 'encode' ? '编码结果' : '解码结果'),
  sample: (d) => [d === 'encode' ? "https://www.kuaijson.com/search?q=快 JSON&tag=编码/解码" : "https%3A%2F%2Fwww.kuaijson.com%2Fsearch%3Fq%3D%E5%BF%AB%20JSON%26tag%3D%E7%BC%96%E7%A0%81%2F%E8%A7%A3%E7%A0%81"],
  help: help([
    ['参数值', '对应 JS 的 encodeURIComponent：只保留字母、数字和 - _ . ! ~ * \' ( )，适合编码网址里的参数值'],
    ['完整网址', '对应 encodeURI：保留 : / ? & = # 等网址结构字符，适合编码整个网址'],
    ['表单格式', 'application/x-www-form-urlencoded：空格写成 +'],
    ['全部字符', '每个字符都转成 %XX'],
  ]),
  run: async (c) => {
    const m = await tc();
    if (c.dir === 'encode') {
      const r = m.urlEncode(c.src[0], str(c.o, 'mode') as 'component', charset(c.o), bool(c.o, 'upper'));
      return { kind: 'text', text: r.text, note: lossyNote(r.lossy, c.o) };
    }
    if (bool(c.o, 'deep')) {
      const r = m.urlDecodeDeep(c.src[0], charset(c.o), bool(c.o, 'plus'));
      return { kind: 'text', text: r.text, note: r.times > 1 ? `内容被重复编码过，已解码 ${r.times} 次` : '' };
    }
    return { kind: 'text', text: m.urlDecode(c.src[0], charset(c.o), bool(c.o, 'plus')) };
  },
  ext: () => 'txt',
};

// ================= UTF-8 字节写法 =================

const utf8: ToolDef = {
  ...TEXT,
  dirs: [['encode', '文字 → 字节'], ['decode', '字节 → 文字']],
  flip: { encode: 'decode', decode: 'encode' },
  opts: [
    { key: 'fmt', label: '写法', type: 'select', options: [['x', '\\xE4\\xB8\\xAD'], ['pct', '%E4%B8%AD'], ['hex0x', '0xE4, 0xB8, 0xAD'], ['space', 'E4 B8 AD'], ['dec', '[228, 184, 173]'], ['bin', '11100100 10111000 …']], def: 'x', show: onDir('encode') },
    { ...O_UPPER, show: (o, d) => d === 'encode' && str(o, 'fmt') !== 'dec' && str(o, 'fmt') !== 'bin' },
    { key: 'keep', label: '英文和数字保持原样', type: 'check', def: true, show: (o, d) => d === 'encode' && ['x', 'pct'].includes(str(o, 'fmt')) },
    O_CS,
  ],
  outTitle: (d) => (d === 'encode' ? '字节' : '文字'),
  placeholder: (d) => (d === 'encode' ? '输入文字，查看它的 UTF-8 字节…' : '粘贴 \\xE4\\xB8\\xAD、%E4%B8%AD、0xE4 0xB8、[228,184,173] 等任意写法，会自动识别…'),
  sample: (d) => [d === 'encode' ? "快JSON 中文" : "\\xE5\\xBF\\xABJSON \\xE4\\xB8\\xAD\\xE6\\x96\\x87"],
  help: '<p>日志、抓包、Python 打印出来的 <code>\\xE4\\xB8\\xAD</code> 这类内容，粘贴到“字节 → 文字”就能还原成中文。写法会自动识别；还原出来是乱码时，把“字符编码”改成 GBK 试试。</p>',
  run: async (c) => {
    const m = await tc();
    if (c.dir === 'encode') {
      const r = m.bytesFormat(c.src[0], charset(c.o), str(c.o, 'fmt') as 'x', bool(c.o, 'upper'), bool(c.o, 'keep'));
      return { kind: 'text', text: r.text, note: lossyNote(r.lossy, c.o) };
    }
    const r = m.bytesParse(c.src[0], charset(c.o));
    return { kind: 'text', text: r.text, note: `识别为${r.fmt}` };
  },
  ext: () => 'txt',
};

// ================= HTML 实体 =================

const htmlEntity: ToolDef = {
  ...TEXT,
  dirs: [['encode', '编码'], ['decode', '解码']],
  flip: { encode: 'decode', decode: 'encode' },
  opts: [
    { key: 'scope', label: '转换范围', type: 'select', options: [['basic', '只转 < > & " \''], ['nonascii', '以及中文等非 ASCII 字符'], ['all', '所有字符']], def: 'basic', show: onDir('encode') },
    { key: 'style', label: '写法', type: 'select', options: [['named', '命名实体 &lt;'], ['dec', '十进制 &#60;'], ['hex', '十六进制 &#x3c;']], def: 'named', show: onDir('encode') },
  ],
  outTitle: (d) => (d === 'encode' ? '编码结果' : '解码结果'),
  sample: (d) => [d === 'encode' ? '<p class="tip">快JSON © 2026 — 数据只在本地处理 & 不上传</p>' : '&lt;p&gt;快JSON &copy; 2026 &mdash; &#25968;&#x636e;&lt;/p&gt;'],
  run: async (c) => {
    const m = await tc();
    if (c.dir === 'encode') return { kind: 'text', text: m.entityEncode(c.src[0], str(c.o, 'scope') as 'basic', str(c.o, 'style') as 'named') };
    const r = m.entityDecode(c.src[0]);
    return { kind: 'text', text: r.text, note: r.unknown.length ? `没有识别的实体（保持原样）：${r.unknown.slice(0, 5).join(' ')}` : '' };
  },
  ext: () => 'txt',
};

// ================= escape / unescape =================

const escape: ToolDef = {
  ...TEXT,
  dirs: [['escape', 'escape'], ['unescape', 'unescape']],
  flip: { escape: 'unescape', unescape: 'escape' },
  opts: [],
  outTitle: () => '结果',
  placeholder: (d) => (d === 'escape' ? '输入文字…' : '粘贴 %u5FEB%u6377 这样的内容…'),
  sample: (d) => [d === 'escape' ? "快JSON: 100% 本地处理" : "%u5FEBJSON%3A%20100%25%20%u672C%u5730%u5904%u7406"],
  help: '<p>对应 JavaScript 的 <code>escape()</code> / <code>unescape()</code>：中文写成 <code>%uXXXX</code>。这两个函数已经不推荐使用，只在处理老系统的数据时才需要；网址参数请用“URL 编解码”。</p>',
  run: async (c) => {
    const m = await tc();
    return { kind: 'text', text: c.dir === 'escape' ? m.jsEscape(c.src[0]) : m.jsUnescape(c.src[0]) };
  },
  ext: () => 'txt',
};

// ================= 十六进制 ⇄ 文本 =================

const hex: ToolDef = {
  ...TEXT,
  dirs: [['to', '文字 → 十六进制'], ['from', '十六进制 → 文字']],
  flip: { to: 'from', from: 'to' },
  opts: [
    { key: 'sep', label: '分隔', type: 'select', options: [['space', '空格'], ['none', '不分隔'], ['x', '\\x 前缀'], ['0x', '0x 前缀'], ['comma', '0x 加逗号']], def: 'space', show: onDir('to') },
    { ...O_UPPER, def: false, show: onDir('to') },
    O_CS,
  ],
  outTitle: (d) => (d === 'to' ? '十六进制' : '文字'),
  placeholder: (d) => (d === 'to' ? '输入文字…' : '粘贴十六进制，空格、逗号、0x、\\x 都可以…'),
  sample: (d) => [d === 'to' ? '快JSON' : 'e5bfab4a534f4e'],
  run: async (c) => {
    const m = await tc();
    if (c.dir === 'to') {
      const r = m.textToHex(c.src[0], charset(c.o), str(c.o, 'sep') as 'space', bool(c.o, 'upper'));
      return { kind: 'text', text: r.text, note: lossyNote(r.lossy, c.o) };
    }
    return bytesOut((await by()).fromHex(c.src[0]), charset(c.o), 'kuaijson-hex');
  },
  ext: () => 'txt',
};

// ================= 摩斯密码 =================

const morse: ToolDef = {
  ...TEXT,
  dirs: [['encode', '文字 → 摩斯'], ['decode', '摩斯 → 文字']],
  flip: { encode: 'decode', decode: 'encode' },
  opts: [
    { key: 'dot', label: '点', type: 'select', options: [['.', '.'], ['·', '·']], def: '.', show: onDir('encode') },
    { key: 'dash', label: '划', type: 'select', options: [['-', '-'], ['−', '−'], ['_', '_']], def: '-', show: onDir('encode') },
    { key: 'wsep', label: '单词之间', type: 'select', options: [[' / ', ' / '], [' | ', ' | '], ['   ', '三个空格']], def: ' / ', show: onDir('encode') },
    { key: 'lower', label: '输出小写', type: 'check', def: false, show: onDir('decode') },
  ],
  outTitle: () => '结果',
  placeholder: (d) => (d === 'encode' ? '输入英文、数字或常用标点…' : '粘贴摩斯电码：字母之间用空格，单词之间用 / …'),
  sample: (d) => [d === 'encode' ? 'SOS Hello World' : '... --- ... / .... . .-.. .-.. --- / .-- --- .-. .-.. -..'],
  run: async (c) => {
    const m = await tc();
    if (c.dir === 'encode') {
      const r = m.morseEncode(c.src[0], { dot: str(c.o, 'dot'), dash: str(c.o, 'dash'), letterSep: ' ', wordSep: str(c.o, 'wsep') });
      return { kind: 'text', text: r.text, note: r.skipped.length ? `摩斯密码只支持英文字母、数字和常用标点，已跳过：${r.skipped.slice(0, 10).join(' ')}` : '' };
    }
    const r = m.morseDecode(c.src[0], bool(c.o, 'lower'));
    return { kind: 'text', text: r.text, note: r.unknown.length ? `${r.unknown.length} 个电码无法识别，显示为 ?：${r.unknown.slice(0, 5).join(' ')}` : '' };
  },
  ext: () => 'txt',
};

// ================= 迅雷 / 快车 / 旋风 =================

const thunder: ToolDef = {
  ...TEXT,
  dirs: [['decode', '还原真实地址'], ['encode', '生成下载链接']],
  flip: { decode: 'encode', encode: 'decode' },
  opts: [],
  outTitle: (d) => (d === 'decode' ? '真实下载地址' : '下载链接'),
  placeholder: (d) => (d === 'decode' ? '粘贴 thunder://、flashget://、qqdl:// 开头的链接，一行一个…' : '输入普通下载地址，一行一个…'),
  sample: (d) => [d === 'decode' ? "thunder://QUFodHRwczovL3d3dy5rdWFpanNvbi5jb20vZmlsZXMvZGVtby56aXBaWg==\nflashget://W0ZMQVNIR0VUXWh0dHBzOi8vd3d3Lmt1YWlqc29uLmNvbS9maWxlcy9kZW1vLnppcFtGTEFTSEdFVF0=\nqqdl://aHR0cHM6Ly93d3cua3VhaWpzb24uY29tL2ZpbGVzL2RlbW8uemlw" : "https://www.kuaijson.com/files/demo.zip"],
  run: async (c) => {
    const m = await tc();
    const lines = c.src[0].split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (c.dir === 'decode') {
      const out: string[] = [];
      const kinds = new Set<string>();
      let bad = 0;
      for (const l of lines) {
        try {
          const r = m.decodeDownloadLink(l);
          out.push(r.url);
          kinds.add(r.kind);
        } catch {
          bad++;
          out.push('# 无法识别：' + l);
        }
      }
      if (bad === lines.length) throw new Error('没有识别出下载链接：只支持 thunder://（迅雷）、flashget://（快车）、qqdl://（旋风）开头的链接');
      return { kind: 'text', text: out.join('\n'), note: join(`还原了 ${lines.length - bad} 个${[...kinds].join(' / ')}链接`, bad ? `${bad} 行无法识别` : '') };
    }
    const rows = lines.flatMap((u) => m.encodeDownloadLinks(u).map((x) => ({ tone: 'add' as const, cells: [x.kind, x.url, u] })));
    return { kind: 'list', head: ['类型', '下载链接', '原始地址'], rows, summary: `生成了 ${rows.length} 个链接`, okText: '', text: rows.map((r) => r.cells[1]).join('\n') };
  },
  ext: () => 'txt',
};

// ================= 邮箱防爬 =================

const email: ToolDef = {
  ...TEXT,
  opts: [
    { key: 'style', label: '方式', type: 'select', options: [['entity', 'HTML 实体'], ['js', 'JavaScript 拼接'], ['css', 'CSS 倒序显示'], ['text', '文字替换 [at] [dot]']], def: 'entity' },
  ],
  inTitles: () => ['邮箱地址（一行一个）'],
  outTitle: () => '放进网页的代码',
  placeholder: () => '输入邮箱地址，例如 contact@kuaijson.com',
  sample: () => ['contact@kuaijson.com'],
  help: help([
    ['HTML 实体', '每个字符写成 &#99; 这种形式，浏览器正常显示和点击，简单的爬虫认不出来'],
    ['JavaScript 拼接', '邮箱拆成几段，用脚本拼起来再显示，防爬效果更好；不支持 JS 的环境看不到'],
    ['CSS 倒序显示', '源码里是倒过来的，用 CSS 正过来显示；用户复制出来的也是倒序'],
    ['文字替换', 'contact [at] kuaijson [dot] com，需要用户自己改回来'],
  ]),
  run: async (c) => {
    const m = await tc();
    const lines = c.src[0].split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const out = lines.map((l, i) => {
      if (!m.EMAIL_RE.test(l)) throw new Error(`第 ${i + 1} 行不是有效的邮箱地址：${l}`);
      return m.emailObfuscate(l, str(c.o, 'style') as 'entity');
    });
    return { kind: 'text', text: out.join('\n\n') };
  },
  ext: (_d, o) => (str(o, 'style') === 'text' ? 'txt' : 'html'),
};

// ================= 哈希 / 文件哈希 / HMAC（3.2） =================

const SINGLE_ALGOS: [string, string][] = ALGO_INFO.map((a) => [a.id, a.label]);
const HMAC_ALGOS: [string, string][] = ALGO_INFO.filter((a) => a.hmac).map((a) => [a.id, 'HMAC-' + a.label]);
const IN_FMT: [string, string][] = [['text', '文字'], ['hex', '十六进制'], ['base64', 'Base64']];
const O_OUT: OptDef = { key: 'out', label: '输出', type: 'select', options: [['hex', '小写十六进制'], ['HEX', '大写十六进制'], ['base64', 'Base64']], def: 'hex' };
const O_EXPECT: OptDef = {
  key: 'expect', label: '对比', type: 'text', def: '', width: 240, noSave: true,
  placeholder: '粘贴要核对的哈希值（可选）', title: '和计算结果对比，一致的会标成绿色；大小写、空格、Base64 都可以',
};
const pctText = (done: number, total: number) => `已处理 ${total ? Math.floor((done / total) * 100) : 100}%（${size(done)} / ${size(total)}）`;
const fileMarker = (f: File) =>
  `📎 已载入文件：${f.name}（${size(f.size)}）\n文件只在浏览器里分块读取，不会上传。在这里改动文字会取消文件，改为计算文字。`;

/** 把输入框的内容按“输入格式”变成字节 */
async function inputBytes(text: string, fmt: string, c: Charset): Promise<{ bytes: Uint8Array; lossy: number }> {
  if (fmt === 'hex') return { bytes: (await by()).fromHex(text), lossy: 0 };
  if (fmt === 'base64') return { bytes: (await by()).fromBase64(text).bytes, lossy: 0 };
  return (await cs()).encodeText(text, c);
}

interface Digests { ids: string[]; values: Uint8Array[]; what: string }

/** 计算一组算法的哈希：打开了文件就分块读文件，否则计算输入框里的内容 */
async function computeDigests(c: RunCtx, ids: string[]): Promise<Digests & { lossy: number }> {
  const m = await hs();
  const algos = m.pickAlgos(ids);
  const blob = c.file?.blob;
  if (blob) {
    const t0 = performance.now();
    const values = await m.digestBlob(blob, algos, { progress: (d, t) => c.progress(pctText(d, t)), stale: c.stale });
    const sec = (performance.now() - t0) / 1000;
    const speed = sec > 0.5 ? ` · ${size(Math.round(blob.size / sec))}/秒` : '';
    return { ids, values, what: `文件 ${blob.name} · ${size(blob.size)}${speed}`, lossy: 0 };
  }
  const { bytes, lossy } = await inputBytes(c.src[0], str(c.o, 'inFmt') || 'text', charset(c.o));
  return { ids, values: algos.map((a) => m.digest(a, bytes)), what: `输入 ${size(bytes.length)}`, lossy };
}

/** 显示结果：一种算法时输出文本，多种算法时输出表格；填了对比值会标出一致的那一行 */
async function digestResult(c: RunCtx, d: Digests, okText: (label: string) => string, extraNote = ''): Promise<Result> {
  const m = await hs();
  const out = (str(c.o, 'out') || 'hex') as 'hex';
  const expect = str(c.o, 'expect').trim();
  const labels = d.ids.map((id) => m.getAlgo(id).label);
  const prefix = c.dir === 'hmac' ? 'HMAC-' : '';
  if (d.ids.length === 1) {
    const text = m.formatDigest(d.values[0], out);
    const cmp = expect ? (m.matchDigest(expect, d.values[0]) ? '✓ 与对比值一致' : '✗ 与对比值不一致') : '';
    const a = m.getAlgo(d.ids[0]);
    return { kind: 'text', text, note: join(cmp, `${prefix}${a.label}，${a.bits} 位`, d.what, extraNote) };
  }
  let hit = -1;
  const rows = d.values.map((v, i) => {
    const ok = !!expect && m.matchDigest(expect, v);
    if (ok && hit < 0) hit = i;
    return { tone: ok ? ('add' as const) : ('info' as const), cells: [prefix + labels[i], m.formatDigest(v, out)] };
  });
  const summary = expect ? (hit >= 0 ? okText(prefix + labels[hit]) : '✗ 没有和对比值一致的结果') : `${rows.length} 种算法 · 点击结果可以复制`;
  return {
    kind: 'list', head: ['算法', '结果'], rows, summary, okText: '', copyable: true,
    tone: expect ? (hit >= 0 ? 'ok' : 'err') : undefined,
    text: rows.map((r) => `${r.cells[0]}: ${r.cells[1]}`).join('\n'),
    note: join(d.what, extraNote),
  };
}

const pickIds = (sel: string, common: string[]) => (sel === 'common' ? common : sel === 'all' ? ALGO_INFO.map((a) => a.id) : [sel]);

const hash: ToolDef = {
  ...TEXT,
  opts: [
    { key: 'algo', label: '算法', type: 'select', options: [['common', '常用 7 种（表格）'], ['all', `全部 ${ALGO_INFO.length} 种（表格）`], ...SINGLE_ALGOS], def: 'common' },
    { key: 'inFmt', label: '输入格式', type: 'select', options: IN_FMT, def: 'text', title: '十六进制 / Base64：先还原成字节再计算，适合计算二进制数据的哈希' },
    { ...O_CS, show: (o) => str(o, 'inFmt') === 'text' },
    O_OUT,
    O_EXPECT,
  ],
  inTitles: () => ['输入（也可以打开文件）'],
  outTitle: () => '哈希值',
  placeholder: () => '输入要计算哈希的文字，或点“打开文件”选择文件…',
  sample: () => ['Hello, 快JSON!'],
  accept: '*/*',
  maxFileMB: 4096,
  readFile: (f) => Promise.resolve({ text: fileMarker(f), blob: f, note: `已载入 ${f.name}，右侧是文件的哈希值` }),
  help: help([
    ['MD5 / SHA-1', '最常见，但已经不安全，只适合做校验、去重，不要用来存密码'],
    ['SHA-256 / SHA-512', '目前最常用的安全哈希'],
    ['SHA-3 / Keccak-256', 'SHA-3 是新标准；以太坊用的是 Keccak-256，和 SHA3-256 结果不同'],
    ['SM3', '国密算法，政务、金融系统常用'],
    ['CRC32 / CRC16 / Adler-32', '校验和，用来发现传输错误，不能防篡改'],
  ], '同一段文字用 UTF-8 和 GBK 算出来的哈希不同，和别的系统对不上时，先确认双方用的字符编码。'),
  run: async (c) => {
    const d = await computeDigests(c, pickIds(str(c.o, 'algo'), COMMON_HASH));
    return digestResult(c, d, (l) => `✓ 与 ${l} 的结果一致`, lossyNote(d.lossy, c.o));
  },
  ext: () => 'txt',
};

const fileHash: ToolDef = {
  ...TEXT,
  opts: [
    { key: 'algo', label: '算法', type: 'select', options: [['common', '常用 5 种（MD5 / SHA-1 / SHA-256 / SHA-512 / CRC32）'], ['all', `全部 ${ALGO_INFO.length} 种`], ...SINGLE_ALGOS], def: 'common' },
    O_OUT,
    O_EXPECT,
  ],
  inTitles: () => ['选择文件'],
  outTitle: () => '文件哈希值',
  placeholder: () => '点上面的“打开文件”，或者把文件拖到这里。\n\n文件只在浏览器里分块读取，不会上传，几 GB 的大文件也可以。\n把官网提供的 SHA-256 粘贴到上面的“对比”框，就能核对下载的文件是否完整。',
  noSample: true,
  accept: '*/*',
  maxFileMB: 4096,
  readFile: (f) => Promise.resolve({ text: fileMarker(f), blob: f, note: `已载入 ${f.name}` }),
  run: async (c) => {
    if (!c.file?.blob) throw new Error('请点“打开文件”选择文件，或者把文件拖到左边。计算一段文字的哈希请用“哈希计算”工具。');
    const d = await computeDigests(c, pickIds(str(c.o, 'algo'), COMMON_FILE));
    return digestResult(c, d, (l) => `✓ 与 ${l} 一致，文件完整`);
  },
  ext: () => 'txt',
};

const hmacTool: ToolDef = {
  ...TEXT,
  opts: [
    { key: 'algo', label: '算法', type: 'select', options: [['all', '全部（表格）'], ...HMAC_ALGOS], def: 'sha256' },
    { key: 'key', label: '密钥', type: 'text', def: '', width: 200, noSave: true, placeholder: '签名用的密钥', title: '密钥不会保存到浏览器，刷新页面后需要重新填写' },
    { key: 'keyFmt', label: '密钥格式', type: 'select', options: IN_FMT, def: 'text' },
    { key: 'inFmt', label: '消息格式', type: 'select', options: IN_FMT, def: 'text' },
    { ...O_CS, show: (o) => str(o, 'inFmt') === 'text' || str(o, 'keyFmt') === 'text' },
    O_OUT,
    O_EXPECT,
  ],
  inTitles: () => ['要签名的消息'],
  outTitle: () => 'HMAC 签名',
  placeholder: () => '输入要签名的内容，例如接口参数拼接后的字符串…',
  sample: () => ['The quick brown fox jumps over the lazy dog'],
  sampleOpts: () => ({ key: 'key', keyFmt: 'text', inFmt: 'text' }),
  help: '<p>很多开放平台（支付、短信、云服务等）的接口签名都是 HMAC：用密钥对拼接好的参数字符串做 HMAC-SHA256，结果转成十六进制或 Base64。和平台给的示例对不上时，先检查参数拼接的顺序和字符编码。</p><p>密钥只在浏览器里使用，不会保存，也不会上传。</p>',
  run: async (c) => {
    const m = await hs();
    const ids = str(c.o, 'algo') === 'all' ? ALGO_INFO.filter((a) => a.hmac).map((a) => a.id) : [str(c.o, 'algo')];
    const k = await inputBytes(str(c.o, 'key'), str(c.o, 'keyFmt'), charset(c.o));
    const msg = await inputBytes(c.src[0], str(c.o, 'inFmt'), charset(c.o));
    const values = ids.map((id) => m.hmac(m.getAlgo(id), k.bytes, msg.bytes));
    const warn = !k.bytes.length ? '⚠ 密钥为空，请在上方填写密钥' : '';
    return digestResult({ ...c, dir: 'hmac' }, { ids, values, what: `密钥 ${size(k.bytes.length)}，消息 ${size(msg.bytes.length)}` }, (l) => `✓ 与 ${l} 的结果一致`, join(warn, lossyNote(k.lossy + msg.lossy, c.o)));
  },
  ext: () => 'txt',
};

// ================= 汇总 =================

export const ENCODE_DEFS: Record<string, ToolDef> = {
  'encode/base64': base64,
  'encode/basex': basex,
  'encode/url': url,
  'encode/utf8': utf8,
  'encode/html-entity': htmlEntity,
  'encode/escape': escape,
  'encode/hex': hex,
  'encode/morse': morse,
  'encode/thunder': thunder,
  'encode/email': email,
  'encode/hash': hash,
  'encode/file-hash': fileHash,
  'encode/hmac': hmacTool,
};
