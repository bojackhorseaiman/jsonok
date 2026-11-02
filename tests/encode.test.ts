// 3.1 文本编码工具的核心逻辑测试：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseDecode, baseEncode, base32Encode, base85Encode } from '../src/core/basex.ts';
import { detectType, fromBase64, fromHex, hexDump, looksLikeText, toBase64, toHex, utf8Bytes, utf8Text } from '../src/core/bytes.ts';
import { decodeBytes, decodeStrict, encodeText } from '../src/core/charset.ts';
import * as T from '../src/core/textcodec.ts';

const hexOf = (b: Uint8Array) => toHex(b);
const u = utf8Bytes;

test('Base32 / 58 / 62 / 85 / 100：标准向量和往返', () => {
  assert.equal(base32Encode(u('foobar')), 'MZXW6YTBOI======');
  assert.equal(base32Encode(u('f')), 'MY======');
  assert.equal(baseEncode('base58', u('hello world')), 'StV1DL6CwTryKyV');
  assert.equal(baseEncode('base58', Uint8Array.from([0, 0, 1])), '112');
  assert.equal(base85Encode(u('Man ')), '9jqo^');
  assert.equal(base85Encode(new Uint8Array(4)), 'z');
  assert.equal(baseEncode('base100', u('hello')), '👟👜👣👣👦');
  const samples = {"base32": "JBSWY3DPFQQOLP5LJJJU6TRB", "base58": "32UWxgjUxdDKzaEC5RxyN", "base62": "X5HJSwXeAXJHFHF5VXI9", "base85": "87cURD_*$m^T0t*:JN&", "base100": "🐿👜👣👣👦🐣🐗📜💶💢👁👊👆👅🐘"};
  for (const k of ['base32', 'base58', 'base62', 'base85', 'base100'] as const) {
    assert.equal(baseEncode(k, u('Hello, 快JSON!')), samples[k], k);
    assert.equal(utf8Text(baseDecode(k, samples[k])), 'Hello, 快JSON!', k);
    const bin = Uint8Array.from([0, 0, 255, 1, 2, 0, 128]);
    assert.deepEqual([...baseDecode(k, baseEncode(k, bin))], [...bin], k + ' 二进制往返');
    assert.equal(baseEncode(k, new Uint8Array(0)), k === 'base32' ? '' : '', k + ' 空输入');
  }
  assert.equal(utf8Text(baseDecode('base32', 'mzxw6ytboi')), 'foobar', 'Base32 不区分大小写、可省略 =');
  assert.equal(utf8Text(baseDecode('base85', '<~9jqo^~>')), 'Man ');
  assert.throws(() => baseDecode('base58', '0OIl'), /不是有效的 Base58：第 1 个字符 "0"/);
  assert.throws(() => baseDecode('base32', 'AB1C'), /第 3 个字符 "1"/);
  assert.throws(() => baseDecode('base100', 'abc'), /不是有效的 Base100/);
});

test('Base64：URL Safe、Data URI、容错和报错', () => {
  assert.equal(toBase64(u('中')), '5Lit');
  assert.equal(toBase64(Uint8Array.from([0xfb, 0xff])), '+/8=');
  assert.equal(toBase64(Uint8Array.from([0xfb, 0xff]), true, false), '-_8');
  assert.deepEqual([...fromBase64('-_8').bytes], [0xfb, 0xff]);
  const d = fromBase64('data:text/plain;base64,5Lit');
  assert.equal(d.mime, 'text/plain');
  assert.equal(utf8Text(d.bytes), '中');
  assert.equal(utf8Text(fromBase64(' 5L\nit ').bytes), '中', '忽略空白和换行');
  assert.equal(utf8Text(fromBase64("5b+rSlNPTu+8muaVsOaNruWPquWcqOacrOWcsOWkhOeQhiDinJM=").bytes), "快JSON：数据只在本地处理 ✓");
  assert.throws(() => fromBase64('中文'), /第 1 个字符 "中"/);
  assert.throws(() => fromBase64('abcde'), /长度不对/);
  assert.throws(() => fromBase64('ab=c'), /= 只能出现在末尾/);
  assert.throws(() => fromBase64('data:text/plain,abc'), /不是 Base64 编码的/);
});

