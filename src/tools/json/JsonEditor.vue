<script setup lang="ts">
// JSON 编辑器：左边是代码，右边是可编辑的树，两边实时同步；树上的修改可以撤销 / 重做
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import * as Core from '../../core/json';
import { load, save } from '../../lib/storage';
import { copyText, toast } from '../../store';
import AppIcon from '../../components/AppIcon';
import CodeInput from './CodeInput.vue';
import EditNode from './EditNode.vue';
import { EDIT_CTX, fromJNode, setOpenAll, toJNode, type ENode } from './editModel';
import { SAMPLE } from './defs';
import './tool.css';

const code = ref(load<string>('input', ''));
const indent = ref(load<string>('indent', '2'));
const indentStr = computed(() => (indent.value === 'tab' ? '\t' : ' '.repeat(Number(indent.value) || 2)));
// 整棵树只在根上用 ref：节点本身由 Vue 深度响应式代理，子组件直接修改
const root = ref<ENode | null>(null);
const stale = ref(false);
const stat = ref<{ type: '' | 'ok' | 'warn' | 'err'; text: string }>({ type: '', text: '' });
const errLine = ref(0);
const codeRef = shallowRef<InstanceType<typeof CodeInput> | null>(null);
const lastErr = ref<{ pos: number; line: number } | null>(null);

// ---------- 代码 → 树 ----------
let fromTree = false;
/** 撤销的基准：上一次稳定下来的代码 */
let lastSnap = '';
function parseCode(): void {
  save('input', code.value.length < 1e6 ? code.value : '');
  errLine.value = 0;
  lastErr.value = null;
  if (!code.value.trim()) {
    root.value = null;
    stale.value = false;
    stat.value = { type: '', text: '' };
    return;
  }
  try {
    const p = Core.parse(code.value);
    root.value = fromJNode(p.root);
    stale.value = false;
    lastSnap = code.value;
    const st = Core.stats(p.root);
    stat.value = p.warnings.length
      ? { type: 'warn', text: `⚠ 有 ${p.warnings.length} 处重复的键（如 ${JSON.stringify(p.warnings[0].key)}），树里已用黄色标出` }
      : { type: 'ok', text: `✓ JSON 格式正确 · ${st.nodes} 个节点 · 深度 ${st.depth}` };
  } catch (e) {
    if (!(e instanceof Core.JsonError)) throw e;
    const { line, col } = Core.lineCol(code.value, e.pos);
    errLine.value = line;
    lastErr.value = { pos: e.pos, line };
    stale.value = !!root.value;
    stat.value = { type: 'err', text: `✗ 第 ${line} 行第 ${col} 列：${e.message}` };
  }
}
let timer: number | undefined;
watch(code, () => {
  if (fromTree) { fromTree = false; save('input', code.value.length < 1e6 ? code.value : ''); return; }
  clearTimeout(timer);
  timer = window.setTimeout(parseCode, code.value.length > 2e6 ? 800 : 300);
});
watch(indent, (v) => {
  save('indent', v);
  if (root.value && !stale.value) writeCode();
});

// ---------- 树 → 代码，撤销 / 重做 ----------
const undoStack: string[] = [];
const redoStack: string[] = [];
const canUndo = ref(false);
const canRedo = ref(false);
const syncFlags = () => { canUndo.value = undoStack.length > 0; canRedo.value = redoStack.length > 0; };

function writeCode(): void {
  if (!root.value) return;
  const text = Core.stringify(toJNode(root.value), { indent: indentStr.value });
  if (text === code.value) return;
  fromTree = true;
  code.value = text;
}
let snapTimer: number | undefined;
function changed(): void {
  // 连续输入合并成一步撤销：停顿 600ms 以后才算新的一步
  if (!snapTimer) {
    undoStack.push(lastSnap || code.value);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    syncFlags();
  }
  clearTimeout(snapTimer);
  snapTimer = window.setTimeout(() => { snapTimer = undefined; lastSnap = code.value; }, 600);
  stale.value = false;
  errLine.value = 0;
  writeCode();
  stat.value = { type: 'ok', text: '✓ 已根据树形编辑更新代码' };
}
provide(EDIT_CTX, { changed });

function restore(text: string): void {
  clearTimeout(snapTimer);
  snapTimer = undefined;
  code.value = text;
  lastSnap = text;
  clearTimeout(timer);
  parseCode();
}
function undo(): void {
  const t = undoStack.pop();
  if (t === undefined) return;
  redoStack.push(code.value);
  restore(t);
  syncFlags();
}
function redo(): void {
  const t = redoStack.pop();
  if (t === undefined) return;
  undoStack.push(code.value);
  restore(t);
  syncFlags();
}

