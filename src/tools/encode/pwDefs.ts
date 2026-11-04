// 编码 / 加密类工具（3.4 密码和 ID）：随机密码生成
import { SETS } from '../../core/password';
import type { ListRow, ToolDef } from '../json/types';
import { bool, str } from '../json/types';
import { join } from './defs';

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

export const PW_DEFS: Record<string, ToolDef> = {
  'encode/password': password,
};
