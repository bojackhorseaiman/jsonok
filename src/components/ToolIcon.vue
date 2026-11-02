<script setup lang="ts">
// 带底色的图标方块：底色跟随分类（hue），同一类颜色一致
import { computed } from 'vue';
import AppIcon from './AppIcon';

const props = withDefaults(defineProps<{ hue: number; icon: string; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'md' });
const PX = { xs: 12, sm: 14, md: 16, lg: 20 } as const;
const px = computed(() => PX[props.size]);
</script>

<template>
  <span class="ico" :class="size" :style="{ '--h': hue }"><AppIcon :name="icon" :size="px" /></span>
</template>
