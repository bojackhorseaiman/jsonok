<script setup lang="ts">
// Ctrl+K 搜索面板：支持名称、功能说明、拼音首字母；↑↓ 选择，Enter 打开
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { TOOLS, TOOL_BY_ID, hasFlag, toolPath, type Tool } from '../data/catalog';
import { searchTools } from '../lib/search';
import { closePalette, paletteOpen, recent } from '../store';
import ToolBadges from './ToolBadges.vue';
import ToolIcon from './ToolIcon.vue';

const router = useRouter();
const q = ref('');
const sel = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

interface Item { tool: Tool; idx: number }
interface Group { title: string; items: Item[] }

const groups = computed<Group[]>(() => {
  const raw: [string, Tool[]][] = [];
  if (!q.value.trim()) {
    const rec = recent.value.map((id) => TOOL_BY_ID.get(id)).filter((t): t is Tool => !!t).slice(0, 5);
    if (rec.length) raw.push(['最近使用', rec]);
    raw.push(['热门工具', TOOLS.filter((t) => hasFlag(t, 'hot') && !rec.includes(t)).slice(0, 8)]);
  } else {
    const r = searchTools(q.value);
    if (r.length) raw.push([`找到 ${r.length} 个工具`, r]);
  }
  let idx = 0;
  return raw.map(([title, list]) => ({ title, items: list.map((tool) => ({ tool, idx: idx++ })) }));
});
const flat = computed(() => groups.value.flatMap((g) => g.items.map((i) => i.tool)));

watch(q, () => (sel.value = 0));
watch(paletteOpen, async (open) => {
  if (!open) return;
  q.value = '';
  sel.value = 0;
  await nextTick();
  inputEl.value?.focus();
});

function move(d: number): void {
  const n = flat.value.length;
  if (!n) return;
  sel.value = (sel.value + d + n) % n;
  void nextTick(() => listEl.value?.querySelector('.pal-it.sel')?.scrollIntoView({ block: 'nearest' }));
}
function openAt(i: number): void {
  const t = flat.value[i];
  if (!t) return;
  closePalette();
  void router.push(toolPath(t));
}
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return; // 中文输入法选词时不处理
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); openAt(sel.value); }
  else if (e.key === 'Escape') closePalette();
}

/** 把名称里匹配的部分标出来 */
function parts(name: string): [string, string, string] {
  const s = q.value.trim().toLowerCase();
  const i = s ? name.toLowerCase().indexOf(s) : -1;
  return i < 0 ? [name, '', ''] : [name.slice(0, i), name.slice(i, i + s.length), name.slice(i + s.length)];
}
</script>

<template>
  <Teleport to="body">
    <div v-if="paletteOpen" class="mask" @mousedown.self="closePalette">
      <div class="pal" role="dialog" aria-label="搜索工具">
        <div class="pal-in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref="inputEl" v-model="q" placeholder="搜索工具名称、功能或拼音首字母…" autocomplete="off" spellcheck="false" @keydown="onKeydown" />
          <kbd>Esc</kbd>
        </div>
        <div ref="listEl" class="pal-list">
          <template v-for="g in groups" :key="g.title">
            <div class="pal-g">{{ g.title }}</div>
            <div
              v-for="it in g.items"
              :key="it.tool.id"
              class="pal-it"
              :class="{ sel: it.idx === sel }"
              @mousemove="sel = it.idx"
              @click="openAt(it.idx)"
            >
              <ToolIcon :hue="it.tool.cat.hue" :icon="it.tool.icon" />
              <div class="b">
                <div class="t">
                  <template v-for="(p, pi) in parts(it.tool.name)" :key="pi"><mark v-if="pi === 1">{{ p }}</mark><template v-else>{{ p }}</template></template>
                  <ToolBadges :tool="it.tool" />
                </div>
                <div class="d">{{ it.tool.desc }}</div>
              </div>
              <span class="c">{{ it.tool.cat.name }}</span>
            </div>
          </template>
          <div v-if="!groups.length" class="pal-none">没有找到“{{ q }}”相关的工具</div>
        </div>
        <div class="pal-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span class="spacer"></span>
          <span>共 {{ TOOLS.length }} 个工具</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
