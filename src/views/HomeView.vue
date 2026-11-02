<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { CATEGORIES, SITE, TOOLS, TOOL_BY_ID, hasFlag, isLive, toolPath, type Tool } from '../data/catalog';
import { setPage } from '../lib/page';
import { activeCat, clearRecent, favs, openPalette, recent } from '../store';
import AppIcon from '../components/AppIcon';
import ToolCard from '../components/ToolCard.vue';
import ToolIcon from '../components/ToolIcon.vue';

const hot = TOOLS.filter((t) => hasFlag(t, 'hot')).slice(0, 12);
const liveCount = TOOLS.filter(isLive).length;
const pick = (ids: string[]) => ids.map((id) => TOOL_BY_ID.get(id)).filter((t): t is Tool => !!t);
const favTools = computed(() => pick(favs.value));
const recentTools = computed(() => pick(recent.value));

// 滚动时，顶部分类栏自动高亮当前看到的分类
let io: IntersectionObserver | null = null;
onMounted(() => {
  setPage(SITE.title, SITE.desc);
  io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) activeCat.value = (e.target as HTMLElement).dataset.cat || null;
    }),
    { rootMargin: '-120px 0px -65% 0px' },
  );
  document.querySelectorAll('.home [data-cat]').forEach((el) => io?.observe(el));
});
onBeforeUnmount(() => {
  io?.disconnect();
  activeCat.value = null;
});
</script>

<template>
  <div class="wrap home">
    <section class="hero" data-cat="">
      <h1>开发者常用在线工具，都在这里</h1>
      <p>共 {{ TOOLS.length }} 个工具，已上线 {{ liveCount }} 个，其余持续开发中 · 数据只在浏览器本地处理，不上传</p>
      <button class="hero-search" type="button" @click="openPalette">
        <AppIcon name="search" :size="18" />
        <span>搜索工具名称、功能或拼音首字母，比如 gsh、sjc、bs64</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div class="chips">
        热门：
        <RouterLink v-for="t in hot" :key="t.id" :to="toolPath(t)">
          <ToolIcon :hue="t.cat.hue" :icon="t.icon" size="xs" />{{ t.name }}
        </RouterLink>
      </div>
    </section>

    <section v-if="favTools.length" id="sec-fav" class="sec" data-cat="">
      <div class="sec-h">
        <ToolIcon :hue="40" icon="star" />
        <h2>我的收藏</h2>
        <span class="n">{{ favTools.length }}</span>
      </div>
      <div class="grid"><ToolCard v-for="t in favTools" :key="t.id" :tool="t" /></div>
    </section>

    <section v-if="recentTools.length" id="sec-recent" class="sec" data-cat="">
      <div class="sec-h">
        <ToolIcon :hue="190" icon="history" />
        <h2>最近使用</h2>
        <span class="n">{{ recentTools.length }}</span>
        <button class="link" type="button" @click="clearRecent">清空</button>
      </div>
      <div class="grid"><ToolCard v-for="t in recentTools" :key="t.id" :tool="t" /></div>
    </section>

    <section v-for="c in CATEGORIES" :id="`cat-${c.id}`" :key="c.id" class="sec" :data-cat="c.id">
      <div class="sec-h">
        <ToolIcon :hue="c.hue" :icon="c.icon" />
        <h2>{{ c.name }}</h2>
        <span class="n">{{ c.tools.length }}</span>
        <span class="d">{{ c.desc }}</span>
      </div>
      <div class="grid"><ToolCard v-for="t in c.tools" :key="t.id" :tool="t" /></div>
    </section>
  </div>
</template>
