<script setup lang="ts">
// JSON 工作台：左边输入、右边结果。格式化 / 压缩 / 树形 / 转义 / 转 YAML·XML·CSV / Unicode 共用这一个组件
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue';
import * as Core from '../../core/json';
import { buildCtx, byteLen, countLines, escapeHtml, fmtSize, gutterHtml, highlight } from '../../core/text';
import { load, save } from '../../lib/storage';
import { copyText, toast } from '../../store';
import AppIcon from '../../components/AppIcon';
import TreeNode from './TreeNode.vue';
import { TREE_CTX, type TreeCtx } from './tree';
import { MIME, MODES, SAMPLE, type Mode, type OptKey } from './modes';

const props = defineProps<{ mode: Mode }>();
const cfg = MODES[props.mode];
const dirs = cfg.dir ?? [];
const has = (k: OptKey) => cfg.opts.includes(k);

// ---------- 状态（输入和选项在各个 JSON 工具之间共享，切换工具时数据还在） ----------
const input = ref(load<string>('input', ''));
const opt = reactive({
  indent: load<string>('indent', '2'),
  sort: load<boolean>('sort', false),
  ascii: load<boolean>('ascii', false),
  loose: load<boolean>('loose', false),
});
const dir = ref(dirs.length ? load<string>(`dir.${props.mode}`, dirs[0][0]) : '');
const tabSize = computed(() => (opt.indent === 'tab' ? 4 : Number(opt.indent)));

interface TextOut { kind: 'text'; text: string; json: boolean; note: string; ms: number }
interface TreeOut { kind: 'tree'; root: Core.JNode; text: string; ms: number }
interface ErrOut { kind: 'error'; parse: boolean; message: string; line: number; col: number; pos: number; ctx: string }
type Out = { kind: 'empty' } | TextOut | TreeOut | ErrOut;

// 结果可能很大（树形视图的整棵树），用 shallowRef 避免深层响应式带来的开销
const out = shallowRef<Out>({ kind: 'empty' });
const textOut = computed(() => (out.value.kind === 'text' ? out.value : null));
const treeOut = computed(() => (out.value.kind === 'tree' ? out.value : null));
const errOut = computed(() => (out.value.kind === 'error' ? out.value : null));
const outText = computed(() => textOut.value?.text ?? treeOut.value?.text ?? '');

type StatType = '' | 'ok' | 'warn' | 'err';
const inStat = ref<{ type: StatType; text: string }>({ type: '', text: '' });
const errLine = ref(0);

// ---------- 树形视图 ----------
const selPath = ref('$');
const treeKey = ref(0);
const treeCtx: TreeCtx = { selected: selPath, gen: ref(0), action: ref<'' | 'expand' | 'collapse'>(''), budget: { n: 0 } };
provide(TREE_CTX, treeCtx);

// ---------- 页面元素 ----------
const ta = ref<HTMLTextAreaElement | null>(null);
const gutterEl = ref<HTMLElement | null>(null);
const outEl = ref<HTMLElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

// ---------- 展示用的计算值 ----------
const inLines = computed(() => countLines(input.value));
const inGutter = computed(() => gutterHtml(inLines.value, errLine.value));
const inSize = computed(() => (input.value ? `${inLines.value} 行 · ${fmtSize(byteLen(input.value))}` : ''));
const outGutter = computed(() => {
  const o = textOut.value;
  if (!o) return '';
  const n = countLines(o.text);
  const a = new Array<number>(n);
  for (let i = 0; i < n; i++) a[i] = i + 1;
  return a.join('\n');
});
const outHtml = computed(() => {
  const o = textOut.value;
  if (!o) return '';
  return o.json && o.text.length < 1.5e6 ? highlight(o.text) : escapeHtml(o.text);
});
const outStat = computed(() => {
  const o = out.value;
  if (o.kind === 'text') return `✓ 完成 · ${o.ms} ms` + (o.note ? ` · ${o.note}` : '');
  if (o.kind === 'tree') return `✓ 完成 · ${o.ms} ms · 点击节点可查看并复制路径`;
  return '';
});
const outSize = computed(() => {
  const o = out.value;
  if (o.kind === 'text') return `${countLines(o.text)} 行 · ${fmtSize(byteLen(o.text))}`;
  if (o.kind === 'tree') return fmtSize(byteLen(o.text));
  return '';
});

