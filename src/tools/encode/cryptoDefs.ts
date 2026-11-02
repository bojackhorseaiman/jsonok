// 编码 / 加密类工具（3.3 加解密）：对称加密、RSA、JWT。加解密代码用到时才加载
import * as Core from '../../core/json';
import type { ListRow, Opts, Result, ToolDef } from '../json/types';
import { bool, str } from '../json/types';
import { O_CS, TEXT, bytesOut, charset, help, join, lossyNote, onDir, size } from './defs';

const ci = () => import('../../core/cipher');
const rs = () => import('../../core/rsa');
const jw = () => import('../../core/jwt');
const by = () => import('../../core/bytes');
const cs = () => import('../../core/charset');

const BYTES_FMT: [string, string][] = [['text', '文字'], ['hex', '十六进制'], ['base64', 'Base64']];
const CT_IN: [string, string][] = [['auto', '自动识别'], ['base64', 'Base64'], ['hex', '十六进制']];
const CT_OUT: [string, string][] = [['base64', 'Base64'], ['hex', '十六进制']];
const KEY_TIP = '不会保存到浏览器，刷新页面后需要重新填写';

/** 文字 / 十六进制 / Base64 → 字节 */
async function toBytes(text: string, fmt: string, o: Opts): Promise<{ bytes: Uint8Array; lossy: number }> {
  const B = await by();
  if (fmt === 'hex') return { bytes: B.fromHex(text), lossy: 0 };
  if (fmt === 'base64') return { bytes: B.fromBase64(text).bytes, lossy: 0 };
  return (await cs()).encodeText(text, charset(o));
}

/** 读取密文 / 签名：自动识别十六进制和 Base64 */
async function readBytes(text: string, fmt: string): Promise<{ bytes: Uint8Array; fmt: string }> {
  const B = await by();
  const t = text.trim();
  if (fmt === 'hex' || (fmt === 'auto' && /^[0-9a-fA-F\s]+$/.test(t) && t.replace(/\s/g, '').length % 2 === 0)) {
    return { bytes: B.fromHex(t), fmt: '十六进制' };
  }
  return { bytes: B.fromBase64(t).bytes, fmt: 'Base64' };
}

async function writeBytes(b: Uint8Array, fmt: string): Promise<string> {
  const B = await by();
  return fmt === 'hex' ? B.toHex(b) : B.toBase64(b);
}

// ================= 对称加密 =================

const BLOCK = (o: Opts) => ['aes', 'des', '3des'].includes(str(o, 'algo'));
const NEEDS_IV = (o: Opts) => (BLOCK(o) && str(o, 'mode') !== 'ecb') || str(o, 'algo') === 'rabbit';
const RAW = (o: Opts) => str(o, 'keyMode') !== 'pass';
const SAMPLE_KEY: Record<string, [string, string]> = {
  aes: ['1234567890abcdef', 'abcdef1234567890'],
  des: ['12345678', 'abcdefgh'],
  '3des': ['123456789012345678901234', 'abcdefgh'],
  rc4: ['kuaijson', ''],
  rabbit: ['1234567890abcdef', 'abcdefgh'],
};
const KEY_LEN: Record<string, number> = { aes: 16, des: 8, '3des': 24, rc4: 16, rabbit: 16 };
const CIPHER_TEXT = '快JSON：数据只在本地处理，密钥不会上传';

