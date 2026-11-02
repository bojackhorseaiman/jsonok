<script setup lang="ts">
// 可编辑树的一个节点：改键名、改值、改类型、增删、上下移动
import { computed, inject, ref } from 'vue';
import AppIcon from '../../components/AppIcon';
import { EDIT_CHUNK, EDIT_CTX, NUM_RE, TYPE_LABEL, blank, changeType, clone, freshKey, type ENode, type ET } from './editModel';

defineOptions({ name: 'EditNode' });
const props = defineProps<{ node: ENode; parent: ENode | null; index: number; dupKey?: boolean }>();
const ctx = inject(EDIT_CTX)!;

const n = props.node;
const isBox = computed(() => n.t === 'o' || n.t === 'a');
const shown = ref(EDIT_CHUNK);
const kids = computed(() => n.kids.slice(0, shown.value));
const dups = computed(() => {
  if (n.t !== 'o') return new Set<string>();
  const seen = new Set<string>();
  const d = new Set<string>();
  for (const k of n.kids) (seen.has(k.key) ? d : seen).add(k.key);
  return d;
});

// 数字先在输入框里编辑，合法时才写回
const numDraft = ref(n.t === 'n' ? n.val : '');
const numBad = computed(() => n.t === 'n' && !NUM_RE.test(numDraft.value.trim()));
const strRows = computed(() => Math.min(8, n.val.split('\n').length));

function onKey(e: Event): void {
  n.key = (e.target as HTMLInputElement).value;
  ctx.changed();
}
function onStr(e: Event): void {
  n.val = (e.target as HTMLTextAreaElement).value;
  ctx.changed();
}
function onNum(e: Event): void {
  numDraft.value = (e.target as HTMLInputElement).value;
  if (!numBad.value) {
    n.val = numDraft.value.trim();
    ctx.changed();
  }
}
function onBool(e: Event): void {
  n.val = (e.target as HTMLSelectElement).value;
  ctx.changed();
}
function onType(e: Event): void {
  changeType(n, (e.target as HTMLSelectElement).value as ET);
  if (n.t === 'n') numDraft.value = n.val;
  ctx.changed();
}
function toggle(): void {
  if (isBox.value) n.open = !n.open;
}
function addChild(): void {
  n.kids.push(blank(n.t === 'o' ? freshKey(n) : ''));
  n.open = true;
  if (n.kids.length > shown.value) shown.value = n.kids.length;
  ctx.changed();
}
function addAfter(): void {
  const p = props.parent;
  if (!p) return;
  p.kids.splice(props.index + 1, 0, blank(p.t === 'o' ? freshKey(p) : ''));
  ctx.changed();
}
function duplicate(): void {
  const p = props.parent;
  if (!p) return;
  const c = clone(n);
  if (p.t === 'o') c.key = freshKey(p);
  p.kids.splice(props.index + 1, 0, c);
  ctx.changed();
}
function move(d: number): void {
  const p = props.parent;
  const j = props.index + d;
  if (!p || j < 0 || j >= p.kids.length) return;
  const [x] = p.kids.splice(props.index, 1);
  p.kids.splice(j, 0, x);
  ctx.changed();
}
function remove(): void {
  props.parent?.kids.splice(props.index, 1);
  ctx.changed();
}
</script>

