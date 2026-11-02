<script setup lang="ts">
import { computed } from 'vue';
import { isLive, toolPath, type Tool } from '../data/catalog';
import { favs, toggleFav } from '../store';
import AppIcon from './AppIcon';
import ToolBadges from './ToolBadges.vue';
import ToolIcon from './ToolIcon.vue';

const props = defineProps<{ tool: Tool }>();
const fav = computed(() => favs.value.includes(props.tool.id));
const onStar = () => toggleFav(props.tool.id);
</script>

<template>
  <RouterLink class="card" :class="{ dev: !isLive(tool) }" :to="toolPath(tool)">
    <ToolIcon :hue="tool.cat.hue" :icon="tool.icon" />
    <div class="card-b">
      <div class="card-t">{{ tool.name }}<ToolBadges :tool="tool" /></div>
      <div class="card-d">{{ tool.desc }}</div>
    </div>
    <button class="star" :class="{ on: fav }" type="button" :title="fav ? '取消收藏' : '收藏'" @click.prevent.stop="onStar">
      <AppIcon name="star" :size="14" :fill="fav" />
    </button>
  </RouterLink>
</template>
