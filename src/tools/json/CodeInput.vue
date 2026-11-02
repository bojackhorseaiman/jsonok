<script setup lang="ts">
// 带行号的输入框：示例 / 打开文件 / 清空 / 拖入文件 / Tab 缩进 / Ctrl+Enter 执行；底部显示状态
import { computed, ref } from 'vue';
import { byteLen, countLines, fmtSize, gutterHtml } from '../../core/text';
import AppIcon from '../../components/AppIcon';

const props = withDefaults(
  defineProps<{
    title: string;
    placeholder?: string;
    errLine?: number;
    stat?: { type: '' | 'ok' | 'warn' | 'err'; text: string };
    indent?: string;
    accept?: string;
    sample?: boolean;
  }>(),
  { placeholder: '', errLine: 0, stat: () => ({ type: '', text: '' }), indent: '  ', accept: '.json,.txt,.log,application/json,text/plain', sample: true },
);
const emit = defineEmits<{ sample: []; file: [f: File]; run: [] }>();
const model = defineModel<string>({ required: true });

const ta = ref<HTMLTextAreaElement | null>(null);
const gutterEl = ref<HTMLElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

const lines = computed(() => countLines(model.value));
const gutter = computed(() => gutterHtml(lines.value, props.errLine));
const size = computed(() => (model.value ? `${lines.value} 行 · ${fmtSize(byteLen(model.value))}` : ''));
const tabSize = computed(() => (props.indent === '\t' ? 4 : props.indent.length || 2));

function syncScroll(): void {
  if (gutterEl.value && ta.value) gutterEl.value.scrollTop = ta.value.scrollTop;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const el = ta.value;
    if (!el) return;
    // execCommand 能保留撤销记录；不支持时退回直接修改
    if (!document.execCommand('insertText', false, props.indent)) {
      el.setRangeText(props.indent, el.selectionStart, el.selectionEnd, 'end');
      model.value = el.value;
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    emit('run');
  }
}

function onFile(e: Event): void {
  const el = e.target as HTMLInputElement;
  const f = el.files?.[0];
  if (f) emit('file', f);
  el.value = '';
}
function onDrop(e: DragEvent): void {
  dragging.value = false;
  const f = e.dataTransfer?.files[0];
  if (f) emit('file', f);
}
function clear(): void {
  model.value = '';
  ta.value?.focus();
}

/** 选中出错的位置并滚动过去 */
function locate(pos: number, line: number): void {
  const el = ta.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(pos, Math.min(pos + 1, el.value.length));
  el.scrollTop = Math.max(0, (line - 1) * 20 - el.clientHeight / 3);
  syncScroll();
}
defineExpose({ locate });
</script>

<template>
  <section class="pane">
    <div class="pane-head">
      <span class="pane-title">{{ title }}</span>
      <button v-if="sample" class="btn" type="button" @click="emit('sample')"><AppIcon name="file-json" :size="14" />示例</button>
      <button class="btn" type="button" @click="fileEl?.click()"><AppIcon name="folder-open" :size="14" />打开文件</button>
      <input ref="fileEl" type="file" hidden :accept="accept" @change="onFile" />
      <button class="btn" type="button" @click="clear"><AppIcon name="trash-2" :size="14" />清空</button>
    </div>
    <div
      class="editor"
      :class="{ drag: dragging }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div ref="gutterEl" class="gutter" aria-hidden="true" v-html="gutter"></div>
      <textarea
        ref="ta"
        v-model="model"
        spellcheck="false"
        autocomplete="off"
        :placeholder="placeholder"
        :style="{ tabSize }"
        @scroll="syncScroll"
        @keydown="onKeydown"
      ></textarea>
    </div>
    <div class="status">
      <span class="stat" :class="stat.type" :title="stat.text">{{ stat.text }}</span>
      <span class="spacer"></span>
      <span>{{ size }}</span>
    </div>
  </section>
</template>
