// 全局状态：收藏、最近使用、主题、搜索面板、提示条。都存在浏览器本地，不需要登录
import { ref } from 'vue';
import { TOOL_BY_ID } from './data/catalog';
import { load, save } from './lib/storage';

// ---------- 提示条 ----------
export const toastText = ref('');
export const toastVisible = ref(false);
let toastTimer: number | undefined;
export function toast(text: string): void {
  toastText.value = text;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastVisible.value = false), 1800);
}

export async function copyText(text: string, msg = '已复制到剪贴板'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

// ---------- 收藏 / 最近使用 ----------
const valid = (ids: string[]) => (Array.isArray(ids) ? ids.filter((id) => TOOL_BY_ID.has(id)) : []);
export const favs = ref<string[]>(valid(load<string[]>('fav', [])));
export const recent = ref<string[]>(valid(load<string[]>('recent', [])));

export const isFav = (id: string): boolean => favs.value.includes(id);

export function toggleFav(id: string): void {
  const on = !isFav(id);
  favs.value = on ? [id, ...favs.value] : favs.value.filter((x) => x !== id);
  save('fav', favs.value);
  toast(on ? '已收藏，点右上角 ⭐ 可以查看' : '已取消收藏');
}

export function addRecent(id: string): void {
  recent.value = [id, ...recent.value.filter((x) => x !== id)].slice(0, 8);
  save('recent', recent.value);
}

export function clearRecent(): void {
  recent.value = [];
  save('recent', []);
}

// ---------- 主题 ----------
export type Theme = 'light' | 'dark';
export const theme = ref<Theme>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme.value;
  save('theme', theme.value);
}

// ---------- 搜索面板 ----------
export const paletteOpen = ref(false);
export const openPalette = (): void => { paletteOpen.value = true; };
export const closePalette = (): void => { paletteOpen.value = false; };
export const togglePalette = (): void => { paletteOpen.value = !paletteOpen.value; };

// ---------- 首页滚动时，当前看到的分类（顶部导航据此高亮） ----------
export const activeCat = ref<string | null>(null);
