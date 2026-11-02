<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import CommandPalette from './components/CommandPalette.vue';
import AppToast from './components/AppToast.vue';
import { openPalette, paletteOpen, togglePalette } from './store';

// 全局快捷键：Ctrl+K 或 / 打开搜索
function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    togglePalette();
    return;
  }
  const tag = document.activeElement?.tagName ?? '';
  if (e.key === '/' && !paletteOpen.value && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
    e.preventDefault();
    openPalette();
  }
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <AppHeader />
  <main class="site-main">
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </RouterView>
  </main>
  <footer class="site-footer">
    <span>© 2026 快JSON</span>
    <span>所有数据都在浏览器本地处理，不会上传到服务器</span>
    <span>ICP 备案号（上线前填写）</span>
  </footer>
  <CommandPalette />
  <AppToast />
</template>