async function runCipher(src: string, o: Opts, dir: string): Promise<Result> {
  const m = await ci();
  const algo = str(o, 'algo');
  const keyIn = str(o, 'key');
  if (!keyIn) {
    const B = await by();
    const n = KEY_LEN[algo] ?? 16;
    throw new Error(
      RAW(o)
        ? `请在上方填写密钥。需要随机密钥的话，可以用这个（${n} 字节，十六进制）：${B.toHex(B.randomBytes(n))}，并把“密钥格式”改成“十六进制”`
        : '请在上方填写口令',
    );
  }
  const key = await toBytes(keyIn, RAW(o) ? str(o, 'keyFmt') : 'text', o);
  const ivText = str(o, 'iv');
  const iv = RAW(o) && ivText && NEEDS_IV(o) && !bool(o, 'ivPrefix') ? await toBytes(ivText, str(o, 'ivFmt'), o) : { bytes: new Uint8Array(0), lossy: 0 };
  const opt = {
    algo: algo as 'aes', mode: str(o, 'mode') as 'cbc', padding: str(o, 'padding') as 'pkcs7',
    key: key.bytes, iv: iv.bytes, pass: !RAW(o), ivPrefix: bool(o, 'ivPrefix'), fix: bool(o, 'fix'),
  };
  if (dir === 'encrypt') {
    const pt = await toBytes(src, str(o, 'ptFmt'), o);
    const r = await m.encrypt(pt.bytes, opt);
    return { kind: 'text', text: await writeBytes(r.bytes, str(o, 'outFmt')), note: join(...r.notes, `${size(pt.bytes.length)} → ${size(r.bytes.length)}`, lossyNote(pt.lossy + key.lossy + iv.lossy, o)) };
  }
  const ct = await readBytes(src, str(o, 'ctFmt'));
  const r = await m.decrypt(ct.bytes, opt);
  return bytesOut(r.bytes, charset(o), 'kuaijson-decrypted', join(...r.notes, `密文按 ${ct.fmt} 解析`), undefined, '可能是密钥、IV 或模式不对（这些模式下密钥错了不会报错，只会得到乱码），也可能加密的本来就是文件');
}

