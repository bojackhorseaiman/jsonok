<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, onMounted, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { SITE, STEP, TOOL_BY_ID, hasFlag, type Tool } from '../data/catalog';
import { TOOL_IMPL } from '../tools/registry';
import { gotoSection, setPage } from '../lib/page';
import { addRecent, favs, toggleFav } from '../store';
import AppIcon from '../components/AppIcon';
import ToolBadges from '../components/ToolBadges.vue';
import ToolCard from '../components/ToolCard.vue';
import ToolIcon from '../components/ToolIcon.vue';
import NotFound from './NotFound.vue';

const route = useRoute();
const router = useRouter();

// 外层按路由地址重新创建本组件，所以这里直接取一次即可
const tool: Tool | undefined = TOOL_BY_ID.get(`${route.params.cat}/${route.params.slug}`);
const impl = tool ? TOOL_IMPL[tool.id] : undefined;

const Loading = defineComponent({ render: () => h('div', { class: 'tool-loading' }, '加载中…') });
const Impl: Component | null = impl ? defineAsyncComponent({ loader: impl.load, loadingComponent: Loading, delay: 150 }) : null;
const implProps = impl?.props ?? {};

const fav = computed(() => !!tool && favs.value.includes(tool.id));
const related = computed(() => {
  if (!tool) return [];
  const others = tool.cat.tools.filter((x) => x !== tool);
  return [...others.filter((x) => hasFlag(x, 'hot')), ...others.filter((x) => !hasFlag(x, 'hot'))].slice(0, 8);
});

function onFav(): void {
  if (tool) toggleFav(tool.id);
}
function goCat(): void {
  if (tool) gotoSection(router, 'cat-' + tool.cat.id);
}

onMounted(() => {
  if (!tool) return;
  addRecent(tool.id);
  setPage(`${tool.name} - ${SITE.name}在线工具`, `${tool.name}：${tool.desc}。免费在线使用，数据只在浏览器本地处理，不上传服务器。`);
});
</script>

<template>
  <NotFound v-if="!tool" />
  <div v-else class="wrap tool-main">
    <nav class="crumb" aria-label="当前位置">
      <RouterLink to="/">首页</RouterLink>
      <span>/</span>
      <a :href="`/#cat-${tool.cat.id}`" @click.prevent="goCat">{{ tool.cat.name }}</a>
      <span>/</span>
      <span>{{ tool.name }}</span>
    </nav>

    <div class="tool-h">
      <ToolIcon :hue="tool.cat.hue" :icon="tool.icon" size="lg" />
      <h1>{{ tool.name }}</h1>
      <ToolBadges :tool="tool" />
      <button class="tool-star" :class="{ on: fav }" type="button" @click="onFav">
        <AppIcon name="star" :size="14" :fill="fav" />{{ fav ? '已收藏' : '收藏' }}
      </button>
    </div>
    <p class="tool-d">{{ tool.desc }}</p>

    <component :is="Impl" v-if="Impl" v-bind="implProps" />
    <template v-else>
      <div class="notice">
        <AppIcon name="construction" :size="16" />
        <span>这个工具正在开发中，很快就会上线。<span class="muted">（开发计划：第 {{ STEP[tool.cat.id] ?? 5 }} 步{{ hasFlag(tool, 'srv') ? '，需要服务器支持' : '' }}）</span></span>
      </div>
      <div class="mock">
        <div class="mock-bar"><div class="sk" style="width: 90px"></div><div class="sk" style="width: 120px"></div><div class="sk" style="width: 70px"></div></div>
        <div class="mock-body"><div class="mock-pane">输入区</div><div class="mock-pane">输出区</div></div>
      </div>
    </template>

    <section v-if="related.length" class="rel">
      <h3>{{ tool.cat.name }} 类的其他工具</h3>
      <div class="grid"><ToolCard v-for="t in related" :key="t.id" :tool="t" /></div>
    </section>
  </div>
</template>
