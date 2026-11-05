// 编码 / 加密类工具（3.5 压缩）：Gzip / Zlib / Deflate
import type { Opts, Result, ToolDef } from '../json/types';
import { inputErr, str } from '../json/types';
import { O_CS, TEXT, bytesOut, charset, help, join, onDir, size } from './defs';

const gz = () => import('../../core/gzip');
const by = () => import('../../core/bytes');
const cs = () => import('../../core/charset');

const GZ_TEXT = '{"name":"快JSON","desc":"数据只在浏览器本地处理","tags":["json","gzip","base64"],"ok":true}';
/** 压缩示例：接口常见的 JSON 返回，重复的内容多，压缩效果明显 */
const GZ_SAMPLE = "{\n  \"code\": 0,\n  \"msg\": \"ok\",\n  \"data\": {\n    \"total\": 6,\n    \"list\": [\n      {\n        \"id\": 1,\n        \"name\": \"张三\",\n        \"city\": \"青岛\",\n        \"vip\": false,\n        \"tags\": [\n          \"json\",\n          \"gzip\"\n        ]\n      },\n      {\n        \"id\": 2,\n        \"name\": \"李四\",\n        \"city\": \"北京\",\n        \"vip\": true,\n        \"tags\": [\n          \"json\",\n          \"gzip\"\n        ]\n      },\n      {\n        \"id\": 3,\n        \"name\": \"王五\",\n        \"city\": \"上海\",\n        \"vip\": false,\n        \"tags\": [\n          \"json\",\n          \"gzip\"\n        ]\n      },\n      {\n        \"id\": 4,\n        \"name\": \"赵六\",\n        \"city\": \"深圳\",\n        \"vip\": true,\n        \"tags\": [\n          \"json\",\n          \"gzip\"\n        ]\n      },\n      {\n        \"id\": 5,\n        \"name\": \"孙七\",\n        \"city\": \"杭州\",\n        \"vip\": false,\n        \"tags\": [\n          \"json\",\n          \"gzip\"\n        ]\n      },\n      {\n        \"id\": 6,\n        \"name\": \"周八\",\n        \"city\": \"成都\",\n        \"vip\": true,\n        \"tags\": [\n          \"json\",\n          \"gzip\"\n        ]\n      }\n    ]\n  }\n}";
const LEVELS: [string, string][] = [
  ['1', '1（最快）'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6（默认）'], ['7', '7'], ['8', '8'], ['9', '9（最小）'], ['0', '0（不压缩）'],
];
const FMTS: [string, string][] = [['gzip', 'Gzip（1F 8B 开头）'], ['zlib', 'Zlib（78 开头）'], ['raw', 'Deflate（无头）']];
const isTextFile = (f: File) => /^text\//.test(f.type) || /\.(txt|b64|base64|hex|log)$/i.test(f.name);
const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '-');
const pad = (n: number) => String(n).padStart(2, '0');
const fmtTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 把输入框的文本读成字节：自动识别十六进制 / Base64 */
async function textToBytes(text: string, fmt: string): Promise<{ bytes: Uint8Array; label: string }> {
  const B = await by();
  const t = text.trim();
  if (!t) throw new Error('请粘贴压缩后的数据（Base64 或十六进制），或者打开 .gz 文件');
  const hexLike = /^(0x)?[0-9a-f\s]+$/i.test(t) && t.replace(/^0x|\s/gi, '').length % 2 === 0;
  const useHex = fmt === 'hex' || (fmt === 'auto' && hexLike);
  try {
    return useHex ? { bytes: B.fromHex(t), label: '十六进制' } : { bytes: B.fromBase64(t).bytes, label: 'Base64' };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(fmt === 'auto' ? `${m}。解压需要的是压缩后的数据，一般是 H4sI 开头的 Base64，或 1f8b 开头的十六进制` : m);
  }
}

