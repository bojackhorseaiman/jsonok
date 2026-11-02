<script setup lang="ts">
import { hasFlag, isLive, type Tool } from '../data/catalog';

defineProps<{ tool: Tool }>();
</script>

<template>
  <span v-if="hasFlag(tool, 'hot')" class="badge b-hot">热门</span>
  <span v-if="hasFlag(tool, 'new')" class="badge b-new">新增</span>
  <span v-if="!isLive(tool)" class="badge b-dev">开发中</span>
</template>
