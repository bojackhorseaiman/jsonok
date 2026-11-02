<script setup lang="ts">
import { onMounted } from 'vue';
import { SITE } from '../data/catalog';
import { setPage } from '../lib/page';
import { openPalette } from '../store';

onMounted(() => setPage(`页面不存在 - ${SITE.name}`, SITE.desc));
</script>

<template>
  <div class="wrap notfound">
    <div class="nf-code">404</div>
    <h1>页面不存在</h1>
    <p>这个地址没有对应的工具，可能已经改名或下线了。</p>
    <div class="nf-act">
      <RouterLink class="btn primary" to="/">回到首页</RouterLink>
      <button class="btn" type="button" @click="openPalette">搜索工具</button>
    </div>
  </div>
</template>