// ---------- 按钮 ----------
function loadSample(): void { code.value = Core.stringify(Core.parse(SAMPLE).root, { indent: indentStr.value }); }
async function onFile(f: File): Promise<void> {
  if (f.size > 20 * 1024 * 1024) { toast('编辑器最多支持 20 MB 的文件'); return; }
  code.value = await f.text();
  toast('已载入 ' + f.name);
}
function formatCode(): void {
  try {
    code.value = Core.stringify(Core.parse(code.value).root, { indent: indentStr.value });
  } catch {
    toast('代码有错误，先修正后再格式化');
  }
}
function newDoc(kind: 'o' | 'a'): void {
  code.value = kind === 'o' ? '{\n}' : '[\n]';
  clearTimeout(timer);
  parseCode();
}
const expandAll = () => { if (root.value) setOpenAll(root.value, true); };
const collapseAll = () => { if (root.value) { setOpenAll(root.value, false); root.value.open = true; } };
function copyCode(): void {
  if (!code.value) { toast('没有可复制的内容'); return; }
  void copyText(code.value);
}
function download(): void {
  if (!code.value) { toast('没有可下载的内容'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([code.value], { type: 'application/json;charset=utf-8' }));
  a.download = 'kuaijson-edit.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function locate(): void {
  if (lastErr.value) codeRef.value?.locate(lastErr.value.pos, lastErr.value.line);
}

function onKey(e: KeyboardEvent): void {
  // 焦点在树上时，Ctrl+Z / Ctrl+Y 撤销重做树的修改（代码框里用浏览器自带的撤销）
  const inTree = (e.target as HTMLElement | null)?.closest?.('.ed-tree');
  if (!inTree || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}
onMounted(() => { parseCode(); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(snapTimer); document.removeEventListener('keydown', onKey); });
</script>

<template>
  <div class="wb">
    <div class="wb-opts">
      <label>缩进
        <select v-model="indent">
          <option value="2">2 空格</option>
          <option value="4">4 空格</option>
          <option value="tab">Tab</option>
        </select>
      </label>
      <button class="btn" type="button" @click="formatCode"><AppIcon name="align-left" :size="14" />格式化代码</button>
      <button class="btn" type="button" @click="newDoc('o')"><AppIcon name="braces" :size="14" />新建对象</button>
      <button class="btn" type="button" @click="newDoc('a')"><AppIcon name="list" :size="14" />新建数组</button>
      <span class="wb-hint">左边改代码、右边改树，两边实时同步 · 鼠标移到某一行上显示操作按钮</span>
    </div>

    <div class="wb-main">
      <CodeInput
        ref="codeRef"
        v-model="code"
        title="代码"
        placeholder="在此粘贴 JSON，或点“新建对象”从空白开始…"
        :err-line="errLine"
        :stat="stat"
        :indent="indentStr"
        @sample="loadSample"
        @file="onFile"
        @run="parseCode"
      />

      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">树形编辑</span>
          <button class="btn" type="button" :disabled="!canUndo" title="撤销 (Ctrl+Z)" @click="undo"><AppIcon name="undo-2" :size="14" />撤销</button>
          <button class="btn" type="button" :disabled="!canRedo" title="重做 (Ctrl+Y)" @click="redo"><AppIcon name="redo-2" :size="14" />重做</button>
          <button class="btn" type="button" @click="expandAll"><AppIcon name="chevrons-up-down" :size="14" />展开</button>
          <button class="btn" type="button" @click="collapseAll"><AppIcon name="chevrons-down-up" :size="14" />折叠</button>
          <button class="btn" type="button" @click="download"><AppIcon name="download" :size="14" />下载</button>
          <button class="btn primary" type="button" @click="copyCode"><AppIcon name="copy" :size="14" />复制</button>
        </div>
        <div v-if="stale" class="ed-stale">
          左侧代码有错误，这里显示的是上一次正确的内容。
          <button class="link" type="button" @click="locate">定位错误</button>
        </div>
        <div class="out-scroll">
          <div v-if="root" class="ed-tree" :class="{ dim: stale }">
            <EditNode :key="root.id" :node="root" :parent="null" :index="0" />
          </div>
          <div v-else class="wb-empty">
            <div class="wb-empty-ico">{ }</div>
            <div>{{ stat.type === 'err' ? '左侧代码有错误，修正后这里会显示可编辑的树' : '在左侧粘贴 JSON，或者从空白开始' }}</div>
            <div style="display: flex; gap: 8px; justify-content: center">
              <button class="btn" type="button" @click="newDoc('o')">新建对象</button>
              <button class="btn" type="button" @click="loadSample">载入示例</button>
            </div>
          </div>
        </div>
        <div class="status">
          <span class="stat">直接编辑键名和值；用每行右侧的类型下拉框修改类型</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style>
.ed-tree { flex: 1 0 auto; padding: 8px 10px; }
.ed-tree.dim { opacity: 0.55; pointer-events: none; }
.ed-stale { padding: 6px 10px; font-size: 12px; background: var(--hot-bg); color: var(--warn); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn:disabled:hover { border-color: var(--border-strong); color: var(--text); }
</style>