const cipher: ToolDef = {
  ...TEXT,
  dirs: [['encrypt', '加密'], ['decrypt', '解密']],
  flip: { encrypt: 'decrypt', decrypt: 'encrypt' },
  opts: [
    { key: 'algo', label: '算法', type: 'select', options: [['aes', 'AES'], ['des', 'DES'], ['3des', '3DES（TripleDES）'], ['rc4', 'RC4'], ['rabbit', 'Rabbit']], def: 'aes' },
    { key: 'mode', label: '模式', type: 'select', options: [['cbc', 'CBC'], ['ecb', 'ECB'], ['cfb', 'CFB'], ['ofb', 'OFB'], ['ctr', 'CTR'], ['gcm', 'GCM（仅 AES）']], def: 'cbc', show: BLOCK },
    {
      key: 'padding', label: '填充', type: 'select', def: 'pkcs7', show: (o) => BLOCK(o) && ['cbc', 'ecb'].includes(str(o, 'mode')),
      options: [['pkcs7', 'PKCS7（PKCS5）'], ['zero', 'ZeroPadding'], ['none', '不填充'], ['iso10126', 'ISO 10126'], ['ansix923', 'ANSI X.923'], ['iso97971', 'ISO/IEC 9797-1']],
      title: 'Java 的 PKCS5Padding 就是 PKCS7；CFB / OFB / CTR / GCM 不需要填充',
    },
    {
      key: 'keyMode', label: '密钥方式', type: 'select', options: [['raw', '直接使用密钥'], ['pass', '口令（兼容 CryptoJS / OpenSSL）']], def: 'raw',
      title: '口令方式：用 MD5 从口令和随机盐推导出密钥和 IV，密文以 U2FsdGVkX1 开头，和 CryptoJS.AES.encrypt(文字, "口令")、openssl enc -md md5 的结果互通',
    },
    { key: 'key', label: '密钥', type: 'text', def: '', width: 200, noSave: true, placeholder: '密钥或口令', title: '密钥' + KEY_TIP },
    { key: 'keyFmt', label: '密钥格式', type: 'select', options: BYTES_FMT, def: 'text', show: RAW },
    {
      key: 'ivPrefix', label: '随机 IV 放在密文前面', type: 'check', def: false, show: (o) => RAW(o) && NEEDS_IV(o),
      title: '加密时随机生成 IV，放在密文最前面一起输出；解密时从密文前面读取 IV。比固定 IV 更安全',
    },
    { key: 'iv', label: 'IV', type: 'text', def: '', width: 170, noSave: true, placeholder: '初始向量', show: (o) => RAW(o) && NEEDS_IV(o) && !bool(o, 'ivPrefix'), title: 'IV' + KEY_TIP },
    { key: 'ivFmt', label: 'IV 格式', type: 'select', options: BYTES_FMT, def: 'text', show: (o) => RAW(o) && NEEDS_IV(o) && !bool(o, 'ivPrefix') },
    { key: 'fix', label: '长度不对时补 0', type: 'check', def: false, show: RAW, title: '密钥或 IV 的长度不对时，在后面补 0（或截断）。有些网站和老代码是这样处理的' },
    { key: 'ptFmt', label: '明文格式', type: 'select', options: BYTES_FMT, def: 'text', show: onDir('encrypt') },
    { key: 'outFmt', label: '输出', type: 'select', options: CT_OUT, def: 'base64', show: onDir('encrypt') },
    { key: 'ctFmt', label: '密文格式', type: 'select', options: CT_IN, def: 'auto', show: onDir('decrypt') },
    O_CS,
  ],
  inTitles: (d) => [d === 'encrypt' ? '明文' : '密文'],
  outTitle: (d) => (d === 'encrypt' ? '密文' : '明文'),
  placeholder: (d) => (d === 'encrypt' ? '输入要加密的内容…' : '粘贴密文（Base64 或十六进制）…'),
  sampleOpts: (_d, o) => {
    const algo = str(o, 'algo');
    const gcm = algo === 'aes' && str(o, 'mode') === 'gcm';
    const [k, iv] = SAMPLE_KEY[algo] ?? SAMPLE_KEY.aes;
    return {
      ...(str(o, 'mode') === 'gcm' && algo !== 'aes' ? { mode: 'cbc' } : {}),
      key: RAW(o) ? k : 'kuaijson', keyFmt: 'text', iv: gcm ? 'abcdef123456' : iv, ivFmt: 'text', ivPrefix: false, fix: false, ptFmt: 'text', ctFmt: 'auto',
    };
  },
  sample: async (d, o) => {
    if (d === 'encrypt') return [CIPHER_TEXT];
    const r = await runCipher(CIPHER_TEXT, { ...o, outFmt: 'base64' }, 'encrypt');
    return [r.kind === 'text' ? r.text : ''];
  },
  help:
    help([
      ['AES', '目前最常用；密钥 16 / 24 / 32 字节对应 AES-128 / 192 / 256'],
      ['DES / 3DES', '老系统常用；DES 已经不安全，3DES 也在逐步淘汰'],
      ['CBC / ECB', '最常见的模式。ECB 不用 IV，相同的内容加密结果相同，不推荐'],
      ['GCM', '带认证的模式，密文被改动会解密失败，推荐新系统使用'],
      ['RC4 / Rabbit', '流加密，不需要填充'],
    ], '和其他系统（Java、Python、PHP、CryptoJS）对接时，算法、模式、填充、密钥、IV 和字符编码要完全一致；Java 的 PKCS5Padding 就是 PKCS7。') +
    '<p>密钥和 IV 只在浏览器里使用，不会保存，也不会上传。</p>',
  run: (c) => runCipher(c.src[0], c.o, c.dir),
  ext: () => 'txt',
};

// ================= RSA =================

/** 最近生成的密钥对：示例会用它，这样加密、解密、签名、验签的示例能对得上。只在内存里，刷新页面就没了 */
let lastPair: { pub: string; priv: string } | null = null;

async function demoPair(): Promise<{ pub: string; priv: string }> {
  if (!lastPair) lastPair = await (await rs()).generateRsa(2048, 'pkcs8');
  return lastPair;
}

const RSA_TEXT = '快JSON：RSA 加密测试';
const RSA_TITLES: Record<string, string[]> = {
  enc: ['要加密的内容', '公钥（PEM 或 Base64）'],
  dec: ['密文', '私钥（PEM 或 Base64）'],
  sign: ['要签名的内容', '私钥（PEM 或 Base64）'],
  verify: ['原始内容', '公钥（PEM 或 Base64）'],
};
const RSA_OUT: Record<string, string> = { gen: '密钥对', enc: '密文', dec: '解密结果', sign: '签名', verify: '验签结果' };
const RSA_PH: Record<string, string> = {
  enc: '输入要加密的内容…',
  dec: '粘贴密文（Base64 或十六进制）…',
  sign: '输入要签名的内容…',
  verify: '输入签名时用的原始内容，并在上方“签名”框里粘贴签名…',
};

