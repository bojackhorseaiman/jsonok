<script setup lang="ts">
import { toastText, toastVisible } from '../store';
</script>

<template>
  <div class="toast" :class="{ show: toastVisible }" role="status" aria-live="polite">{{ toastText }}</div>
</template>