test('字符编码：GBK / Latin-1 / UTF-16，无法表示的字符计数', () => {
  assert.equal(hexOf(encodeText('中文', 'gbk').bytes), 'd6d0cec4');
  assert.equal(hexOf(encodeText('快', 'gbk').bytes), 'bfec');
  assert.equal(hexOf(encodeText('€a', 'gbk').bytes), '8061');
  assert.equal(encodeText('😀', 'gbk').lossy, 1);
  assert.equal(hexOf(encodeText('é中', 'latin1').bytes), 'e93f');
  assert.equal(encodeText('é中', 'latin1').lossy, 1);
  assert.equal(hexOf(encodeText('A中', 'utf-16le').bytes), '41002d4e');
  assert.equal(hexOf(encodeText('A中', 'utf-16be').bytes), '00414e2d');
  assert.equal(decodeBytes(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]), 'gbk'), '中文');
  assert.equal(decodeBytes(Uint8Array.from([0x80, 0xe9]), 'latin1'), '\u0080é', 'Latin-1 不能被当成 windows-1252');
  assert.throws(() => decodeStrict(Uint8Array.from([0xd6, 0xd0]), 'utf-8'), /试试把“字符编码”改成 GBK/);
});

test('URL 编解码：四种范围、GBK、+ 号、多次编码、报错', () => {
  assert.equal(T.urlEncode('a b&中', 'component', 'utf-8').text, 'a%20b%26%E4%B8%AD');
  assert.equal(T.urlEncode('a b&中', 'form', 'utf-8').text, 'a+b%26%E4%B8%AD');
  assert.equal(T.urlEncode('a b&中', 'uri', 'utf-8').text, 'a%20b&%E4%B8%AD');
  assert.equal(T.urlEncode('ab', 'all', 'utf-8').text, '%61%62');
  assert.equal(T.urlEncode('中', 'component', 'utf-8', false).text, '%e4%b8%ad');
  assert.equal(T.urlEncode('快', 'component', 'gbk').text, '%BF%EC');
  assert.equal(T.urlEncode("https://www.kuaijson.com/search?q=快 JSON&tag=编码/解码", 'component', 'utf-8').text, "https%3A%2F%2Fwww.kuaijson.com%2Fsearch%3Fq%3D%E5%BF%AB%20JSON%26tag%3D%E7%BC%96%E7%A0%81%2F%E8%A7%A3%E7%A0%81");
  assert.equal(T.urlDecode("https%3A%2F%2Fwww.kuaijson.com%2Fsearch%3Fq%3D%E5%BF%AB%20JSON%26tag%3D%E7%BC%96%E7%A0%81%2F%E8%A7%A3%E7%A0%81", 'utf-8', true), "https://www.kuaijson.com/search?q=快 JSON&tag=编码/解码");
  assert.equal(T.urlDecode('a+b%E4%B8%AD', 'utf-8', true), 'a b中');
  assert.equal(T.urlDecode('a+b', 'utf-8', false), 'a+b');
  assert.equal(T.urlDecode('%BF%EC', 'gbk', true), '快');
  assert.throws(() => T.urlDecode('%zz', 'utf-8', true), /第 1 个字符：% 后面应该是两位十六进制/);
  assert.throws(() => T.urlDecode('%D6%D0', 'utf-8', true), /GBK/);
  assert.deepEqual(T.urlDecodeDeep('%25E4%25B8%25AD', 'utf-8', true), { text: '中', times: 2 });
  assert.deepEqual(T.urlDecodeDeep('100%25', 'utf-8', true), { text: '100%', times: 1 });
});

test('HTML 实体：三种写法、范围、解码未知实体', () => {
  assert.equal(T.entityEncode('<a href="x">中&\'</a>', 'basic', 'named'), '&lt;a href=&quot;x&quot;&gt;中&amp;&apos;&lt;/a&gt;');
  assert.equal(T.entityEncode('<中©', 'nonascii', 'named'), '&lt;&#20013;&copy;');
  assert.equal(T.entityEncode('<中', 'nonascii', 'dec'), '&#60;&#20013;');
  assert.equal(T.entityEncode('<中', 'nonascii', 'hex'), '&#x3c;&#x4e2d;');
  assert.equal(T.entityEncode('ab\n', 'all', 'dec'), '&#97;&#98;\n');
  assert.deepEqual(T.entityDecode('&lt;&#20013;&#x4E2D;&copy;&nbsp;&foo;&#0;'), { text: '<中中©\u00a0&foo;&#0;', unknown: ['&foo;'] });
});

