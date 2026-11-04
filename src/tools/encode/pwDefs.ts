// 编码 / 加密类工具（3.4 密码和 ID）：随机密码生成、UUID
import { SETS } from '../../core/password';
import type { ListRow, Opts, ToolDef } from '../json/types';
import { bool, str } from '../json/types';
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

export const PW_DEFS: Record<string, ToolDef> = {
  'encode/password': password,
  'encode/uuid': uuid,
};