const rsa: ToolDef = {
  ...TEXT,
  dirs: [['gen', '生成密钥对'], ['enc', '公钥加密'], ['dec', '私钥解密'], ['sign', '签名'], ['verify', '验签']],
  flip: { enc: 'dec' },
  inputs: (d) => (d === 'gen' ? 0 : 2),
  inTitles: (d) => RSA_TITLES[d] ?? [],
  outTitle: (d) => RSA_OUT[d] ?? '结果',
  placeholder: (d, i) =>
    i === 1
      ? d === 'dec' || d === 'sign'
        ? '粘贴私钥：-----BEGIN PRIVATE KEY----- 或 -----BEGIN RSA PRIVATE KEY-----，也可以只粘贴中间的 Base64。私钥不会保存到浏览器'
        : '粘贴公钥：-----BEGIN PUBLIC KEY----- 或 -----BEGIN RSA PUBLIC KEY-----，也可以是证书，或者只有中间的 Base64'
      : RSA_PH[d] ?? '',
  noSaveInput: (d, i) => i === 1 && (d === 'dec' || d === 'sign'),
  rerun: (d) => d === 'gen',
  rerunLabel: '重新生成',
  opts: [
    { key: 'bits', label: '密钥长度', type: 'select', options: [['1024', '1024 位'], ['2048', '2048 位'], ['3072', '3072 位'], ['4096', '4096 位']], def: '2048', show: onDir('gen') },
    { key: 'privFmt', label: '私钥格式', type: 'select', options: [['pkcs8', 'PKCS#8（BEGIN PRIVATE KEY）'], ['pkcs1', 'PKCS#1（BEGIN RSA PRIVATE KEY）']], def: 'pkcs8', show: onDir('gen'), title: 'Java 一般用 PKCS#8；PHP、Python 的老代码常用 PKCS#1' },
    {
      key: 'pad', label: '填充', type: 'select', def: 'pkcs1', show: onDir('enc', 'dec'),
      options: [['pkcs1', 'PKCS#1 v1.5'], ['oaep1', 'OAEP（SHA-1）'], ['oaep256', 'OAEP（SHA-256）'], ['oaep256j', 'OAEP（SHA-256，MGF1 用 SHA-1）']],
      title: 'Java 的 RSA/ECB/PKCS1Padding 是 PKCS#1 v1.5；RSA/ECB/OAEPWithSHA-256AndMGF1Padding 默认是最后一种',
    },
    { key: 'segment', label: '内容太长时分段加密', type: 'check', def: true, show: onDir('enc'), title: '每段单独加密后拼在一起（Java 常用的写法），解密时会自动按段解密' },
    {
      key: 'salg', label: '签名算法', type: 'select', def: 'sha256', show: onDir('sign', 'verify'),
      options: [['sha256', 'SHA256withRSA'], ['sha1', 'SHA1withRSA'], ['sha384', 'SHA384withRSA'], ['sha512', 'SHA512withRSA'], ['md5', 'MD5withRSA'], ['pss256', 'SHA256withRSA/PSS']],
    },
    { key: 'sig', label: '签名', type: 'text', def: '', width: 260, noSave: true, placeholder: 'Base64 或十六进制', show: onDir('verify') },
    { key: 'ptFmt', label: '内容格式', type: 'select', options: BYTES_FMT, def: 'text', show: onDir('enc', 'sign', 'verify') },
    { key: 'outFmt', label: '输出', type: 'select', options: CT_OUT, def: 'base64', show: onDir('enc', 'sign') },
    { key: 'ctFmt', label: '密文格式', type: 'select', options: CT_IN, def: 'auto', show: onDir('dec') },
    { ...O_CS, show: (_o, d) => d !== 'gen' },
  ],
  sampleOpts: () => ({ ptFmt: 'text', ctFmt: 'auto' }),
  sample: async (d, o) => {
    const m = await rs();
    const p = await demoPair();
    const data = (await cs()).encodeText(RSA_TEXT, charset(o)).bytes;
    if (d === 'enc') return [RSA_TEXT, p.pub];
    if (d === 'dec') return [(await by()).toBase64(m.rsaEncrypt(m.parsePublicKey(p.pub).key, data, str(o, 'pad') as 'pkcs1', true).bytes), p.priv];
    if (d === 'sign') return [RSA_TEXT, p.priv];
    // 验签：签名放在上方的“签名”框里
    o.sig = (await by()).toBase64(m.rsaSign(m.parsePrivateKey(p.priv), data, str(o, 'salg') as 'sha256'));
    return [RSA_TEXT, p.pub];
  },
  help:
    '<p>“生成密钥对”在浏览器里生成，私钥不会上传。点其他功能的“示例”时，会用最近生成的那对密钥（还没生成过就自动生成一对），所以加密、解密、签名、验签的示例结果能对得上。</p>' +
    help([
      ['公钥加密 / 私钥解密', 'PKCS#1 v1.5 最常见（JSEncrypt、Java 默认）；OAEP 更安全。每次加密的结果都不一样，这是正常的'],
      ['分段加密', 'RSA 一次只能加密很短的内容（2048 位 PKCS#1 是 245 字节）。勾选后按段加密再拼接，和 Java 常见的写法一致'],
      ['签名 / 验签', 'SHA256withRSA 最常用（支付宝、微信支付等开放平台）'],
      ['密钥格式', '支持 PKCS#8、PKCS#1、X.509 证书，也可以只粘贴中间的 Base64（Java 里常见的写法）'],
    ]),
  run: async (c) => {
    const m = await rs();
    if (c.dir === 'gen') {
      const bits = Number(str(c.o, 'bits'));
      c.progress(`正在生成 ${bits} 位密钥…`);
      const t0 = performance.now();
      const p = await m.generateRsa(bits, str(c.o, 'privFmt') as 'pkcs8');
      lastPair = p;
      const rows: ListRow[] = [{ tone: 'info', cells: ['公钥', p.pub.trim()] }, { tone: 'info', cells: ['私钥', p.priv.trim()] }];
      return {
        kind: 'list', head: ['类型', '内容（点击复制）'], rows, okText: '', copyable: true,
        summary: `${bits} 位 RSA 密钥对 · 点击内容可以复制`,
        text: `${p.pub}\n${p.priv}`,
        note: join(`用时 ${Math.round(performance.now() - t0)} ms`, '私钥只在这个页面里，不会保存或上传'),
      };
    }
    const [data, keyText] = c.src;
    const salg = str(c.o, 'salg') as 'sha256' | 'sha1' | 'sha384' | 'sha512' | 'md5' | 'pss256';
    if (c.dir === 'enc') {
      const { key, from } = m.parsePublicKey(keyText);
      const pt = await toBytes(data, str(c.o, 'ptFmt'), c.o);
      const r = m.rsaEncrypt(key, pt.bytes, str(c.o, 'pad') as 'pkcs1', bool(c.o, 'segment'));
      return {
        kind: 'text', text: await writeBytes(r.bytes, str(c.o, 'outFmt')),
        note: join(`${m.keyBits(key)} 位密钥${from === '公钥' ? '' : `（从${from}里取出的公钥）`}`, r.segments > 1 ? `内容 ${size(pt.bytes.length)}，分成 ${r.segments} 段加密` : '', '每次加密结果都不一样，这是正常的', lossyNote(pt.lossy, c.o)),
      };
    }
    if (c.dir === 'dec') {
      const key = m.parsePrivateKey(keyText);
      const ct = await readBytes(data, str(c.o, 'ctFmt'));
      const r = m.rsaDecrypt(key, ct.bytes, str(c.o, 'pad') as 'pkcs1');
      return bytesOut(r.bytes, charset(c.o), 'kuaijson-rsa', join(`${m.keyBits(key)} 位密钥`, r.segments > 1 ? `分 ${r.segments} 段解密` : '', `密文按 ${ct.fmt} 解析`));
    }
    if (c.dir === 'sign') {
      const key = m.parsePrivateKey(keyText);
      const pt = await toBytes(data, str(c.o, 'ptFmt'), c.o);
      const sig = m.rsaSign(key, pt.bytes, salg);
      return { kind: 'text', text: await writeBytes(sig, str(c.o, 'outFmt')), note: join(`${m.SIGN_LABEL[salg]} · ${m.keyBits(key)} 位密钥`, salg === 'pss256' ? 'PSS 每次签名的结果都不一样，这是正常的' : '', lossyNote(pt.lossy, c.o)) };
    }
    const sigText = str(c.o, 'sig').trim();
    if (!sigText) throw new Error('请在上方“签名”框里粘贴要验证的签名（Base64 或十六进制）');
    const { key } = m.parsePublicKey(keyText);
    const pt = await toBytes(data, str(c.o, 'ptFmt'), c.o);
    const sig = await readBytes(sigText, 'auto');
    const ok = m.rsaVerify(key, pt.bytes, sig.bytes, salg);
    return {
      kind: 'text', tone: ok ? 'ok' : 'err',
      text: ok ? '✓ 签名正确：内容没有被改动过，并且是用对应的私钥签的名' : '✗ 签名不正确',
      note: join(`${m.SIGN_LABEL[salg]} · ${m.keyBits(key)} 位密钥`, ok ? '' : '可能是内容、签名或公钥不对，也可能签名算法、字符编码选错了'),
    };
  },
  ext: (d) => (d === 'gen' ? 'pem' : 'txt'),
};

