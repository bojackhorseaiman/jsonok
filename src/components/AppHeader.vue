<script setup lang="ts">
// 顶部导航：第 1 行 Logo + 搜索 + 收藏 + 主题；第 2 行 12 个分类，鼠标移上去弹出这一类的全部工具
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CATEGORIES, CAT_BY_ID, TOOL_BY_ID, toolPath } from '../data/catalog';
import { gotoSection } from '../lib/page';
import { activeCat, favs, openPalette, theme, toast, toggleTheme } from '../store';
import AppIcon from './AppIcon';
import ToolBadges from './ToolBadges.vue';
import ToolIcon from './ToolIcon.vue';

const route = useRoute();
const router = useRouter();

const favCount = computed(() => favs.value.length);
const isDark = computed(() => theme.value === 'dark');

/** 当前高亮的分类：工具页 = 工具所属分类；首页 = 滚动到的分类 */
const currentCat = computed<string | null>(() => {
  if (route.name === 'tool') return TOOL_BY_ID.get(`${route.params.cat}/${route.params.slug}`)?.cat.id ?? null;
  if (route.name === 'home') return activeCat.value;
  return null;
});

// ---------- 分类下拉面板 ----------
const megaId = ref<string | null>(null);
const mega = computed(() => (megaId.value ? CAT_BY_ID.get(megaId.value) ?? null : null));
const canHover = window.matchMedia('(hover: hover)').matches;
let openTimer: number | undefined;
let hideTimer: number | undefined;

function onTabEnter(id: string): void {
  if (!canHover) return;
  clearTimeout(hideTimer);
  clearTimeout(openTimer);
  // 面板已打开时立即切换；未打开时稍等一下，避免鼠标划过就闪
  if (megaId.value) megaId.value = id;
  else openTimer = window.setTimeout(() => (megaId.value = id), 120);
}
function onLeave(): void {
  clearTimeout(openTimer);
  hideTimer = window.setTimeout(() => (megaId.value = null), 180);
}
function cancelHide(): void {
  clearTimeout(hideTimer);
}
function hideMega(): void {
  clearTimeout(openTimer);
  clearTimeout(hideTimer);
  megaId.value = null;
}
function goCat(id: string): void {
  hideMega();
  gotoSection(router, 'cat-' + id);
}
function goMegaAll(): void {
  if (megaId.value) goCat(megaId.value);
}
function openFavs(): void {
  if (favCount.value) gotoSection(router, 'sec-fav');
  else toast('还没有收藏。鼠标移到工具卡片上，点右上角的 ☆ 就能收藏');
}

watch(() => route.fullPath, hideMega);
const onScroll = () => { if (megaId.value) hideMega(); };
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hideMega(); };
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  document.removeEventListener('keydown', onKey);
});

// 窄屏时分类栏可以横向滑动：把当前分类滑到可见位置
const catbar = ref<HTMLElement | null>(null);
watch(currentCat, async (id) => {
  await nextTick();
  const bar = catbar.value;
  const tab = id ? bar?.querySelector<HTMLElement>(`[data-cat="${id}"]`) : null;
  if (!bar || !tab) return;
  const l = tab.offsetLeft - bar.offsetLeft;
  if (l < bar.scrollLeft || l + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) {
    bar.scrollTo({ left: l - bar.clientWidth / 2 + tab.offsetWidth / 2, behavior: 'smooth' });
  }
});
</script>

<template>
  <header class="site-header">
    <div class="wrap row1">
      <RouterLink class="logo" to="/">快<b>JSON</b></RouterLink>
      <span class="tagline">开发者在线工具箱</span>
      <div class="spacer"></div>
      <button class="search-btn" type="button" title="搜索工具 (Ctrl+K)" @click="openPalette">
        <AppIcon name="search" :size="15" />
        <span>搜索工具，支持拼音首字母…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button class="icon-btn" type="button" title="我的收藏" @click="openFavs">
        <AppIcon name="star" />
        <span v-if="favCount" class="cnt">{{ favCount }}</span>
      </button>
      <button class="icon-btn" type="button" :title="isDark ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
        <AppIcon :name="isDark ? 'sun' : 'moon'" />
      </button>
    </div>

    <div class="wrap">
      <nav ref="catbar" class="catbar" aria-label="工具分类" @mouseenter="cancelHide" @mouseleave="onLeave">
        <a
          v-for="c in CATEGORIES"
          :key="c.id"
          class="tab"
          :class="{ active: currentCat === c.id, hover: megaId === c.id }"
          :href="`/#cat-${c.id}`"
          :data-cat="c.id"
          @mouseenter="onTabEnter(c.id)"
          @click.prevent="goCat(c.id)"
        >
          <AppIcon class="tab-i" :name="c.icon" :size="14" />{{ c.name }}
        </a>
      </nav>
    </div>

    <div v-if="mega" class="mega" @mouseenter="cancelHide" @mouseleave="onLeave">
      <div class="wrap mega-in">
        <div class="mega-h">
          <ToolIcon :hue="mega.hue" :icon="mega.icon" size="sm" />
          <b>{{ mega.name }}</b>
          <span class="n">{{ mega.tools.length }} 个</span>
          <span class="d">{{ mega.desc }}</span>
          <a :href="`/#cat-${mega.id}`" @click.prevent="goMegaAll">在首页查看全部 →</a>
        </div>
        <div class="mega-grid">
          <RouterLink v-for="t in mega.tools" :key="t.id" :to="toolPath(t)" :title="t.desc" @click="hideMega">
            <ToolIcon :hue="t.cat.hue" :icon="t.icon" size="sm" />
            <div class="mb">
              <div class="mt">{{ t.name }}<ToolBadges :tool="t" /></div>
              <div class="md">{{ t.desc }}</div>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </header>
</template>