<template>
  <div class="en">
    <div class="en-row">
      <button v-if="isBox" class="en-arr" :class="{ open: node.open }" type="button" :aria-label="node.open ? '折叠' : '展开'" @click="toggle"></button>
      <span v-else class="en-arr-sp"></span>
      <template v-if="parent?.t === 'o'">
        <input class="en-key" :class="{ dup: dupKey }" :value="node.key" spellcheck="false" :title="dupKey ? '键名重复' : '键名'" :size="Math.max(4, node.key.length + 1)" @input="onKey" />
        <span class="tp">:</span>
      </template>
      <span v-else-if="parent?.t === 'a'" class="en-idx">{{ index }}</span>
      <span v-else class="en-root">根</span>

      <template v-if="isBox">
        <span class="tp en-brace" @click="toggle">{{ node.t === 'o' ? '{' : '[' }}<template v-if="!node.open">…{{ node.t === 'o' ? '}' : ']' }}</template></span>
        <span class="en-cnt">{{ node.kids.length }} {{ node.t === 'o' ? '个键' : '项' }}</span>
      </template>
      <textarea v-else-if="node.t === 's'" class="en-val ts" :value="node.val" :rows="strRows" spellcheck="false" @input="onStr"></textarea>
      <input v-else-if="node.t === 'n'" class="en-val tn" :class="{ bad: numBad }" :value="numDraft" spellcheck="false" :title="numBad ? '不是有效的数字' : ''" @input="onNum" />
      <select v-else-if="node.t === 'b'" class="en-val tb" :value="node.val" @change="onBool">
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      <span v-else class="tz en-null">null</span>

      <span class="en-act">
        <select class="en-type" :value="node.t" title="类型" @change="onType">
          <option v-for="[t, l] in TYPE_LABEL" :key="t" :value="t">{{ l }}</option>
        </select>
        <button v-if="isBox" type="button" title="添加子项" @click="addChild"><AppIcon name="plus" :size="13" /></button>
        <template v-if="parent">
          <button type="button" title="在下面插入" @click="addAfter"><AppIcon name="list-plus" :size="13" /></button>
          <button type="button" title="复制一份" @click="duplicate"><AppIcon name="copy" :size="13" /></button>
          <button type="button" title="上移" :disabled="index === 0" @click="move(-1)"><AppIcon name="arrow-up" :size="13" /></button>
          <button type="button" title="下移" :disabled="index === parent.kids.length - 1" @click="move(1)"><AppIcon name="arrow-down" :size="13" /></button>
          <button type="button" class="danger" title="删除" @click="remove"><AppIcon name="trash-2" :size="13" /></button>
        </template>
      </span>
    </div>
    <div v-if="isBox && node.open" class="en-kids">
      <EditNode v-for="(k, i) in kids" :key="k.id" :node="k" :parent="node" :index="i" :dup-key="dups.has(k.key)" />
      <button v-if="node.kids.length > shown" class="tn-more" type="button" @click="shown += EDIT_CHUNK">还有 {{ node.kids.length - shown }} 项，点击加载更多</button>
      <button v-if="!node.kids.length" class="en-empty" type="button" @click="addChild">+ 添加{{ node.t === 'o' ? '字段' : '元素' }}</button>
      <div class="tp en-close">{{ node.t === 'o' ? '}' : ']' }}</div>
    </div>
  </div>
</template>

<style>
.en-row { display: flex; align-items: flex-start; gap: 4px; padding: 1px 4px; border-radius: 5px; min-height: 26px; }
.en-row:hover { background: var(--panel-2); }
.en-arr, .en-arr-sp { width: 16px; height: 24px; flex: none; color: var(--muted); }
.en-arr::before { content: '▸'; display: inline-block; transition: transform 0.15s; }
.en-arr.open::before { transform: rotate(90deg); }
.en-key, .en-val, .en-type { font: 13px/20px var(--mono); border: 1px solid transparent; background: transparent; color: var(--text); border-radius: 4px; padding: 1px 4px; }
.en-key { color: var(--k); max-width: 240px; }
.en-key:hover, .en-val:hover { border-color: var(--border); }
.en-key:focus, .en-val:focus { outline: none; border-color: var(--primary); background: var(--panel); }
.en-key.dup { border-color: var(--warn); background: var(--hot-bg); }
.en-val { flex: 1; min-width: 80px; }
textarea.en-val { resize: none; white-space: pre-wrap; word-break: break-all; overflow: hidden; }
.en-val.bad { border-color: var(--err); background: var(--err-bg); }
.en-idx { color: var(--muted); font: 12px/24px var(--mono); min-width: 18px; text-align: right; }
.en-root { color: var(--muted); font-size: 12px; line-height: 24px; }
.en-brace { font: 13px/24px var(--mono); cursor: pointer; }
.en-cnt { color: var(--muted); font-size: 12px; line-height: 24px; margin-right: auto; }
.en-null { font: 13px/24px var(--mono); margin-right: auto; padding-left: 5px; }
.en-act { display: inline-flex; align-items: center; gap: 1px; opacity: 0; transition: opacity 0.12s; margin-left: 6px; }
.en-row:hover .en-act, .en-row:focus-within .en-act { opacity: 1; }
.en-act button { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 4px; color: var(--text-2); }
.en-act button:hover:not(:disabled) { background: var(--panel); color: var(--primary); }
.en-act button.danger:hover { color: var(--err); }
.en-act button:disabled { opacity: 0.3; cursor: default; }
.en-type { font-family: var(--sans); font-size: 12px; color: var(--text-2); border-color: var(--border); }
.en-kids { padding-left: 18px; margin-left: 11px; border-left: 1px dashed var(--border-strong); }
.en-close { font: 13px/20px var(--mono); margin-left: -14px; }
.en-empty { color: var(--primary); font-size: 12px; padding: 2px 6px; }
</style>
