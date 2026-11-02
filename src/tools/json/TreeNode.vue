<script setup lang="ts">
// 树形视图的一个节点：子节点在展开时才渲染，每次最多 1000 个
import { computed, inject, ref, watch } from 'vue';
import { childPath, type JNode } from '../../core/json';
import { CHUNK, TREE_CTX } from './tree';

defineOptions({ name: 'TreeNode' });
const props = defineProps<{ node: JNode; k: string | number | null; path: string; depth: number; isIdx: boolean }>();
const ctx = inject(TREE_CTX)!;

const count = computed(() => (props.node.t === 'o' || props.node.t === 'a' ? props.node.items.length : 0));
const isBox = computed(() => count.value > 0);

function initOpen(): boolean {
  if (!isBox.value) return false;
  if (ctx.action.value === 'expand') return ctx.budget.n-- > 0;
  if (ctx.action.value === 'collapse') return props.depth === 0;
  return props.depth < 2;
}
const open = ref(initOpen());
const shown = ref(CHUNK);

watch(ctx.gen, () => {
  if (!isBox.value) return;
  if (ctx.action.value === 'expand') {
    if (!open.value) open.value = ctx.budget.n-- > 0;
  } else if (ctx.action.value === 'collapse') open.value = props.depth === 0;
});

interface Child { key: number; k: string | number; node: JNode; path: string; idx: boolean }
const children = computed<Child[]>(() => {
  const nd = props.node;
  if (!open.value) return [];
  if (nd.t === 'o') {
    return nd.items.slice(0, shown.value).map(([key, v], i) => ({ key: i, k: key, node: v, path: childPath(props.path, key), idx: false }));
  }
  if (nd.t === 'a') {
    return nd.items.slice(0, shown.value).map((v, i) => ({ key: i, k: i, node: v, path: `${props.path}[${i}]`, idx: true }));
  }
  return [];
});

const keyText = computed(() => (props.k === null ? '' : props.isIdx ? String(props.k) : JSON.stringify(props.k)));
const leaf = computed<[string, string]>(() => {
  const nd = props.node;
  switch (nd.t) {
    case 's': return ['ts', JSON.stringify(nd.v)];
    case 'n': return ['tn', nd.raw];
    case 'b': return ['tb', String(nd.v)];
    case 'z': return ['tz', 'null'];
    case 'o': return ['tp', '{}'];
    case 'a': return ['tp', '[]'];
  }
});
const selected = computed(() => ctx.selected.value === props.path);

function onRow(): void {
  ctx.selected.value = props.path;
  if (isBox.value) open.value = !open.value;
}
function more(): void {
  shown.value += CHUNK;
}
</script>

<template>
  <div v-if="isBox" class="tn">
    <div class="tn-row" :class="{ sel: selected }" @click="onRow">
      <span class="tn-arr" :class="{ open }"></span>
      <template v-if="k !== null"><span :class="isIdx ? 'ti' : 'tk'">{{ keyText }}</span><span class="tp">: </span></template>
      <span class="tp">{{ node.t === 'o' ? '{…}' : '[…]' }}</span>
      <span class="tn-cnt">{{ count }} {{ node.t === 'o' ? '个键' : '项' }}</span>
    </div>
    <div v-if="open" class="tn-kids">
      <TreeNode v-for="c in children" :key="c.key" :node="c.node" :k="c.k" :path="c.path" :depth="depth + 1" :is-idx="c.idx" />
      <button v-if="count > shown" class="tn-more" type="button" @click.stop="more">还有 {{ count - shown }} 项，点击加载更多</button>
    </div>
  </div>
  <div v-else class="tn-row tn-leaf" :class="{ sel: selected }" @click="onRow">
    <template v-if="k !== null"><span :class="isIdx ? 'ti' : 'tk'">{{ keyText }}</span><span class="tp">: </span></template>
    <span :class="leaf[0]">{{ leaf[1] }}</span>
  </div>
</template>

<style>
.tn-row { padding: 0 4px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.tn-row:hover { background: var(--panel-2); }
.tn-row.sel, .tn-row.sel:hover { background: var(--primary-bg); }
.tn-leaf { white-space: pre-wrap; word-break: break-all; padding-left: 18px; }
.tn-arr { display: inline-block; width: 14px; color: var(--muted); transition: transform 0.15s; }
.tn-arr::before { content: '▸'; }
.tn-arr.open { transform: rotate(90deg); }
.tn-cnt { color: var(--muted); font-size: 12px; margin-left: 6px; }
.tn-kids { padding-left: 20px; margin-left: 7px; border-left: 1px dashed var(--border-strong); }
.tn-more { margin: 4px 0; border: 1px dashed var(--border-strong); color: var(--primary); border-radius: 4px; padding: 2px 10px; font-size: 12px; }
</style>