test('escape / unescape', () => {
  assert.equal(T.jsEscape("快JSON: 100% 本地处理"), "%u5FEBJSON%3A%20100%25%20%u672C%u5730%u5904%u7406");
  assert.equal(T.jsUnescape("%u5FEBJSON%3A%20100%25%20%u672C%u5730%u5904%u7406"), "快JSON: 100% 本地处理");
});

test('UTF-8 字节写法：6 种写法互转，自动识别', () => {
  const cases: [T.ByteFmt, string, string][] = [
    ['x', '\\xE4\\xB8\\xADa', '\\x 写法'],
    ['pct', '%E4%B8%ADa', '% 写法'],
    ['hex0x', '0xE4, 0xB8, 0xAD, 0x61', '十六进制'],
    ['space', 'E4 B8 AD 61', '十六进制'],
    ['dec', '[228, 184, 173, 97]', '十进制字节'],
    ['bin', '11100100 10111000 10101101 01100001', '二进制'],
  ];
  for (const [fmt, expect, label] of cases) {
    assert.equal(T.bytesFormat('中a', 'utf-8', fmt, true, true).text, expect, fmt);
    assert.deepEqual(T.bytesParse(expect, 'utf-8'), { text: '中a', fmt: label }, fmt);
  }
  assert.equal(T.bytesFormat('中a', 'utf-8', 'x', false, false).text, '\\xe4\\xb8\\xad\\x61');
  assert.equal(T.bytesParse("\\xE5\\xBF\\xABJSON \\xE4\\xB8\\xAD\\xE6\\x96\\x87", 'utf-8').text, "快JSON 中文");
  assert.equal(T.bytesParse('\\xD6\\xD0', 'gbk').text, '中');
  assert.equal(T.bytesParse('228,184,173', 'utf-8').text, '中');
  assert.throws(() => T.bytesParse('[300]', 'utf-8'), /0~255/);
  assert.throws(() => T.bytesParse('e4b', 'utf-8'), /偶数/);
});

test('十六进制 ⇄ 文本', () => {
  assert.equal(T.textToHex('中a', 'utf-8', 'space', false).text, 'e4 b8 ad 61');
  assert.equal(T.textToHex('中a', 'utf-8', 'none', true).text, 'E4B8AD61');
  assert.equal(T.textToHex('中a', 'utf-8', 'x', false).text, '\\xe4\\xb8\\xad\\x61');
  assert.equal(T.textToHex('中a', 'utf-8', '0x', false).text, '0xe4 0xb8 0xad 0x61');
  assert.equal(T.textToHex('中a', 'utf-8', 'comma', false).text, '0xe4, 0xb8, 0xad, 0x61');
  assert.equal(T.textToHex('中', 'gbk', 'none', false).text, 'd6d0');
  assert.equal(T.hexToText('e5bfab4a534f4e', 'utf-8'), '快JSON');
  assert.equal(T.hexToText('0xe4, 0xb8:0xad', 'utf-8'), '中');
  assert.throws(() => fromHex('zz'), /包含字符 "z"/);
});

test('摩斯密码', () => {
  const o = { dot: '.', dash: '-', letterSep: ' ', wordSep: ' / ' };
  assert.deepEqual(T.morseEncode('SOS Hello World', o), { text: '... --- ... / .... . .-.. .-.. --- / .-- --- .-. .-.. -..', skipped: [] });
  assert.deepEqual(T.morseEncode('Hi 中', o), { text: '.... ..', skipped: ['中'] });
  assert.equal(T.morseEncode('SOS', { ...o, dot: '·', dash: '−' }).text, '··· −−− ···');
  assert.deepEqual(T.morseDecode('... --- ... / .... ..', false), { text: 'SOS HI', unknown: [] });
  assert.equal(T.morseDecode('··· −−− ···', true).text, 'sos');
  assert.equal(T.morseDecode('...   ---', false).text, 'S O');
  assert.deepEqual(T.morseDecode('...... .-', false), { text: '?A', unknown: ['......'] });
});

