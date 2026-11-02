// 工具搜索：名称 > 拼音首字母 > 说明 / 分类 > 字符顺序模糊匹配，热门工具略微加分
import { TOOLS, hasFlag, type Tool } from '../data/catalog';

// 拼音首字母：用浏览器内置的中文排序规则（按拼音排序）判断，不需要额外的拼音字库
const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
const BOUNDS = '阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀';
let collator: Intl.Collator | null = null;
try {
  collator = new Intl.Collator('zh-Hans-CN');
} catch {
  collator = null;
}

function initial(ch: string): string {
  if (!/[\u4e00-\u9fa5]/.test(ch) || !collator) return ch.toLowerCase();
  for (let i = BOUNDS.length - 1; i >= 0; i--) {
    if (collator.compare(ch, BOUNDS[i]) >= 0) return LETTERS[i].toLowerCase();
  }
  return '';
}

export const initials = (s: string): string => [...s].map(initial).join('').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

interface Entry { tool: Tool; key: string; py: string; hay: string; hot: boolean }
let index: Entry[] | null = null;

function getIndex(): Entry[] {
  if (!index) {
    index = TOOLS.map((t) => ({
      tool: t,
      key: t.name.toLowerCase().replace(/\s+/g, ''),
      py: initials(t.name),
      hay: (t.desc + t.id + t.cat.name).toLowerCase().replace(/\s+/g, ''),
      hot: hasFlag(t, 'hot'),
    }));
  }
  return index;
}

function subseq(s: string, q: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i] && ++i === q.length) return true;
  return false;
}

function score(e: Entry, q: string): number {
  let s = 0;
  let i: number;
  if ((i = e.key.indexOf(q)) >= 0) s = 100 - i;
  else if (e.py.startsWith(q)) s = 90;
  else if ((i = e.py.indexOf(q)) >= 0) s = 80 - i;
  else if (e.hay.includes(q)) s = 50;
  else if (q.length >= 2 && (subseq(e.key, q) || subseq(e.py, q))) s = 30;
  if (s && e.hot) s += 3;
  return s;
}

export function searchTools(query: string, limit = 30): Tool[] {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return [];
  return getIndex()
    .map((e) => [e, score(e, q)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([e]) => e.tool);
}
