// 随机密码：用浏览器自带的安全随机数（crypto.getRandomValues），均匀取字符，没有取模偏差
import { randomInt } from './bytes.ts';

export const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?/~',
};

/** 容易看错的字符：0 和 O / o，1 和 l / I / | */
export const AMBIGUOUS = '0Oo1lI|';

export interface PwOpt {
  length: number;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  symbol: boolean;
  /** 允许使用的符号（可以改成系统允许的范围） */
  symbols: string;
  /** 排除容易看错的字符 */
  noAmbiguous: boolean;
  /** 选中的每种字符至少出现一个 */
  eachType: boolean;
}

export interface Pool { name: string; chars: string[] }

const NAMES = { upper: '大写字母', lower: '小写字母', digit: '数字', symbol: '符号' } as const;

/** 每种字符各自的字符池：去掉空白、重复字符，按需去掉容易看错的字符 */
export function buildPools(o: PwOpt): Pool[] {
  const used = new Set<string>();
  const pools: Pool[] = [];
  for (const k of ['upper', 'lower', 'digit', 'symbol'] as const) {
    if (!o[k]) continue;
    const src = k === 'symbol' ? o.symbols : SETS[k];
    const chars: string[] = [];
    for (const ch of src) {
      if (/\s/.test(ch) || used.has(ch) || (o.noAmbiguous && AMBIGUOUS.includes(ch))) continue;
      used.add(ch);
      chars.push(ch);
    }
    if (!chars.length) throw new Error(`“${NAMES[k]}”里没有可用的字符${k === 'symbol' ? '，请检查符号范围' : ''}`);
    pools.push({ name: NAMES[k], chars });
  }
  if (!pools.length) throw new Error('请至少选择一种字符（大写、小写、数字或符号）');
  return pools;
}

export function poolSize(o: PwOpt): number {
  return buildPools(o).reduce((n, p) => n + p.chars.length, 0);
}

/** 生成一个密码。rnd 返回 0 ~ max-1 的均匀随机整数，测试时可以替换 */
export function generatePassword(o: PwOpt, rnd: (max: number) => number = randomInt): string {
  if (!Number.isInteger(o.length) || o.length < 1) throw new Error('密码长度至少是 1');
  const pools = buildPools(o);
  if (o.eachType && o.length < pools.length) {
    throw new Error(`选了 ${pools.length} 种字符、要求每种至少一个，长度至少要 ${pools.length}`);
  }
  const all = pools.flatMap((p) => p.chars);
  const out: string[] = [];
  if (o.eachType) for (const p of pools) out.push(p.chars[rnd(p.chars.length)]);
  while (out.length < o.length) out.push(all[rnd(all.length)]);
  // 打乱顺序，避免“每种至少一个”的字符总在开头
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** 熵（位）：长度 × log2(字符池大小) */
export const entropyBits = (length: number, size: number): number => (size > 1 ? length * Math.log2(size) : 0);

const LABELS = ['很弱', '弱', '一般', '强', '很强'];

export function strength(bits: number): { level: number; label: string } {
  const level = bits < 28 ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 128 ? 3 : 4;
  return { level, label: LABELS[level] };
}

/** 按每秒 1000 亿次猜测，平均要多久才能猜中（2^(位数-1) 次） */
export function crackTime(bits: number): string {
  const s = Math.pow(2, Math.max(0, bits - 1)) / 1e11;
  if (s < 1) return '不到 1 秒';
  if (s < 60) return `${Math.round(s)} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时`;
  const days = s / 86400;
  if (days < 365) return `${Math.round(days)} 天`;
  const years = days / 365;
  if (years < 1e4) return `${Math.round(years)} 年`;
  if (years < 1e8) return `${Math.round(years / 1e4)} 万年`;
  return '超过 1 亿年';
}