// ================= JWT =================

const JWT_SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const JWT_SECRET = 'your-256-bit-secret';
const JWT_PAYLOAD = '{\n  "sub": "1234567890",\n  "name": "张三",\n  "role": "admin"\n}';
const ALG_OPTS: [string, string][] = [
  ['HS256', 'HS256（HMAC）'], ['HS384', 'HS384'], ['HS512', 'HS512'],
  ['RS256', 'RS256（RSA）'], ['RS384', 'RS384'], ['RS512', 'RS512'],
  ['PS256', 'PS256（RSA-PSS）'], ['PS384', 'PS384'], ['PS512', 'PS512'],
  ['ES256', 'ES256（ECDSA P-256）'], ['ES384', 'ES384'], ['ES512', 'ES512'],
  ['EdDSA', 'EdDSA（Ed25519）'],
];
const isHS = (o: Opts) => str(o, 'alg').startsWith('HS');

const jwt: ToolDef = {
  dirs: [['decode', '解析 / 验证'], ['sign', '签发']],
  flip: { sign: 'decode' },
  inputs: () => 2,
  jsonIn: (d, i) => d === 'sign' && i === 0,
  inTitles: (d) => (d === 'decode' ? ['JWT', '密钥或公钥（可选，填了就验证签名）'] : ['Payload（JSON）', '密钥或私钥']),
  outTitle: (d) => (d === 'decode' ? 'Header 和 Payload' : 'JWT'),
  placeholder: (d, i) =>
    d === 'decode'
      ? i === 0
        ? '粘贴 JWT（eyJ 开头，可以带 Bearer 前缀）…'
        : 'HS256 等：填密钥；RS / PS / ES：粘贴公钥 PEM，也可以是 JWK / JWKS。不填就只解析、不验证签名'
      : i === 0
        ? '输入 Payload，例如 {"sub":"1234567890","name":"张三"}'
        : 'HS256 等：填密钥；RS / PS / ES / EdDSA：粘贴 PKCS#8 私钥（-----BEGIN PRIVATE KEY-----）或 JWK。不会保存到浏览器',
  optionalInput: (d, i) => d === 'decode' && i === 1,
  // JWT 本身就是登录凭证，和私钥一样不保存到浏览器
  noSaveInput: (d, i) => d === 'decode' || i === 1,
  opts: [
    { key: 'alg', label: '算法', type: 'select', options: ALG_OPTS, def: 'HS256', show: onDir('sign') },
    {
      key: 'secretFmt', label: 'HS 密钥格式', type: 'select', options: [['text', '文字'], ['base64', 'Base64']], def: 'text',
      show: (o, d) => d === 'decode' || isHS(o), title: '有些系统（例如 Java 的 jjwt）会把密钥先按 Base64 解码再使用',
    },
    { key: 'kid', label: 'kid', type: 'text', def: '', width: 100, placeholder: '可选', show: onDir('sign'), title: '写进 Header 的密钥 ID' },
    { key: 'iat', label: '加上签发时间 iat', type: 'check', def: true, show: onDir('sign') },
    { key: 'exp', label: '有效期', type: 'select', options: [['0', '不设置 exp'], ['3600', '1 小时'], ['86400', '1 天'], ['604800', '7 天'], ['2592000', '30 天']], def: '0', show: onDir('sign') },
    { key: 'indent', label: '缩进', type: 'select', options: [['2', '2 空格'], ['4', '4 空格']], def: '2', show: onDir('decode') },
  ],
  sampleOpts: (d): Opts => (d === 'sign' ? { alg: 'HS256', secretFmt: 'text' } : { secretFmt: 'text' }),
  sample: (d) => (d === 'decode' ? [JWT_SAMPLE, JWT_SECRET] : [JWT_PAYLOAD, JWT_SECRET]),
  help:
    '<p>JWT 由 Header、Payload、Signature 三段组成。Header 和 Payload 只是 Base64 编码，任何人都能看到，不要放密码等敏感信息；签名用来防止被篡改。</p>' +
    help([
      ['HS256 / HS384 / HS512', '用同一个密钥签名和验证（HMAC）'],
      ['RS256 / PS256', 'RSA：私钥签发，公钥验证'],
      ['ES256 / EdDSA', '椭圆曲线：签名更短、更快'],
      ['iat / nbf / exp', '签发时间 / 生效时间 / 过期时间（秒级时间戳），解析时会换算成本地时间'],
    ]) +
    '<p>JWT 和密钥都不会保存到浏览器，也不会上传。</p>',
  run: async (c) => {
    const m = await jw();
    if (c.dir === 'decode') {
      const d = m.decodeJwt(c.src[0]);
      const notes: string[] = [`算法 ${d.alg || '（未指定）'}`];
      let tone: 'ok' | 'warn' | 'err' = 'ok';
      const t = m.timeClaims(d.payloadJS);
      for (const x of t.items) notes.push(`${x.label} ${m.fmtTime(x.date)}（${x.rel}）`);
      if (t.notYet) { tone = 'warn'; notes.unshift('⚠ 还没到生效时间'); }
      if (t.expired) { tone = 'warn'; notes.unshift('⚠ 已过期'); }
      const keyText = c.src[1].trim();
      if (keyText) {
        try {
          const v = await m.verifyJwt(d, keyText, str(c.o, 'secretFmt') as 'text');
          notes.unshift(v.message);
          if (!v.ok) tone = 'err';
        } catch (e) {
          notes.unshift('✗ 无法验证签名：' + (e instanceof Error ? e.message : String(e)));
          tone = 'err';
        }
      } else {
        notes.push('没有填密钥，只解析、未验证签名');
      }
      const node: Core.JNode = { t: 'o', items: [['header', d.header], ['payload', d.payload]] };
      return { kind: 'text', text: Core.stringify(node, c.fmt), json: true, note: join(...notes), tone };
    }
    const alg = str(c.o, 'alg');
    const r = await m.signJwt(c.json[0]!.root, {
      alg, keyText: c.src[1], secretFmt: str(c.o, 'secretFmt') as 'text', kid: str(c.o, 'kid'),
      iat: bool(c.o, 'iat'), expSec: Number(str(c.o, 'exp')) || 0, now: Date.now(),
    });
    return { kind: 'text', text: r.token, note: join(alg, r.exp ? `过期时间 ${m.fmtTime(r.exp)}` : '没有设置过期时间', r.warn) };
  },
  ext: (d) => (d === 'decode' ? 'json' : 'txt'),
};

// ================= 汇总 =================

export const CRYPTO_DEFS: Record<string, ToolDef> = {
  'encode/cipher': cipher,
  'encode/rsa': rsa,
  'encode/jwt': jwt,
};
