// 编码 / 加密类工具（3.4 密码和 ID）：随机密码生成、UUID、Bcrypt / Scrypt、数据库密码、htpasswd
import { SETS } from '../../core/password';
import type { ListRow, Opts, ToolDef } from '../json/types';
import { bool, inputErr, str } from '../json/types';
import { TEXT, help, join, onDir } from './defs';

const pw = () => import('../../core/password');

/** 读取整数选项，超出范围时给出中文提示 */
function intOpt(v: string, min: number, max: number, name: string): number {
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}应该是 ${min} ~ ${max} 的整数，现在是“${v}”`);
  return n;
}

const password: ToolDef = {
  inputs: () => 0,
  outTitle: () => '生成的密码',
  noSample: true,
  rerun: true,
  rerunLabel: '重新生成',
  opts: [
    { key: 'len', label: '长度', type: 'text', def: '16', width: 56, title: '4 ~ 128 个字符' },
    { key: 'count', label: '数量', type: 'text', def: '1', width: 56, title: '一次生成多少个（1 ~ 100）' },
    { key: 'upper', label: '大写 A-Z', type: 'check', def: true },
    { key: 'lower', label: '小写 a-z', type: 'check', def: true },
    { key: 'digit', label: '数字 0-9', type: 'check', def: true },
    { key: 'symbol', label: '符号', type: 'check', def: true },
    {
      key: 'symbols', label: '符号范围', type: 'text', def: SETS.symbol, width: 230, show: (o) => bool(o, 'symbol'),
      title: '可以改成系统允许的符号，例如有些系统只允许 !@#$%',
    },
    { key: 'noAmb', label: '排除易混淆字符', type: 'check', def: true, title: '排除 0 O o 1 l I |，抄写或口头告诉别人时不容易看错' },
    { key: 'each', label: '每种字符至少一个', type: 'check', def: true, title: '很多系统要求密码同时包含大写、小写、数字和符号' },
  ],
  help:
    '<p>密码用浏览器自带的安全随机数（<code>crypto.getRandomValues</code>）生成，每个字符等概率选取。生成的密码不会保存，也不会上传。</p>' +
    '<p>强度按“熵”估算：长度 × log2(字符种类数)。60 位以上算强，128 位以上很强。增加长度比增加符号更有效：16 位的字母加数字，已经比 10 位的全字符密码强得多。</p>',
  run: async (c) => {
    const m = await pw();
    const o = {
      length: intOpt(str(c.o, 'len'), 4, 128, '长度'),
      upper: bool(c.o, 'upper'), lower: bool(c.o, 'lower'), digit: bool(c.o, 'digit'), symbol: bool(c.o, 'symbol'),
      symbols: str(c.o, 'symbols'), noAmbiguous: bool(c.o, 'noAmb'), eachType: bool(c.o, 'each'),
    };
    const count = intOpt(str(c.o, 'count'), 1, 100, '数量');
    const size = m.poolSize(o);
    const bits = m.entropyBits(o.length, size);
    const s = m.strength(bits);
    const t = m.crackTime(bits);
    // “3 年”前面加空格，“超过 1 亿年”“不到 1 秒”前面不加
    const info = `强度：${s.label}（约 ${Math.round(bits)} 位熵，按每秒 1000 亿次猜测平均要${/^\d/.test(t) ? ' ' : ''}${t}）`;
    const list = Array.from({ length: count }, () => m.generatePassword(o));
    const pool = `字符池 ${size} 个字符`;
    if (count === 1) return { kind: 'text', text: list[0], note: join(info, pool), tone: s.level < 2 ? 'warn' : 'ok' };
    const rows: ListRow[] = list.map((p, i) => ({ tone: 'info', cells: [`密码 ${i + 1}`, p] }));
    return {
      kind: 'list', head: ['序号', '密码（点击复制）'], rows, okText: '', copyable: true,
      summary: `${count} 个密码 · ${info}`, tone: s.level < 2 ? 'err' : 'ok',
      text: list.join('\n'), note: pool,
    };
  },
  ext: () => 'txt',
};

// ================= UUID / GUID =================

const uu = () => import('../../core/uuid');
const NS_OPTS: [string, string][] = [['dns', 'DNS（域名）'], ['url', 'URL（网址）'], ['oid', 'OID'], ['x500', 'X.500'], ['custom', '自定义']];
const notParse = (_o: Opts, d: string) => d !== 'parse';
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const fmtLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
const UUID_SAMPLE = [
  '550e8400-e29b-41d4-a716-446655440000',
  '017F22E2-79B0-7CC3-98C4-DC0C0C07398F',
  '{C232AB00-9414-11EC-B3C8-9F6BDECED846}',
  'urn:uuid:2ed6657d-e927-568b-95e1-2665a8aea6a2',
  '00000000-0000-0000-0000-000000000000',
].join('\n');

const uuid: ToolDef = {
  ...TEXT,
  dirs: [['random', '随机生成'], ['name', '按名字生成'], ['parse', '解析']],
  inputs: (d) => (d === 'random' ? 0 : 1),
  inTitles: (d) => [d === 'name' ? '名字（一行一个）' : 'UUID（一行一个）'],
  outTitle: (d) => (d === 'parse' ? '解析结果' : '生成的 UUID'),
  placeholder: (d) =>
    d === 'name'
      ? '输入名字，一行一个，例如域名 www.example.com。同一个命名空间加同一个名字，生成的 UUID 永远相同'
      : '粘贴 UUID，一行一个。大小写、带不带横线、大括号、urn:uuid: 前缀都可以',
  rerun: (d) => d === 'random',
  rerunLabel: '重新生成',
  opts: [
    { key: 'ver', label: '版本', type: 'select', options: [['v4', 'v4（随机）'], ['v7', 'v7（按时间递增）']], def: 'v4', show: onDir('random') },
    { key: 'count', label: '数量', type: 'text', def: '1', width: 60, show: onDir('random'), title: '一次生成多少个（1 ~ 1000）' },
    { key: 'nver', label: '版本', type: 'select', options: [['v5', 'v5（SHA-1，推荐）'], ['v3', 'v3（MD5）']], def: 'v5', show: onDir('name') },
    { key: 'ns', label: '命名空间', type: 'select', options: NS_OPTS, def: 'dns', show: onDir('name') },
    {
      key: 'nsCustom', label: '自定义命名空间', type: 'text', def: '', width: 290, placeholder: '一个 UUID',
      show: (o, d) => d === 'name' && str(o, 'ns') === 'custom', title: '可以用任意一个 UUID 作为命名空间，例如给自己的项目固定一个',
    },
    { key: 'upper', label: '大写', type: 'check', def: false, show: notParse },
    { key: 'hyphen', label: '带横线', type: 'check', def: true, show: notParse },
    { key: 'braces', label: '加大括号 {}', type: 'check', def: false, show: notParse, title: 'Windows / .NET 里 GUID 的常见写法' },
  ],
  sampleOpts: (d): Opts => (d === 'name' ? { ns: 'dns', nver: 'v5' } : {}),
  sample: (d) => [d === 'name' ? 'www.example.com\nwww.kuaijson.com' : UUID_SAMPLE],
  help: help([
    ['v4', '完全随机，最常用'],
    ['v7', '前 48 位是毫秒时间戳，按生成顺序递增。做数据库主键时比 v4 好：新数据插在索引末尾，不会让索引变得零散'],
    ['v5 / v3', '命名空间 + 名字做哈希（SHA-1 / MD5），同样的输入永远得到同样的 UUID，适合给已有的数据（网址、域名、业务编号）生成固定 ID'],
    ['GUID', '微软的叫法，和 UUID 是同一种东西；Windows 里常写成大写、加大括号'],
    ['解析', '看出 UUID 的版本；v1 / v6 / v7 还能看出生成时间（按本地时间显示）'],
  ], 'UUID 用浏览器自带的安全随机数生成，不会上传。') + '<p>按名字生成时，每行首尾的空格会被去掉，名字按 UTF-8 编码。</p>',
  run: async (c) => {
    const m = await uu();
    const fmt = { upper: bool(c.o, 'upper'), hyphen: bool(c.o, 'hyphen'), braces: bool(c.o, 'braces') };
    if (c.dir === 'random') {
      const count = intOpt(str(c.o, 'count'), 1, 1000, '数量');
      const v7 = str(c.o, 'ver') === 'v7';
      const gen = v7 ? m.v7Generator() : m.v4;
      const list = Array.from({ length: count }, () => m.formatUuid(gen(), fmt));
      return {
        kind: 'text', text: list.join('\n'),
        note: join(v7 ? 'v7：前 48 位是毫秒时间戳，按生成顺序递增' : 'v4：122 位随机数，重复的概率可以忽略', count > 1 ? `共 ${count} 个，一行一个` : ''),
      };
    }
    if (c.dir === 'name') {
      const nsKey = str(c.o, 'ns');
      let nsText = m.NAMESPACES[nsKey];
      if (nsKey === 'custom') {
        nsText = str(c.o, 'nsCustom').trim();
        if (!nsText) throw new Error('请在上方“自定义命名空间”里填一个 UUID');
      }
      let ns: Uint8Array;
      try {
        ns = m.uuidBytes(nsText);
      } catch (e) {
        throw new Error('自定义命名空间' + (e instanceof Error ? e.message.replace(/^不是有效的 UUID/, '不是有效的 UUID') : ''));
      }
      const lines = c.src[0].split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const v3 = str(c.o, 'nver') === 'v3';
      const enc = new TextEncoder();
      const list = lines.map((l) => m.formatUuid((v3 ? m.v3 : m.v5)(ns, enc.encode(l)), fmt));
      const nsLabel = NS_OPTS.find(([v]) => v === nsKey)?.[1] ?? nsKey;
      return { kind: 'text', text: list.join('\n'), note: join(v3 ? 'v3（MD5）' : 'v5（SHA-1）', `命名空间 ${nsLabel}`, `${lines.length} 个`) };
    }
    const lines = c.src[0].split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    let bad = 0;
    const rows: ListRow[] = lines.map((l) => {
      try {
        const x = m.inspectUuid(l);
        const desc = [x.variant && x.variant !== 'RFC 9562' ? `变体：${x.variant}` : '', x.time ? `生成时间 ${fmtLocal(x.time)}` : '', ...x.notes].filter(Boolean).join('；');
        return { tone: 'info', cells: [x.label, x.canonical, desc] };
      } catch (e) {
        bad++;
        return { tone: 'err', cells: ['无效', l, e instanceof Error ? e.message : String(e)] };
      }
    });
    return {
      kind: 'list', head: ['版本', 'UUID（规范写法）', '说明'], rows, okText: '', copyable: true,
      summary: `解析了 ${lines.length} 个${bad ? `，其中 ${bad} 个无效` : ''} · 点击 UUID 可以复制`,
      tone: bad === lines.length ? 'err' : undefined,
      text: rows.map((r) => r.cells.join('\t')).join('\n'),
    };
  },
  ext: () => 'txt',
};

// ================= Bcrypt / Scrypt =================

const kd = () => import('../../core/kdf');
const isB = (o: Opts) => str(o, 'algo') === 'bcrypt';
const isS = (o: Opts) => str(o, 'algo') === 'scrypt';
const COSTS: [string, string][] = Array.from({ length: 12 }, (_, i) => {
  const c = i + 4;
  return [String(c), `${c}${c === 10 ? '（默认）' : c >= 13 ? '（较慢）' : ''}`];
});
const LNS: [string, string][] = Array.from({ length: 9 }, (_, i) => {
  const ln = i + 10;
  return [String(ln), `${2 ** ln}（2^${ln}）${ln === 14 ? ' 默认' : ln === 17 ? ' OWASP 推荐' : ''}`];
});
const KDF_PW = 'kuaijson@2026';
const ms = (t0: number) => `用时 ${Math.round(performance.now() - t0)} ms`;
const pct = (f: number) => `计算中 ${Math.round(f * 100)}%`;
/** 运行 fn，出错时把提示显示在第二个输入框（哈希）下面 */
async function onHash<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw inputErr(e, 1);
  }
}

/** 输入框里的密码：去掉末尾的换行（空格保留）；中间有换行时报错 */
function onePassword(src: string): string {
  const pw = src.replace(/[\r\n]+$/, '');
  if (/[\r\n]/.test(pw)) throw new Error('密码里有换行。一次只处理一个密码；末尾的换行会自动去掉');
  return pw;
}

function scryptParams(o: Opts): { ln: number; r: number; p: number; dkLen: number } {
  return { ln: Number(str(o, 'ln')), r: intOpt(str(o, 'r'), 1, 32, 'r（块大小）'), p: intOpt(str(o, 'p'), 1, 16, 'p（并行度）'), dkLen: Number(str(o, 'dkLen')) };
}

const kdf: ToolDef = {
  ...TEXT,
  dirs: [['gen', '生成哈希'], ['check', '验证密码']],
  inputs: (d) => (d === 'gen' ? 1 : 2),
  inTitles: (d) => (d === 'gen' ? ['密码'] : ['密码', '哈希值']),
  outTitle: (d) => (d === 'gen' ? '哈希结果' : '验证结果'),
  placeholder: (_d, i) =>
    i === 0
      ? '输入密码。末尾的换行会自动去掉，空格会保留'
      : '粘贴哈希：Bcrypt 是 $2a$ / $2b$ / $2y$ 开头的 60 个字符；Scrypt 是 $scrypt$ln=…$盐$哈希，或者只有密钥（十六进制 / Base64，盐和参数在上方填写）',
  noSaveInput: () => true,
  noBackfill: true,
  rerun: (d) => d === 'gen',
  rerunLabel: '重新生成（换一个盐）',
  opts: [
    { key: 'algo', label: '算法', type: 'select', options: [['bcrypt', 'Bcrypt'], ['scrypt', 'Scrypt']], def: 'bcrypt', title: '验证时会按哈希的格式自动识别算法' },
    { key: 'cost', label: '强度', type: 'select', options: COSTS, def: '10', show: (o, d) => isB(o) && d === 'gen', title: '每加 1，计算时间翻一倍。现在一般用 10 ~ 12' },
    {
      key: 'prefix', label: '前缀', type: 'select', def: '2b', show: (o, d) => isB(o) && d === 'gen',
      options: [['2b', '$2b$（Node / Python / Go）'], ['2y', '$2y$（PHP）'], ['2a', '$2a$（Java Spring 等）']],
      title: '三种前缀的算法相同，只是不同语言的习惯写法，各种语言一般都能互认',
    },
    { key: 'ln', label: 'N', type: 'select', options: LNS, def: '14', show: isS, title: 'CPU / 内存开销，越大越慢、越安全。验证 $scrypt$ 字符串时以字符串里的参数为准' },
    { key: 'r', label: 'r', type: 'text', def: '8', width: 44, show: isS, title: '块大小，一般用 8' },
    { key: 'p', label: 'p', type: 'text', def: '1', width: 44, show: isS, title: '并行度，一般用 1' },
    { key: 'dkLen', label: '密钥长度', type: 'select', options: [['32', '32 字节'], ['64', '64 字节'], ['16', '16 字节']], def: '32', show: (o, d) => isS(o) && d === 'gen' },
    {
      key: 'saltMode', label: '盐', type: 'select', def: 'random', show: isS,
      options: [['random', '随机生成（16 字节）'], ['text', '文字'], ['hex', '十六进制'], ['base64', 'Base64']],
      title: '验证“只有密钥”的哈希时，需要填写原来的盐',
    },
    { key: 'salt', label: '盐的值', type: 'text', def: '', width: 200, noSave: true, show: (o) => isS(o) && str(o, 'saltMode') !== 'random' },
  ],
  sampleOpts: (_d, o): Opts => (isS(o) ? { saltMode: 'random' } : {}),
  sample: async (d, o) => {
    if (d === 'gen') return [KDF_PW];
    const m = await kd();
    if (isB(o)) return [KDF_PW, await m.bcryptHash(KDF_PW, { cost: 10, prefix: '2y' })];
    const prm = { ln: 14, r: 8, p: 1, dkLen: 32 };
    const salt = m.newSalt();
    return [KDF_PW, m.scryptPhc(prm, salt, await m.scryptDerive(new TextEncoder().encode(KDF_PW), salt, prm))];
  },
  help:
    help([
      ['Bcrypt', '最常用的密码哈希。每次生成都会随机加盐，所以同一个密码每次的结果都不一样，这是正常的；验证时用原密码和哈希比对'],
      ['强度', 'Bcrypt 的计算强度，每加 1 计算时间翻一倍。PHP 默认 10，Spring 默认 10'],
      ['$2a$ / $2b$ / $2y$', '同一种算法的不同写法：PHP 用 $2y$，Node / Python 用 $2b$，Java 常见 $2a$'],
      ['Scrypt', '比 Bcrypt 更耗内存，更能抵抗显卡破解。结果用 PHC 标准写法 $scrypt$ln=14,r=8,p=1$盐$哈希，和 Python passlib 互通'],
    ]) +
    '<p>注意：Bcrypt 只使用密码的前 72 个字节（一个汉字占 3 个字节），超出的部分不起作用，超过时会提醒。密码和哈希都不会保存到浏览器，也不会上传。</p>',
  run: async (c) => {
    const m = await kd();
    const t0 = performance.now();
    const pw = onePassword(c.src[0]);
    if (c.dir === 'gen') {
      if (isB(c.o)) {
        const over = m.bcryptOverLimit(pw);
        const cost = Number(str(c.o, 'cost'));
        const h = await m.bcryptHash(pw, { cost, prefix: str(c.o, 'prefix') as '2b', onProgress: (f) => c.progress(pct(f)) });
        return {
          kind: 'text', text: h, tone: over ? 'warn' : 'ok',
          note: join(over ? `⚠ 密码超过 72 字节，后面的 ${over} 个字节不起作用` : '', `Bcrypt，强度 ${cost}（${2 ** cost} 轮）`, ms(t0), '每次生成的结果都不同，这是正常的'),
        };
      }
      const prm = scryptParams(c.o);
      const mode = str(c.o, 'saltMode') as 'random';
      let salt: Uint8Array;
      if (mode === 'random') salt = m.newSalt();
      else {
        if (!str(c.o, 'salt')) throw new Error('请在上方“盐的值”里填写盐，或者把“盐”改成“随机生成”');
        salt = m.readBytes(str(c.o, 'salt'), mode);
      }
      const key = await m.scryptDerive(new TextEncoder().encode(pw), salt, prm, { onProgress: (f) => c.progress(pct(f)), stale: c.stale });
      const B = await import('../../core/bytes');
      const phc = m.scryptPhc(prm, salt, key);
      const rows: ListRow[] = [
        { tone: 'info', cells: ['标准字符串', phc] },
        { tone: 'info', cells: ['密钥（十六进制）', B.toHex(key)] },
        { tone: 'info', cells: ['密钥（Base64）', B.toBase64(key)] },
        { tone: 'info', cells: ['盐（十六进制）', B.toHex(salt)] },
        { tone: 'info', cells: ['盐（Base64）', B.toBase64(salt)] },
      ];
      return {
        kind: 'list', head: ['格式', '值（点击复制）'], rows, okText: '', copyable: true,
        summary: `Scrypt，N=${2 ** prm.ln}，r=${prm.r}，p=${prm.p}，${prm.dkLen} 字节 · ${ms(t0)} · 约需 ${Math.round(m.scryptMemory(prm) / 1048576)} MB 内存`,
        text: rows.map((r) => `${r.cells[0]}: ${r.cells[1]}`).join('\n'),
        note: mode === 'random' ? '盐是随机生成的，验证时需要它（标准字符串里已经包含）' : '',
      };
    }
    // ---------- 验证：按哈希格式自动识别算法 ----------
    const hash = c.src[1].trim();
    const result = (ok: boolean, info: string) => ({
      kind: 'text' as const, tone: ok ? ('ok' as const) : ('err' as const),
      text: ok ? '✓ 密码正确' : '✗ 密码不正确',
      note: join(info, ms(t0), ok ? '' : '请检查密码是否有多余的空格、大小写是否正确'),
    });
    if (/^\$2[abxy]\$/.test(hash)) {
      const r = await onHash(() => m.bcryptVerify(pw, hash, (f) => c.progress(pct(f))));
      const auto = isS(c.o) ? '按哈希格式识别为 Bcrypt' : '';
      return result(r.ok, join(auto, `Bcrypt ${r.info.prefix}，强度 ${r.info.cost}`, m.bcryptOverLimit(pw) ? '⚠ 密码超过 72 字节，只比较了前 72 个字节' : ''));
    }
    if (m.isScryptPhc(hash)) {
      const x = await onHash(() => m.parseScryptPhc(hash));
      const key = await m.scryptDerive(new TextEncoder().encode(pw), x.salt, x.prm, { onProgress: (f) => c.progress(pct(f)), stale: c.stale });
      return result(m.sameBytes(key, x.key), join(isB(c.o) ? '按哈希格式识别为 Scrypt' : '', `Scrypt，N=${2 ** x.prm.ln}，r=${x.prm.r}，p=${x.prm.p}`));
    }
    if (isB(c.o)) await onHash(() => m.parseBcrypt(hash));
    // Scrypt：只有密钥，盐和参数在上方填写
    const mode = str(c.o, 'saltMode');
    if (mode === 'random' || !str(c.o, 'salt')) {
      throw new Error('验证只有密钥的 Scrypt 哈希，需要原来的盐：请在上方选择盐的格式并填写，或者粘贴 $scrypt$ 开头的完整字符串');
    }
    let want: Uint8Array;
    try {
      want = m.readKey(hash);
    } catch {
      throw inputErr('无法识别哈希值：Scrypt 的密钥应该是十六进制或 Base64，或者 $scrypt$ 开头的完整字符串', 1);
    }
    const prm = { ...scryptParams(c.o), dkLen: want.length };
    const key = await m.scryptDerive(new TextEncoder().encode(pw), m.readBytes(str(c.o, 'salt'), mode as 'hex'), prm, { onProgress: (f) => c.progress(pct(f)), stale: c.stale });
    return result(m.sameBytes(key, want), `Scrypt，N=${2 ** prm.ln}，r=${prm.r}，p=${prm.p}，${want.length} 字节`);
  },
  ext: () => 'txt',
};


// ================= 数据库密码 =================

const dbm = () => import('../../core/dbpass');
const DBS: [string, string][] = [
  ['mysql', 'MySQL / MariaDB（mysql_native_password）'],
  ['pg-scram', 'PostgreSQL SCRAM-SHA-256（10 以上）'],
  ['pg-md5', 'PostgreSQL md5（旧版）'],
];
const onDb = (...k: string[]) => (o: Opts, d: string) => d === 'gen' && k.includes(str(o, 'db'));

const dbPass: ToolDef = {
  ...TEXT,
  dirs: [['gen', '生成哈希'], ['check', '验证密码']],
  inputs: (d) => (d === 'gen' ? 1 : 2),
  inTitles: (d) => (d === 'gen' ? ['密码'] : ['密码', '数据库里的哈希值']),
  outTitle: (d) => (d === 'gen' ? '哈希和 SQL 语句' : '验证结果'),
  placeholder: (_d, i) =>
    i === 0
      ? '输入密码。末尾的换行会自动去掉，空格会保留'
      : '粘贴哈希，会自动识别：MySQL 是 * 开头的 41 个字符；PostgreSQL 是 md5 开头的 35 个字符，或 SCRAM-SHA-256$ 开头',
  noSaveInput: () => true,
  noBackfill: true,
  opts: [
    { key: 'db', label: '数据库', type: 'select', options: DBS, def: 'mysql', show: onDir('gen') },
    {
      key: 'user', label: '用户名', type: 'text', def: '', width: 130, placeholder: '例如 app_user',
      title: '用在生成的 SQL 语句里。PostgreSQL md5 的哈希里包含用户名，生成和验证时都必须填写',
    },
    { key: 'host', label: '主机', type: 'text', def: '%', width: 110, show: onDb('mysql'), title: "MySQL 账号的主机部分，'%' 表示任意主机，'localhost' 表示只允许本机" },
    { key: 'iter', label: '迭代次数', type: 'text', def: '4096', width: 80, show: onDb('pg-scram'), title: 'PostgreSQL 默认 4096（scram_iterations 设置）' },
  ],
  sampleOpts: (d): Opts => (d === 'gen' ? { user: 'kuaijson' } : {}),
  sample: (d) => (d === 'gen' ? ['kuaijson@2026'] : ['password', '*2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19']),
  help:
    help([
      ['MySQL / MariaDB', 'mysql_native_password：* 加上 SHA1(SHA1(密码)) 的大写十六进制，共 41 个字符。MySQL 5.x 和 MariaDB 的默认方式'],
      ['MySQL 8', '默认改用 caching_sha2_password（$A$ 开头），这里不支持；mysql_native_password 在 8.4 默认关闭，9.0 已移除'],
      ['PostgreSQL SCRAM', 'PostgreSQL 10 开始支持，14 起是默认方式。每次生成的盐都是随机的，所以结果都不同，这是正常的'],
      ['PostgreSQL md5', 'md5 加上 MD5(密码 + 用户名)。用户名不同，哈希也不同；改用户名后密码会失效'],
    ]) +
    '<p>生成的 SQL 语句直接把哈希交给数据库，明文密码不会出现在 SQL 和数据库日志里。密码不会保存到浏览器，也不会上传。</p>',
  run: async (c) => {
    const m = await dbm();
    const t0 = performance.now();
    const pw = onePassword(c.src[0]);
    const user = str(c.o, 'user').trim();
    if (c.dir === 'check') {
      await onHash(() => {
        const d = m.detectDbHash(c.src[1]);
        if (d.kind === 'pg-scram') m.parseScram(d.norm);
      });
      const r = await m.verifyDb(pw, c.src[1], user);
      return {
        kind: 'text', tone: r.ok ? 'ok' : 'err', text: r.ok ? '✓ 密码正确' : '✗ 密码不正确',
        note: join(r.d.label, r.d.note ?? '', r.detail, ms(t0), r.ok ? '' : r.d.kind === 'pg-md5' ? '请检查密码和用户名（区分大小写）' : '请检查密码是否有多余的空格、大小写是否正确'),
      };
    }
    const kind = str(c.o, 'db') as 'mysql';
    const notes: string[] = [];
    let hash: string;
    if (kind === 'mysql') {
      hash = m.mysqlNative(pw);
      notes.push('MySQL 8 默认不用这种方式，SQL 里已写明 mysql_native_password');
    } else if (kind === 'pg-md5') {
      if (!user) throw new Error('PostgreSQL md5 的哈希里包含用户名，请在上方填写用户名');
      hash = m.pgMd5(pw, user);
      notes.push('PostgreSQL 14 起默认使用 SCRAM-SHA-256，md5 只建议用在旧版本');
    } else {
      const iter = intOpt(str(c.o, 'iter'), 1, 10_000_000, '迭代次数');
      hash = await m.pgScram(pw, iter);
      const prep = m.saslPrep(pw);
      if (prep.changed) notes.push('密码按 PostgreSQL 的规则做了规范化（例如全角字母变成半角、去掉不可见字符）');
      if (prep.raw) notes.push('密码里有控制字符，按原样计算（和 PostgreSQL 一致）');
      notes.push('盐是随机生成的，每次结果都不同');
    }
    if (kind !== 'mysql' && /[A-Z]/.test(user)) notes.push('提醒：PostgreSQL 里不加引号创建的用户名会变成小写，用户名要和数据库里的完全一致');
    if (!user) notes.push('没有填写用户名，SQL 里用 username 代替');
    const rows: ListRow[] = [
      { tone: 'info', cells: ['哈希值', hash] },
      ...m.sqlFor(kind, hash, user, str(c.o, 'host').trim()).map((l): ListRow => ({ tone: 'mod', cells: [l.label, l.sql] })),
    ];
    return {
      kind: 'list', head: ['内容', '值（点击复制）'], rows, okText: '', copyable: true,
      summary: `${DBS.find(([v]) => v === kind)?.[1]} · ${ms(t0)}`,
      text: rows.map((r) => (r.cells[0] === '哈希值' ? r.cells[1] : `-- ${r.cells[0]}\n${r.cells[1]}`)).join('\n'),
      note: notes.join(' · '),
    };
  },
  ext: () => 'txt',
};


// ================= htpasswd =================

const htm = () => import('../../core/htpasswd');
const HT_ALGOS: [string, string][] = [
  ['bcrypt', 'Bcrypt（$2y$，最安全）'],
  ['apr1', 'APR1-MD5（$apr1$，兼容性最好）'],
  ['sha1', 'SHA-1（{SHA}，不加盐，不推荐）'],
];
const HT_SAMPLE = '# 示例：两个账号的密码都是 kuaijson@2026\nadmin:$apr1$kuaijson$gDpVRrmPPxkoibpDa9IEu0\nguest:{SHA}EvYduSeb2aF2Mav/G9bWJRR5kJs=';

const htpasswd: ToolDef = {
  ...TEXT,
  dirs: [['gen', '生成'], ['check', '验证密码']],
  inputs: (d) => (d === 'gen' ? 1 : 2),
  inTitles: (d) => (d === 'gen' ? ['账号（一行一个：用户名:密码）'] : ['密码', 'htpasswd 文件内容']),
  outTitle: (d) => (d === 'gen' ? 'htpasswd 文件内容' : '验证结果'),
  placeholder: (d, i) =>
    d === 'gen'
      ? '每行一个账号，格式是 用户名:密码，例如\nadmin:kuaijson@2026\nalice:Alice#2026\n按第一个冒号分开，所以密码里可以有冒号'
      : i === 0
        ? '输入要验证的密码'
        : '粘贴 htpasswd 文件的内容（可以有多行，# 开头的是注释），或者只粘贴一个哈希。有多个账号时，按上方的“用户名”查找',
  noSaveInput: () => true,
  noBackfill: true,
  rerun: (d) => d === 'gen',
  rerunLabel: '重新生成（换一个盐）',
  opts: [
    { key: 'algo', label: '算法', type: 'select', options: HT_ALGOS, def: 'bcrypt', show: onDir('gen') },
    { key: 'cost', label: '强度', type: 'select', options: COSTS, def: '10', show: (o, d) => d === 'gen' && str(o, 'algo') === 'bcrypt', title: 'Apache 的 htpasswd 命令默认是 5，建议用 10 以上。每加 1，计算时间翻一倍' },
    { key: 'user', label: '用户名', type: 'text', def: '', width: 130, placeholder: '只有一个账号时可以不填', show: onDir('check') },
  ],
  sampleOpts: (d): Opts => (d === 'check' ? { user: 'admin' } : {}),
  sample: (d) => (d === 'gen' ? ['admin:kuaijson@2026\nalice:Alice#2026'] : ['kuaijson@2026', HT_SAMPLE]),
  help:
    help([
      ['Bcrypt', '最安全。Apache 2.4 起支持；Nginx 能不能用取决于服务器系统自带的加密库，较新的 Linux 一般可以，较老的系统可能不行'],
      ['APR1-MD5', 'Apache htpasswd 命令的默认算法，Nginx 和 Apache 都支持，兼容性最好。不确定服务器支不支持 Bcrypt 时用它'],
      ['SHA-1', '不加盐，同样的密码哈希也相同，容易被破解，只为兼容旧系统保留'],
      ['Nginx 配置', 'auth_basic "请登录"; auth_basic_user_file /etc/nginx/.htpasswd;'],
      ['Apache 配置', 'AuthType Basic、AuthName "请登录"、AuthUserFile /etc/apache2/.htpasswd、Require valid-user'],
    ]) +
    '<p>把结果保存成 <code>.htpasswd</code> 文件放到服务器上即可。Bcrypt 和 APR1 每次生成都会随机加盐，所以结果都不一样，这是正常的。密码不会保存到浏览器，也不会上传。</p>',
  run: async (c) => {
    const m = await htm();
    const t0 = performance.now();
    if (c.dir === 'gen') {
      const { list, warns } = m.parseAccounts(c.src[0]);
      if (list.length > 200) throw new Error(`一次最多 200 个账号，现在是 ${list.length} 个`);
      const algo = str(c.o, 'algo') as 'bcrypt' | 'apr1' | 'sha1';
      const cost = Number(str(c.o, 'cost'));
      const kdfm = await import('../../core/kdf');
      const lines: string[] = [];
      for (const [i, a] of list.entries()) {
        if (c.stale()) throw new Error('已取消');
        if (list.length > 1) c.progress(`计算中 ${i + 1} / ${list.length}`);
        if (algo === 'bcrypt' && kdfm.bcryptOverLimit(a.pw)) warns.push(`${a.user} 的密码超过 72 字节，超出部分不起作用`);
        lines.push(`${a.user}:${await m.htHash(a.pw, algo, cost)}`);
      }
      const tip =
        algo === 'bcrypt' ? `Bcrypt，强度 ${cost} · Nginx 登录不了时改用 APR1`
        : algo === 'apr1' ? 'APR1-MD5，Nginx 和 Apache 都支持'
        : '⚠ SHA-1 不加盐，不推荐';
      return {
        kind: 'text', text: lines.join('\n'), tone: warns.length || algo === 'sha1' ? 'warn' : 'ok',
        note: join(...warns.map((w) => '⚠ ' + w), `${list.length} 个账号`, tip, ms(t0)),
      };
    }
    // ---------- 验证 ----------
    const pw = onePassword(c.src[0]);
    const entries = m.parseHtpasswd(c.src[1]);
    if (!entries.length) throw inputErr('请粘贴 htpasswd 文件内容或一个哈希', 1);
    const user = str(c.o, 'user').trim();
    let e = entries[0];
    if (user) {
      const f = entries.find((x) => x.user === user);
      if (!f) {
        const names = entries.map((x) => x.user).filter(Boolean);
        if (!(entries.length === 1 && !entries[0].user)) {
          throw inputErr(`没有找到用户名 ${user}（区分大小写）${names.length ? `。文件里的用户名：${names.slice(0, 10).join('、')}${names.length > 10 ? ' 等' : ''}` : ''}`, 1);
        }
      } else e = f;
    } else if (entries.length > 1) {
      throw inputErr(`有 ${entries.length} 个账号，请在上方“用户名”里填写要验证哪一个：${entries.map((x) => x.user || '（没有用户名）').slice(0, 10).join('、')}`, 1);
    }
    const r = await onHash(() => m.htVerify(pw, e.hash));
    return {
      kind: 'text', tone: r.ok ? 'ok' : 'err', text: r.ok ? '✓ 密码正确' : '✗ 密码不正确',
      note: join(e.user ? `用户名 ${e.user}（第 ${e.line} 行）` : '', r.label, ms(t0), r.ok ? '' : '请检查密码是否有多余的空格、大小写是否正确'),
    };
  },
  ext: () => 'txt',
};

export const PW_DEFS: Record<string, ToolDef> = {
  'encode/password': password,
  'encode/uuid': uuid,
  'encode/bcrypt': kdf,
  'encode/db-pass': dbPass,
  'encode/htpasswd': htpasswd,
};