// ---------- 执行 ----------
const fmtOpt = (compact = false): Core.FmtOpt => ({
  indent: compact ? '' : opt.indent === 'tab' ? '\t' : ' '.repeat(Number(opt.indent)),
  sort: opt.sort,
  ascii: opt.ascii,
});

function setText(text: string, json: boolean, note: string, ms: number): void {
  out.value = { kind: 'text', text, json, note, ms };
}

function describe(p: Core.ParseResult, src: string): void {
  const st = Core.stats(p.root);
  let text = `✓ JSON 格式正确 · ${Core.TYPE_NAME[p.root.t]} · ${st.nodes} 个节点 · 深度 ${st.depth}`;
  let type: StatType = 'ok';
  if (opt.loose) {
    try { Core.parse(src, false); } catch { text += ' · 已按宽松模式修正'; }
  }
  if (st.bigNums) text += ` · ${st.bigNums} 个超长整数已保留原始精度`;
  if (p.warnings.length) {
    type = 'warn';
    const w = p.warnings[0];
    const lc = Core.lineCol(src, w.pos);
    text = `⚠ 有 ${p.warnings.length} 处重复的键，如 ${JSON.stringify(w.key)}（第 ${lc.line} 行），后面的值会覆盖前面的 · ` + text.replace('✓ ', '');
  }
  inStat.value = { type, text };
}

function run(): void {
  const src = input.value;
  save('input', src.length < 1e6 ? src : '');
  errLine.value = 0;
  if (!src.trim()) {
    out.value = { kind: 'empty' };
    inStat.value = { type: '', text: '' };
    return;
  }
  const t0 = performance.now();
  const ms = () => Math.max(1, Math.round(performance.now() - t0));
  try {
    if (props.mode === 'unicode') {
      setText(dir.value === 'toU' ? Core.cnToUnicode(src) : Core.unicodeToCn(src), false, '', ms());
      inStat.value = { type: '', text: '' };
      return;
    }
    if (props.mode === 'escape') {
      if (dir.value === 'unescape') {
        const s = Core.unescapeStr(src);
        try {
          setText(Core.stringify(Core.parse(s, opt.loose).root, fmtOpt()), true, '已去转义并格式化', ms());
        } catch {
          setText(s, false, '已去转义（结果不是 JSON，按原文显示）', ms());
        }
      } else {
        let base = src;
        let note = '已转义原始文本';
        try {
          base = Core.stringify(Core.parse(src, opt.loose).root, { indent: '' });
          note = '已压缩并转义';
        } catch {
          // 不是 JSON：按原文转义
        }
        setText(Core.escapeStr(base), false, note, ms());
      }
      inStat.value = { type: '', text: '' };
      return;
    }

    const p = Core.parse(src, opt.loose);
    describe(p, src);
    switch (props.mode) {
      case 'format':
        setText(Core.stringify(p.root, fmtOpt()), true, '', ms());
        break;
      case 'minify': {
        const text = Core.stringify(p.root, fmtOpt(true));
        const saved = byteLen(src) - byteLen(text);
        setText(text, true, saved > 0 ? `节省 ${fmtSize(saved)}` : '', ms());
        break;
      }
      case 'viewer':
        treeCtx.action.value = '';
        selPath.value = '$';
        treeKey.value++;
        out.value = { kind: 'tree', root: p.root, text: Core.stringify(p.root, fmtOpt()), ms: ms() };
        break;
      case 'yaml':
        setText(Core.toYAML(p.root, { sort: opt.sort }), false, '', ms());
        break;
      case 'xml':
        setText(Core.toXML(p.root), false, '', ms());
        break;
      case 'csv': {
        const r = Core.toCSV(p.root);
        setText(r.text, false, (r.path ? `已自动取 ${r.path} 作为表格 · ` : '') + `${r.rows} 行 × ${r.cols} 列`, ms());
        break;
      }
    }
  } catch (e) {
    if (e instanceof Core.JsonError) showParseError(e, src);
    else showError(e instanceof Error ? e.message : String(e));
  }
}

function showParseError(e: Core.JsonError, src: string): void {
  const { line, col } = Core.lineCol(src, e.pos);
  errLine.value = line;
  inStat.value = { type: 'err', text: `✗ 第 ${line} 行第 ${col} 列：${e.message}` };
  out.value = { kind: 'error', parse: true, message: e.message, line, col, pos: e.pos, ctx: buildCtx(src, line, col) };
}

function showError(message: string): void {
  inStat.value = { type: 'err', text: '✗ ' + message };
  out.value = { kind: 'error', parse: false, message, line: 0, col: 0, pos: 0, ctx: '' };
}