const gzipTool: ToolDef = {
  ...TEXT,
  dirs: [['compress', '压缩'], ['decompress', '解压']],
  flip: { compress: 'decompress', decompress: 'compress' },
  inTitles: (d) => [d === 'compress' ? '原文（也可以打开任意文件）' : '压缩数据（Base64 / 十六进制，或打开 .gz 文件）'],
  outTitle: (d) => (d === 'compress' ? '压缩结果' : '解压结果'),
  placeholder: (d) =>
    d === 'compress'
      ? '输入要压缩的文字，或点“打开文件”选择任意文件…'
      : '粘贴压缩后的数据：Gzip 的 Base64 一般是 H4sI 开头，Zlib 是 eJ / eN 开头；十六进制也可以。\n也可以打开 .gz 文件。会自动识别 Gzip / Zlib / Deflate',
  opts: [
    { key: 'fmt', label: '格式', type: 'select', options: FMTS, def: 'gzip', show: onDir('compress'), title: 'HTTP、.gz 文件用 Gzip；Python zlib.compress、Java Deflater、PHP gzcompress 是 Zlib' },
    { key: 'level', label: '压缩级别', type: 'select', options: LEVELS, def: '6', show: onDir('compress'), title: '级别越高结果越小，但越慢；6 是 gzip 命令的默认值' },
    { key: 'out', label: '输出', type: 'select', options: [['base64', 'Base64'], ['hex', '十六进制'], ['file', '文件（下载）']], def: 'base64', show: onDir('compress') },
    { key: 'dfmt', label: '格式', type: 'select', options: [['auto', '自动识别'], ...FMTS], def: 'auto', show: onDir('decompress') },
    { key: 'inFmt', label: '输入格式', type: 'select', options: [['auto', '自动识别'], ['base64', 'Base64'], ['hex', '十六进制']], def: 'auto', show: onDir('decompress'), title: '打开二进制文件（如 .gz）时不用选' },
    { ...O_CS, title: '压缩时把文字变成字节、解压后把字节变回文字所用的编码；国内老系统常用 GBK' },
  ],
  sampleOpts: (d): Opts => (d === 'compress' ? { out: 'base64' } : { dfmt: 'auto', inFmt: 'auto' }),
  sample: async (d) => {
    if (d === 'compress') return [GZ_SAMPLE];
    const [m, B] = await Promise.all([gz(), by()]);
    return [B.toBase64(m.compress(B.utf8Bytes(GZ_TEXT), 'gzip'))];
  },
  accept: '*/*',
  maxFileMB: 200,
  readFile: (f, d) => {
    if (d === 'decompress' && isTextFile(f)) return null;
    return f.arrayBuffer().then((buf) => {
      const bin = new Uint8Array(buf);
      // 打开的是压缩文件就切到“解压”，否则切到“压缩”
      const packed = (bin[0] === 0x1f && bin[1] === 0x8b) || /\.(gz|gzip|z|zz|zlib|deflate)$/i.test(f.name);
      const to = packed ? 'decompress' : 'compress';
      return {
        text: `📎 已载入文件：${f.name}（${size(buf.byteLength)}）\n现在${to === 'compress' ? '压缩' : '解压'}的是这个文件。在这里改动文字会取消文件，改为处理文字。`,
        bin,
        dir: to,
        note: `已载入 ${f.name}`,
      };
    });
  },
  help:
    help([
      ['Gzip', 'HTTP 的 Content-Encoding: gzip、.gz 文件。Java GZIPOutputStream、PHP gzencode、Python gzip.compress、Go compress/gzip、.NET GZipStream'],
      ['Zlib', 'Python zlib.compress、Java Deflater（默认）、PHP gzcompress、Node zlib.deflateSync、.NET ZLibStream'],
      ['Deflate（无头）', 'Java new Deflater(level, true)、PHP gzdeflate、Node zlib.deflateRawSync、.NET DeflateStream'],
      ['Base64', '接口里传压缩数据时一般再转成 Base64。Gzip 的 Base64 以 H4sI 开头，Zlib 以 eJ / eN / eA 开头'],
    ], '同样的数据，不同程序压缩出来的字节可能不一样，但解压结果相同，这是正常的。') +
    '<p>解压时会自动识别格式，并核对校验和，数据不完整会提示。解压后最多 512 MB。文件只在浏览器里处理，不会上传。</p>',
  run: async (c): Promise<Result> => {
    const [m, B, C] = await Promise.all([gz(), by(), cs()]);
    const t0 = performance.now();
    const took = () => `用时 ${Math.round(performance.now() - t0)} ms`;
    if (c.dir === 'compress') {
      let data: Uint8Array;
      let lossy = 0;
      if (c.file) data = c.file.bytes;
      else {
        if (!c.src[0]) throw new Error('请输入要压缩的文字，或打开文件');
        const e = C.encodeText(c.src[0], charset(c.o));
        data = e.bytes;
        lossy = e.lossy;
      }
      const fmt = str(c.o, 'fmt') as 'gzip';
      const out = m.compress(data, fmt, Number(str(c.o, 'level')), c.file?.name);
      const ratio = `${size(data.length)} → ${size(out.length)}（${pctOf(out.length, data.length)}）`;
      const notes = [
        m.FMT_LABEL[fmt],
        ratio,
        out.length >= data.length ? '⚠ 内容太短或已经压缩过，压缩后反而变大了' : '',
        lossy ? `⚠ ${lossy} 个字符无法用所选编码表示，已替换成 ?` : '',
        took(),
      ];
      const mode = str(c.o, 'out');
      if (mode === 'file') {
        const ext = fmt === 'gzip' ? 'gz' : fmt === 'zlib' ? 'zz' : 'deflate';
        const name = `${c.file?.name ?? 'kuaijson.txt'}.${ext}`;
        return { kind: 'bin', bytes: out, mime: fmt === 'gzip' ? 'application/gzip' : 'application/octet-stream', name, text: B.hexDump(out, 512), note: join(`结果是 ${name}，点“下载”保存`, ...notes) };
      }
      const text = mode === 'hex' ? B.toHex(out) : B.toBase64(out);
      return { kind: 'text', text, tone: out.length >= data.length || lossy ? 'warn' : 'ok', note: join(...notes, `${text.length} 个字符`) };
    }
    // ---------- 解压 ----------
    let input: Uint8Array;
    let inLabel = '';
    if (c.file) {
      input = c.file.bytes;
      inLabel = `文件 ${c.file.name}`;
    } else {
      try {
        const r = await textToBytes(c.src[0], str(c.o, 'inFmt'));
        input = r.bytes;
        inLabel = `输入是 ${r.label}`;
      } catch (e) {
        throw inputErr(e, 0);
      }
    }
    const r = m.decompress(input, str(c.o, 'dfmt') as 'auto');
    const notes = [
      inLabel,
      `${m.FMT_LABEL[r.fmt]}${str(c.o, 'dfmt') === 'auto' ? '（自动识别）' : ''}`,
      `${size(input.length)} → ${size(r.bytes.length)}`,
      r.members > 1 ? `${r.members} 段 Gzip 首尾相连，已合并` : '',
      r.checked ? (r.fmt === 'gzip' ? '✓ CRC32 校验通过' : '✓ Adler-32 校验通过') : '',
      r.header?.filename ? `原文件名 ${r.header.filename}` : '',
      r.header?.mtime ? `压缩时间 ${fmtTime(r.header.mtime)}` : '',
    ];
    const base = r.header?.filename?.replace(/[\\/:*?"<>|]/g, '_') || (c.file?.name.replace(/\.(gz|gzip|z|zz|zlib|deflate)$/i, '') ?? 'kuaijson-gunzip');
    const res = await bytesOut(r.bytes, charset(c.o), base.replace(/\.[^.]+$/, '') || 'kuaijson-gunzip', join(...notes));
    if (res.kind === 'bin' && /\.[^.]+$/.test(base)) res.name = base;
    return res;
  },
  ext: (d, _o, res) => (res.kind === 'text' && d === 'decompress' && /^\s*[[{]/.test(res.text) ? 'json' : 'txt'),
};

export const ZIP_DEFS: Record<string, ToolDef> = {
  'encode/gzip': gzipTool,
};