test('迅雷 / 快车 / 旋风链接', () => {
  const links = T.encodeDownloadLinks("https://www.kuaijson.com/files/demo.zip");
  assert.deepEqual(links.map((l) => l.url).join('\n'), "thunder://QUFodHRwczovL3d3dy5rdWFpanNvbi5jb20vZmlsZXMvZGVtby56aXBaWg==\nflashget://W0ZMQVNIR0VUXWh0dHBzOi8vd3d3Lmt1YWlqc29uLmNvbS9maWxlcy9kZW1vLnppcFtGTEFTSEdFVF0=\nqqdl://aHR0cHM6Ly93d3cua3VhaWpzb24uY29tL2ZpbGVzL2RlbW8uemlw");
  for (const l of links) assert.deepEqual(T.decodeDownloadLink(l.url), { kind: l.kind, url: "https://www.kuaijson.com/files/demo.zip" });
  // 早期的链接是 GBK 编码的
  const gbk = encodeText('AAhttp://a.com/中文.zipZZ', 'gbk').bytes;
  assert.equal(T.decodeDownloadLink('thunder://' + toBase64(gbk)).url, 'http://a.com/中文.zip');
  assert.equal(T.decodeDownloadLink('flashget://W0ZMQVNIR0VUXWh0dHA6Ly9hLmNvbS9bRkxBU0hHRVRd&abc').url, 'http://a.com/');
  assert.throws(() => T.decodeDownloadLink('http://a.com'), /不是迅雷/);
});

test('邮箱防爬', () => {
  assert.ok(T.EMAIL_RE.test('a.b@c.co') && !T.EMAIL_RE.test('a@b') && !T.EMAIL_RE.test('<a@b.c>'));
  assert.equal(T.emailObfuscate('a@b.co', 'text'), 'a [at] b [dot] co');
  assert.equal(T.emailObfuscate('a@b.co', 'entity'), '<a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;&#97;&#64;&#98;&#46;&#99;&#111;">&#97;&#64;&#98;&#46;&#99;&#111;</a>');
  assert.equal(T.emailObfuscate('a@b.co', 'css'), '<span style="unicode-bidi:bidi-override;direction:rtl">oc.b@a</span>');
  const js = T.emailObfuscate('contact@kuaijson.com', 'js');
  assert.ok(js.includes('var u = "con" + "tac" + "t";') && js.includes('document.write'), js);
  assert.ok(!js.includes('contact@kuaijson.com'), '源码里不应该出现完整邮箱');
});

test('文件类型识别、文本判断、十六进制预览', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(detectType(png)?.ext, 'png');
  assert.equal(detectType(u('%PDF-1.7'))?.ext, 'pdf');
  assert.equal(detectType(u('hello')), null);
  assert.ok(looksLikeText('hello\n世界', u('hello\n世界')));
  assert.ok(!looksLikeText('\u0000\u0001\u0002ab', Uint8Array.from([0, 1, 2, 97, 98])));
  assert.equal(hexDump(u('ABC')), '00000000  ' + '41 42 43'.padEnd(47) + '  ABC');
});

test('工具定义：每个编码工具的示例都能正确处理（不报错）', () => {
  const src = readFileSync(new URL('../src/tools/encode/defs.ts', import.meta.url), 'utf8');
  const ids = [...src.slice(src.indexOf('export const ENCODE_DEFS')).matchAll(/^  '([\w/-]+)':/gm)].map((m) => m[1]);
  assert.equal(ids.length, 10);
  const catalog = readFileSync(new URL('../src/data/catalog.ts', import.meta.url), 'utf8');
  const start = catalog.indexOf("['encode'");
  const enc = catalog.slice(start, catalog.indexOf("['format','格式化'", start));
  const done = [...enc.matchAll(/\['([\w-]+)','[^']*','[^']*','[^']*done/g)].map((m) => 'encode/' + m[1]);
  for (const id of ids) assert.ok(done.includes(id), `${id} 已实现但目录里没有标记 done`);
  for (const id of done) assert.ok(ids.includes(id) || id === 'encode/unicode', `${id} 标记了 done 但没有实现`);
});