// 输入变化后稍等再执行（大文件等更久）；载入文件、示例等操作立即执行
let timer: number | undefined;
let runNow = false;
watch(input, (v) => {
  errLine.value = 0;
  clearTimeout(timer);
  if (runNow) {
    runNow = false;
    run();
    return;
  }
  timer = window.setTimeout(run, v.length > 2e6 ? 800 : 250);
});
watch(
  () => [opt.indent, opt.sort, opt.ascii, opt.loose, dir.value],
  () => {
    save('indent', opt.indent);
    save('sort', opt.sort);
    save('ascii', opt.ascii);
    save('loose', opt.loose);
    if (dirs.length) save(`dir.${props.mode}`, dir.value);
    clearTimeout(timer);
    run();
  },
);
watch(out, () => nextTick(() => { if (outEl.value) outEl.value.scrollTop = 0; }));
onMounted(run);
onBeforeUnmount(() => clearTimeout(timer));

function setInput(v: string): void {
  if (v === input.value) { run(); return; }
  runNow = true;
  input.value = v;
}

// ---------- 输入区操作 ----------
function syncScroll(): void {
  if (gutterEl.value && ta.value) gutterEl.value.scrollTop = ta.value.scrollTop;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const el = ta.value;
    if (!el) return;
    const ind = opt.indent === 'tab' ? '\t' : ' '.repeat(Number(opt.indent));
    // execCommand 能保留撤销记录；不支持时退回直接修改
    if (!document.execCommand('insertText', false, ind)) {
      el.setRangeText(ind, el.selectionStart, el.selectionEnd, 'end');
      input.value = el.value;
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(timer);
    run();
  }
}

function loadSample(): void {
  const minified = Core.stringify(Core.parse(SAMPLE).root, { indent: '' });
  setInput(props.mode === 'escape' && dir.value === 'unescape' ? Core.escapeStr(minified) : SAMPLE);
}
function clearInput(): void {
  setInput('');
  ta.value?.focus();
}
function openFile(): void {
  fileEl.value?.click();
}
function onFile(e: Event): void {
  const el = e.target as HTMLInputElement;
  const f = el.files?.[0];
  if (f) loadFile(f);
  el.value = '';
}
function onDrop(e: DragEvent): void {
  dragging.value = false;
  const f = e.dataTransfer?.files[0];
  if (f) loadFile(f);
}
function loadFile(f: File): void {
  if (f.size > 50 * 1024 * 1024) { toast('文件超过 50 MB，暂不支持'); return; }
  const r = new FileReader();
  r.onload = () => {
    setInput(typeof r.result === 'string' ? r.result : '');
    toast('已载入 ' + f.name);
  };
  r.readAsText(f);
}

// ---------- 结果区操作 ----------
function copyOut(): void {
  if (!outText.value) { toast('没有可复制的内容'); return; }
  void copyText(outText.value);
}
function copyPath(): void {
  void copyText(selPath.value, '路径已复制');
}
function download(): void {
  const text = outText.value;
  if (!text) { toast('没有可下载的内容'); return; }
  const ext = cfg.ext === 'auto' ? (textOut.value?.json ? 'json' : 'txt') : cfg.ext;
  const blob = new Blob([(ext === 'csv' ? '\uFEFF' : '') + text], { type: `${MIME[ext] ?? 'text/plain'};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kuaijson-${props.mode}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function backfill(): void {
  if (!outText.value) { toast('没有可回填的内容'); return; }
  setInput(outText.value);
  toast('已回填到左侧');
}
function locate(): void {
  const o = errOut.value;
  const el = ta.value;
  if (!o || !el) return;
  el.focus();
  el.setSelectionRange(o.pos, Math.min(o.pos + 1, el.value.length));
  el.scrollTop = Math.max(0, (o.line - 1) * 20 - el.clientHeight / 3);
  syncScroll();
}
function tryLoose(): void {
  opt.loose = true;
}
function expandAll(): void {
  treeCtx.budget.n = 5000;
  treeCtx.action.value = 'expand';
  treeCtx.gen.value++;
  void nextTick(() => { if (treeCtx.budget.n <= 0) toast('节点太多，只展开了前 5000 个'); });
}
function collapseAll(): void {
  treeCtx.action.value = 'collapse';
  treeCtx.gen.value++;
}
</script>

<template>
  <div class="wb">
    <div class="wb-opts">
      <div v-if="dirs.length" class="seg" role="tablist">
        <button v-for="[v, label] in dirs" :key="v" type="button" role="tab" :aria-selected="dir === v" :class="{ on: dir === v }" @click="dir = v">{{ label }}</button>
      </div>
      <label v-if="has('indent')">缩进
        <select v-model="opt.indent">
          <option value="2">2 空格</option>
          <option value="4">4 空格</option>
          <option value="tab">Tab</option>
        </select>
      </label>
      <label v-if="has('sort')"><input v-model="opt.sort" type="checkbox" /> 键名排序</label>
      <label v-if="has('ascii')"><input v-model="opt.ascii" type="checkbox" /> 中文转 \u</label>
      <label v-if="has('loose')" title="允许注释、单引号、末尾逗号、不带引号的键名，输出标准 JSON"><input v-model="opt.loose" type="checkbox" /> 宽松模式</label>
      <span class="wb-hint">Ctrl + Enter 立即执行 · 可以直接把文件拖进输入框</span>
    </div>

    <div class="wb-main">
      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">{{ cfg.inTitle }}</span>
          <button class="btn" type="button" @click="loadSample"><AppIcon name="file-json" :size="14" />示例</button>
          <button class="btn" type="button" @click="openFile"><AppIcon name="folder-open" :size="14" />打开文件</button>
          <input ref="fileEl" type="file" hidden accept=".json,.txt,.log,application/json,text/plain" @change="onFile" />
          <button class="btn" type="button" @click="clearInput"><AppIcon name="trash-2" :size="14" />清空</button>
        </div>
        <div
          class="editor"
          :class="{ drag: dragging }"
          @dragenter.prevent="dragging = true"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <div ref="gutterEl" class="gutter" aria-hidden="true" v-html="inGutter"></div>
          <textarea
            ref="ta"
            v-model="input"
            spellcheck="false"
            autocomplete="off"
            :placeholder="cfg.placeholder"
            :style="{ tabSize }"
            @scroll="syncScroll"
            @keydown="onKeydown"
          ></textarea>
        </div>
        <div class="status">
          <span class="stat" :class="inStat.type">{{ inStat.text }}</span>
          <span class="spacer"></span>
          <span>{{ inSize }}</span>
        </div>
      </section>

      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">{{ cfg.outTitle }}</span>
          <template v-if="treeOut">
            <button class="btn" type="button" @click="expandAll"><AppIcon name="chevrons-up-down" :size="14" />展开全部</button>
            <button class="btn" type="button" @click="collapseAll"><AppIcon name="chevrons-down-up" :size="14" />折叠全部</button>
          </template>
          <button class="btn" type="button" title="把结果放回左侧继续处理" @click="backfill"><AppIcon name="corner-up-left" :size="14" />回填</button>
          <button class="btn" type="button" @click="download"><AppIcon name="download" :size="14" />下载</button>
          <button class="btn primary" type="button" @click="copyOut"><AppIcon name="copy" :size="14" />复制</button>
        </div>
        <div v-if="treeOut" class="pathbar">
          路径 <code>{{ selPath }}</code>
          <button class="link" type="button" @click="copyPath">复制路径</button>
        </div>
        <div ref="outEl" class="out-scroll">
          <div v-if="errOut" class="errbox">
            <div class="err-title">{{ errOut.parse ? 'JSON 格式错误' : '处理失败' }}</div>
            <div class="err-msg">
              <template v-if="errOut.parse">第 <b>{{ errOut.line }}</b> 行，第 <b>{{ errOut.col }}</b> 列：</template>{{ errOut.message }}
            </div>
            <template v-if="errOut.parse">
              <pre class="err-ctx" v-html="errOut.ctx"></pre>
              <div class="err-actions">
                <button class="btn primary" type="button" @click="locate">定位到错误位置</button>
                <button v-if="has('loose') && !opt.loose" class="btn" type="button" @click="tryLoose">用宽松模式试试</button>
              </div>
              <div class="err-tip">常见原因：中文标点、单引号、末尾多余逗号、漏了逗号或引号、括号不配对、从网页复制带入的不可见字符。</div>
            </template>
          </div>
          <div v-else-if="treeOut" class="tree">
            <TreeNode :key="treeKey" :node="treeOut.root" :k="null" path="$" :depth="0" :is-idx="false" />
          </div>
          <template v-else-if="textOut">
            <div class="gutter static" aria-hidden="true">{{ outGutter }}</div>
            <pre class="code" v-html="outHtml"></pre>
          </template>
          <div v-else class="wb-empty">
            <div class="wb-empty-ico">{ }</div>
            <div>在左侧粘贴内容，结果会实时显示在这里</div>
            <button class="btn" type="button" @click="loadSample">载入示例</button>
          </div>
        </div>
        <div class="status">
          <span class="stat ok">{{ outStat }}</span>
          <span class="spacer"></span>
          <span>{{ outSize }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style>
.wb { display: flex; flex-direction: column; gap: 10px; }
.wb-opts { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; color: var(--text-2); font-size: 13px; min-height: 30px; }
.wb-opts label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.wb-opts select { border: 1px solid var(--border-strong); background: var(--panel); color: var(--text); border-radius: 6px; padding: 3px 6px; font: inherit; }
.wb-opts input { accent-color: var(--primary); }
.wb-hint { margin-left: auto; color: var(--muted); font-size: 12px; }
.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 8px; padding: 2px; background: var(--panel); }
.seg button { padding: 3px 12px; border-radius: 6px; color: var(--text-2); font-size: 13px; }
.seg button.on { background: var(--primary); color: #fff; }

.wb-main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; height: max(480px, calc(100vh - 300px)); }
.pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; box-shadow: var(--shadow); }
.pane-head { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.pane-title { font-weight: 600; margin-right: auto; }

.editor { flex: 1; display: flex; min-height: 0; position: relative; }
.editor.drag::after { content: '松开鼠标载入文件'; position: absolute; inset: 8px; border: 2px dashed var(--primary); border-radius: 8px; background: var(--primary-bg); color: var(--primary); display: grid; place-items: center; font-size: 16px; opacity: 0.95; pointer-events: none; }
.gutter { white-space: pre; text-align: right; padding: 10px 8px 40px 12px; font: 13px/20px var(--mono); color: var(--gutter); background: var(--gutter-bg); border-right: 1px solid var(--border); user-select: none; min-width: 46px; overflow: hidden; flex: none; }
.gutter.static { position: sticky; left: 0; overflow: visible; padding-bottom: 10px; z-index: 1; align-self: flex-start; min-height: 100%; }
.gl-err { color: #fff; background: var(--err); border-radius: 3px; padding: 0 3px; }
.editor textarea { flex: 1; min-width: 0; border: 0; outline: 0; resize: none; margin: 0; padding: 10px; font: 13px/20px var(--mono); background: transparent; color: var(--text); white-space: pre; overflow: auto; }
.editor textarea::placeholder { color: var(--muted); }

.pathbar { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-2); background: var(--panel-2); }
.pathbar code { font-family: var(--mono); color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.out-scroll { flex: 1; min-height: 0; overflow: auto; display: flex; }
pre.code { margin: 0; padding: 10px; font: 13px/20px var(--mono); flex: 1 0 auto; color: var(--text); }
.tk { color: var(--k); } .ts { color: var(--s); } .tn { color: var(--n); } .tb { color: var(--b); } .tz { color: var(--nl); } .tp { color: var(--p); } .ti { color: var(--muted); }

.status { display: flex; gap: 12px; padding: 5px 10px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-2); min-height: 28px; align-items: center; }
.stat { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stat.ok { color: var(--ok); } .stat.err { color: var(--err); } .stat.warn { color: var(--warn); }

.wb-empty { margin: auto; text-align: center; color: var(--muted); line-height: 2; padding: 20px; }
.wb-empty-ico { font: 600 36px var(--mono); color: var(--border-strong); }

.errbox { flex: 1; align-self: flex-start; margin: 14px; padding: 16px; border: 1px solid var(--err); background: var(--err-bg); border-radius: 10px; min-width: 0; }
.err-title { font-weight: 700; color: var(--err); font-size: 15px; margin-bottom: 6px; }
.err-msg { margin-bottom: 10px; line-height: 1.6; }
.err-ctx { font: 12.5px/20px var(--mono); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; overflow: auto; margin: 0 0 12px; color: var(--text-2); }
.err-ctx .el { color: var(--text); font-weight: 600; }
.err-ctx .caret { color: var(--err); font-weight: 700; }
.err-actions { display: flex; gap: 8px; }
.err-tip { color: var(--text-2); font-size: 12px; margin-top: 12px; }

.tree { flex: 1 0 auto; padding: 10px 14px; font: 13px/22px var(--mono); }

@media (max-width: 900px) {
  .wb-main { grid-template-columns: 1fr; height: auto; }
  .pane { height: 60vh; }
  .wb-hint { display: none; }
}
</style>
