<script setup lang="ts">
// 通用工作台：左边输入（1 或 2 个），右边结果。具体工具的行为由 defs.ts 里的定义决定
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue';
import * as Core from '../../core/json';
import { buildCtx, byteLen, countLines, escapeHtml, fmtSize, highlight } from '../../core/text';
import { load, save } from '../../lib/storage';
import { copyText, toast } from '../../store';
import AppIcon from '../../components/AppIcon';
import CodeInput from './CodeInput.vue';
import TreeNode from './TreeNode.vue';
import { TREE_CTX, type TreeCtx } from './tree';
import { SAMPLE } from './defs';
import { ALL_DEFS as DEFS } from '../allDefs';
import type { AttachedFile, Opts, OptVal, Result } from './types';
import './tool.css';

const props = defineProps<{ id: string }>();
const def = DEFS[props.id];
const dirs = def.dirs ?? [];

// ---------- 方向和选项（缩进、排序等通用选项在各工具之间共享） ----------
const SHARED = new Set(['indent', 'sort', 'ascii', 'loose']);
const optKey = (k: string) => (SHARED.has(k) ? k : `${props.id}.${k}`);
const dir = ref<string>(dirs.length ? load<string>(`dir.${props.id}`, dirs[0][0]) : '');
if (dirs.length && !dirs.some(([v]) => v === dir.value)) dir.value = dirs[0][0];
const o = reactive<Opts>(Object.fromEntries(def.opts.map((d) => {
  const v = d.noSave ? d.def : load<OptVal>(optKey(d.key), d.def);
  return [d.key, typeof v === typeof d.def ? v : d.def];
})));
const visibleOpts = computed(() => def.opts.filter((d) => !d.show || d.show(o, dir.value)));

const count = computed(() => def.inputs?.(dir.value) ?? 1);
const isJson = (i: number) => def.jsonIn?.(dir.value, i) ?? true;
const titles = computed(() => def.inTitles?.(dir.value) ?? (count.value === 2 ? ['输入 A', '输入 B'] : [isJson(0) ? '输入 JSON' : '输入']));
const outTitle = computed(() => def.outTitle?.(dir.value) ?? '结果');
const indentStr = computed(() => (o.indent === 'tab' ? '\t' : ' '.repeat(Number(o.indent ?? 2) || 2)));
const fmt = computed<Core.FmtOpt>(() => ({ indent: indentStr.value, sort: o.sort === true, ascii: o.ascii === true }));
const placeholder = (i: number) => def.placeholder?.(dir.value, i) || (isJson(i) ? '在此粘贴 JSON，或把文件拖到这里…' : '在此粘贴内容，或把文件拖到这里…');

// ---------- 输入内容（JSON 输入在各工具之间共享，切换工具时数据还在） ----------
const storeKey = (d: string, i: number) =>
  (def.jsonIn?.(d, i) ?? true) ? (i === 0 && !def.ownInput ? 'input' : `in.${props.id}.${i}`) : `in.${props.id}.${d}.${i}`;
const inputs = ref<string[]>([0, 1].map((i) => load<string>(storeKey(dir.value, i), '')));
watch(dir, (d, old) => {
  [0, 1].forEach((i) => {
    if (storeKey(d, i) !== storeKey(old, i)) inputs.value[i] = load<string>(storeKey(d, i), '');
  });
});

// ---------- 结果 ----------
interface ErrOut { kind: 'error'; title: string; message: string; which: number; line: number; col: number; pos: number; ctx: string }
type Out = { kind: 'empty' } | { kind: 'hint'; text: string } | (Result & { ms: number }) | ErrOut;
const out = shallowRef<Out>({ kind: 'empty' });
type StatType = '' | 'ok' | 'warn' | 'err';
const stats = ref<{ type: StatType; text: string }[]>([{ type: '', text: '' }, { type: '', text: '' }]);
const errLines = ref([0, 0]);
const running = ref(false);
const progressText = ref('');

const textOut = computed(() => (out.value.kind === 'text' ? out.value : null));
const treeOut = computed(() => (out.value.kind === 'tree' ? out.value : null));
const listOut = computed(() => (out.value.kind === 'list' ? out.value : null));
const errOut = computed(() => (out.value.kind === 'error' ? out.value : null));
const outText = computed(() => {
  const v = out.value;
  return v.kind === 'text' || v.kind === 'tree' || v.kind === 'list' || v.kind === 'bin' ? v.text : '';
});
const binOut = computed(() => (out.value.kind === 'bin' ? out.value : null));
// 二进制结果是图片时显示预览
const binUrl = ref('');
watch(binOut, (b) => {
  if (binUrl.value) URL.revokeObjectURL(binUrl.value);
  binUrl.value = b && /^image\//.test(b.mime) ? URL.createObjectURL(new Blob([b.bytes as unknown as BlobPart], { type: b.mime })) : '';
});
onBeforeUnmount(() => { if (binUrl.value) URL.revokeObjectURL(binUrl.value); });
const canBackfill = computed(() => !def.noBackfill && (!!textOut.value || !!treeOut.value));

const outGutter = computed(() => {
  const t = textOut.value;
  if (!t) return '';
  const n = countLines(t.text);
  return Array.from({ length: n }, (_, i) => i + 1).join('\n');
});
const outHtml = computed(() => {
  const t = textOut.value;
  if (!t) return '';
  return t.json && t.text.length < 1.5e6 ? highlight(t.text) : escapeHtml(t.text);
});
const rerunShown = computed(() => (typeof def.rerun === 'function' ? def.rerun(dir.value) : !!def.rerun));
const outTone = computed(() => (out.value.kind === 'text' ? out.value.tone ?? 'ok' : 'ok'));
const outStat = computed(() => {
  const v = out.value;
  if (v.kind === 'text' || v.kind === 'tree' || v.kind === 'list' || v.kind === 'bin') return `✓ 完成 · ${v.ms} ms` + (v.note ? ` · ${v.note}` : '');
  return '';
});
const outSize = computed(() => {
  const v = out.value;
  if (v.kind === 'text') return `${countLines(v.text)} 行 · ${fmtSize(byteLen(v.text))}`;
  if (v.kind === 'tree') return fmtSize(byteLen(v.text));
  if (v.kind === 'list') return `${v.rows.length} 条`;
  if (v.kind === 'bin') return fmtSize(v.bytes.length);
  return '';
});

// ---------- 树形视图 ----------
const selPath = ref('$');
const treeKey = ref(0);
const treeCtx: TreeCtx = { selected: selPath, gen: ref(0), action: ref<'' | 'expand' | 'collapse'>(''), budget: { n: 0 } };
provide(TREE_CTX, treeCtx);

// ---------- 执行 ----------
function describe(i: number, p: Core.ParseResult, src: string): void {
  const st = Core.stats(p.root);
  let text = `✓ JSON 格式正确 · ${Core.TYPE_NAME[p.root.t]} · ${st.nodes} 个节点 · 深度 ${st.depth}`;
  let type: StatType = 'ok';
  if (o.loose === true) {
    try { Core.parse(src, false); } catch { text += ' · 已按宽松模式修正'; }
  }
  if (st.bigNums) text += ` · ${st.bigNums} 个超长整数已保留原始精度`;
  if (p.warnings.length) {
    type = 'warn';
    const w = p.warnings[0];
    const lc = Core.lineCol(src, w.pos);
    text = `⚠ 有 ${p.warnings.length} 处重复的键，如 ${JSON.stringify(w.key)}（第 ${lc.line} 行），后面的值会覆盖前面的 · ` + text.replace('✓ ', '');
  }
  stats.value[i] = { type, text };
}

function locErr(which: number, src: string, title: string, message: string, line: number, col: number): ErrOut {
  errLines.value[which] = line;
  stats.value[which] = { type: 'err', text: `✗ 第 ${line} 行第 ${col} 列：${message}` };
  return { kind: 'error', title, message, which, line, col, pos: Core.posOf(src, line, col), ctx: buildCtx(src, line, col) };
}

// 打开的二进制文件：输入框里显示一行说明；用户改了输入框内容就不再使用这个文件
const attached = shallowRef<(AttachedFile & { marker: string }) | null>(null);
const attachedFile = (): AttachedFile | null => (attached.value && inputs.value[0] === attached.value.marker ? attached.value : null);

let runId = 0;
async function run(): Promise<void> {
  const id = ++runId;
  const n = count.value;
  const src = inputs.value.slice(0, n);
  if (attached.value && !attachedFile()) attached.value = null;
  src.forEach((s, i) => save(storeKey(dir.value, i), (i === 0 && attached.value) || s.length >= 1e6 || def.noSaveInput?.(dir.value, i) ? '' : s));
  errLines.value = [0, 0];
  stats.value = [{ type: '', text: '' }, { type: '', text: '' }];
  // 没有输入框的工具（例如生成密钥对）直接执行
  if (n > 0 && src.every((s) => !s.trim())) { out.value = { kind: 'empty' }; return; }
  const blank = src.findIndex((s, i) => !s.trim() && !def.optionalInput?.(dir.value, i));
  if (blank >= 0) { out.value = { kind: 'hint', text: `请在「${titles.value[blank]}」里输入内容` }; return; }

  const parsed: (Core.ParseResult | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (!isJson(i)) { parsed.push(null); continue; }
    try {
      const p = Core.parse(src[i], o.loose === true);
      parsed.push(p);
      describe(i, p, src[i]);
    } catch (e) {
      if (e instanceof Core.JsonError) {
        const { line, col } = Core.lineCol(src[i], e.pos);
        out.value = locErr(i, src[i], n > 1 ? `「${titles.value[i]}」JSON 格式错误` : 'JSON 格式错误', e.message, line, col);
        return;
      }
      throw e;
    }
  }

  const t0 = performance.now();
  running.value = true;
  try {
    progressText.value = '';
    const res = await def.run({
      src, json: parsed, o: { ...o }, dir: dir.value, fmt: fmt.value, file: attachedFile(),
      progress: (t: string) => { if (id === runId) progressText.value = t; },
      stale: () => id !== runId,
    });
    if (id !== runId) return;
    if (res.kind === 'tree') {
      treeCtx.action.value = '';
      selPath.value = '$';
      treeKey.value++;
    }
    out.value = { ...res, ms: Math.max(1, Math.round(performance.now() - t0)) };
  } catch (e) {
    if (id !== runId) return;
    if (e instanceof Core.LocError) {
      const i = Math.max(0, src.findIndex((_, k) => !isJson(k)));
      out.value = locErr(i, src[i], `${e.label} 格式错误`, e.message.replace(/^\w+ (语法|格式)错误：/, ''), e.line, e.col);
    } else {
      const message = e instanceof Error ? e.message : String(e);
      // 工具可以用 inputErr 指明是哪个输入框的问题，默认是第一个
      const at = Number((e as { input?: number }).input ?? 0);
      const which = Number.isInteger(at) && at >= 0 && at < src.length ? at : 0;
      stats.value[which] = { type: 'err', text: '✗ ' + message };
      out.value = { kind: 'error', title: '处理失败', message, which, line: 0, col: 0, pos: 0, ctx: '' };
    }
  } finally {
    if (id === runId) { running.value = false; progressText.value = ''; }
  }
}

// 输入变化后稍等再执行（大文件等更久）；载入文件、示例等操作立即执行
let timer: number | undefined;
function schedule(now = false): void {
  clearTimeout(timer);
  const len = inputs.value[0].length + inputs.value[1].length;
  if (now) void run();
  else timer = window.setTimeout(() => void run(), len > 2e6 ? 800 : 250);
}
watch(inputs, () => schedule(), { deep: true });
watch(
  () => JSON.stringify(o),
  () => {
    def.opts.forEach((d) => { if (!d.noSave) save(optKey(d.key), o[d.key]); });
    // 文本选项（比如 JSONPath 表达式）边打字边执行，稍等一下
    schedule(!def.opts.some((d) => d.type === 'text'));
  },
);
watch(dir, (d) => {
  save(`dir.${props.id}`, d);
  void nextTick(() => schedule(true));
});
watch(out, () => nextTick(() => { if (outEl.value) outEl.value.scrollTop = 0; }));
onMounted(() => void run());
onBeforeUnmount(() => clearTimeout(timer));

// ---------- 输入区操作 ----------
const inputRefs: (InstanceType<typeof CodeInput> | null)[] = [null, null];
const setRef = (i: number, el: unknown) => { inputRefs[i] = el as InstanceType<typeof CodeInput> | null; };
async function loadSample(): Promise<void> {
  try {
    if (def.sampleOpts) Object.assign(o, def.sampleOpts(dir.value, o));
    const s = await (def.sample?.(dir.value, o) ?? [SAMPLE]);
    s.forEach((v, i) => (inputs.value[i] = v));
  } catch (e) {
    toast('载入示例失败：' + (e instanceof Error ? e.message : String(e)));
  }
}
async function onFile(i: number, f: File): Promise<void> {
  const maxMB = def.maxFileMB ?? 50;
  if (f.size > maxMB * 1024 * 1024) { toast(`文件超过 ${maxMB >= 1024 ? maxMB / 1024 + ' GB' : maxMB + ' MB'}，暂不支持`); return; }
  try {
    const special = def.readFile?.(f, dir.value);
    if (special) {
      const r = await special;
      if (r.dir) dir.value = r.dir;
      await nextTick();
      attached.value = r.bin || r.blob ? { name: f.name, type: f.type, bytes: r.bin ?? new Uint8Array(0), blob: r.blob, marker: r.text } : null;
      inputs.value[i] = r.text;
      toast(r.note ?? '已载入 ' + f.name);
      return;
    }
    inputs.value[i] = await f.text();
    toast('已载入 ' + f.name);
  } catch (e) {
    toast(e instanceof Error ? e.message : '读取文件失败');
  }
}

// ---------- 结果区操作 ----------
const outEl = ref<HTMLElement | null>(null);
const MIME: Record<string, string> = { json: 'application/json', yaml: 'text/yaml', xml: 'application/xml', csv: 'text/csv', sql: 'application/sql' };
function copyOut(): void {
  if (!outText.value) { toast('没有可复制的内容'); return; }
  void copyText(outText.value);
}
function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function download(): void {
  const v = out.value;
  if (v.kind === 'bin') { saveBlob(new Blob([v.bytes as unknown as BlobPart], { type: v.mime }), v.name); return; }
  if (!outText.value || (v.kind !== 'text' && v.kind !== 'tree' && v.kind !== 'list')) { toast('没有可下载的内容'); return; }
  const ext = def.ext?.(dir.value, o, v) ?? 'txt';
  const blob = new Blob([(ext === 'csv' ? '\uFEFF' : '') + outText.value], { type: `${MIME[ext] ?? 'text/plain'};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kuaijson-${props.id.split('/')[1]}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function backfill(): Promise<void> {
  if (!canBackfill.value) { toast('没有可回填的内容'); return; }
  const text = outText.value;
  const next = def.flip?.[dir.value];
  if (next) {
    dir.value = next;
    await nextTick();
  }
  inputs.value[0] = text;
  toast(next ? `已回填到左侧，并切换到「${dirs.find(([v]) => v === next)?.[1]}」` : '已回填到左侧');
}
function locate(): void {
  const e = errOut.value;
  if (e && e.line) inputRefs[e.which]?.locate(e.pos, e.line);
}
const hasLoose = computed(() => visibleOpts.value.some((d) => d.key === 'loose'));
function applyPreset(p: Opts): void {
  Object.assign(o, p);
}
const presetOn = (p: Opts) => Object.entries(p).every(([k, v]) => o[k] === v);
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
      <template v-for="d in visibleOpts" :key="d.key">
        <label v-if="d.type === 'check'" :title="d.title"><input v-model="o[d.key]" type="checkbox" /> {{ d.label }}</label>
        <label v-else-if="d.type === 'select'" :title="d.title">{{ d.label }}
          <select v-model="o[d.key]">
            <option v-for="[v, l] in d.options" :key="v" :value="v">{{ l }}</option>
          </select>
        </label>
        <label v-else class="opt-text" :title="d.title">{{ d.label }}
          <input v-model="o[d.key]" type="text" spellcheck="false" :placeholder="d.placeholder" :style="{ width: (d.width ?? 120) + 'px' }" />
        </label>
      </template>
      <span v-if="count > 0" class="wb-hint">Ctrl + Enter 立即执行 · 可以直接把文件拖进输入框</span>
    </div>
    <div v-if="def.presets" class="presets">
      <span class="muted">常用：</span>
      <button v-for="p in def.presets" :key="p.label" type="button" class="chip" :class="{ on: presetOn(p.o) }" @click="applyPreset(p.o)">{{ p.label }}</button>
    </div>

    <div class="wb-main" :class="{ solo: count === 0 }">
      <div v-if="count > 0" class="wb-inputs" :class="{ dual: count === 2 }">
        <CodeInput
          v-for="i in count"
          :key="`${dir}-${i}`"
          :ref="(el) => setRef(i - 1, el)"
          v-model="inputs[i - 1]"
          :title="titles[i - 1]"
          :placeholder="placeholder(i - 1)"
          :err-line="errLines[i - 1]"
          :stat="stats[i - 1]"
          :indent="indentStr"
          :accept="def.accept"
          :sample="i === 1 && !def.noSample"
          @sample="loadSample"
          @file="(f: File) => onFile(i - 1, f)"
          @run="schedule(true)"
        />
      </div>

      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">{{ outTitle }}<span v-if="running" class="spin" aria-label="处理中"></span><span v-if="running && progressText" class="progress-t">{{ progressText }}</span></span>
          <template v-if="treeOut">
            <button class="btn" type="button" @click="expandAll"><AppIcon name="chevrons-up-down" :size="14" />展开全部</button>
            <button class="btn" type="button" @click="collapseAll"><AppIcon name="chevrons-down-up" :size="14" />折叠全部</button>
          </template>
          <button v-if="rerunShown" class="btn" type="button" @click="schedule(true)"><AppIcon name="dices" :size="14" />{{ def.rerunLabel ?? '重新生成' }}</button>
          <button v-if="canBackfill" class="btn" type="button" title="把结果放回左侧继续处理" @click="backfill"><AppIcon name="corner-up-left" :size="14" />回填</button>
          <button class="btn" type="button" @click="download"><AppIcon name="download" :size="14" />下载</button>
          <button class="btn primary" type="button" @click="copyOut"><AppIcon name="copy" :size="14" />复制</button>
        </div>
        <div v-if="treeOut" class="pathbar">
          路径 <code>{{ selPath }}</code>
          <button class="link" type="button" @click="copyText(selPath, '路径已复制')">复制路径</button>
        </div>
        <div ref="outEl" class="out-scroll">
          <div v-if="errOut" class="errbox">
            <div class="err-title">{{ errOut.title }}</div>
            <div class="err-msg">
              <template v-if="errOut.line">第 <b>{{ errOut.line }}</b> 行，第 <b>{{ errOut.col }}</b> 列：</template>{{ errOut.message }}
            </div>
            <template v-if="errOut.line">
              <pre class="err-ctx" v-html="errOut.ctx"></pre>
              <div class="err-actions">
                <button class="btn primary" type="button" @click="locate">定位到错误位置</button>
                <button v-if="hasLoose && !o.loose && isJson(errOut.which)" class="btn" type="button" @click="o.loose = true">用宽松模式试试</button>
              </div>
              <div v-if="isJson(errOut.which)" class="err-tip">常见原因：中文标点、单引号、末尾多余逗号、漏了逗号或引号、括号不配对、从网页复制带入的不可见字符。</div>
            </template>
          </div>
          <div v-else-if="treeOut" class="tree">
            <TreeNode :key="treeKey" :node="treeOut.root" :k="null" path="$" :depth="0" :is-idx="false" />
          </div>
          <div v-else-if="listOut" class="list-out">
            <div v-if="!listOut.rows.length" class="ok-box">{{ listOut.okText }}</div>
            <template v-else>
              <div class="list-sum" :class="listOut.tone">{{ listOut.summary }}</div>
              <table class="list-t">
                <thead><tr><th v-for="h in listOut.head" :key="h">{{ h }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, ri) in listOut.rows" :key="ri">
                    <td><span class="tag" :class="r.tone">{{ r.cells[0] }}</span></td>
                    <td
                      v-for="(c, ci) in r.cells.slice(1)"
                      :key="ci"
                      :class="{ mono: ci === 0 || listOut.head.length === 4, copy: listOut.copyable }"
                      :title="listOut.copyable ? '点击复制' : undefined"
                      @click="listOut.copyable && copyText(c, `已复制 ${r.cells[0]}`)"
                    >{{ c }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <div v-else-if="binOut" class="bin-out">
            <div class="bin-info">
              <span>{{ binOut.note }}</span>
              <button class="btn primary" type="button" @click="download"><AppIcon name="download" :size="14" />下载文件</button>
            </div>
            <img v-if="binUrl" class="bin-img" :src="binUrl" alt="图片预览" />
            <div class="bin-sub">十六进制预览</div>
            <pre class="bin-hex">{{ binOut.text }}</pre>
          </div>
          <template v-else-if="textOut">
            <div class="gutter static" aria-hidden="true">{{ outGutter }}</div>
            <pre class="code" v-html="outHtml"></pre>
          </template>
          <div v-else class="wb-empty">
            <div class="wb-empty-ico">{ }</div>
            <div>{{ out.kind === 'hint' ? out.text : '在左侧输入内容，结果会实时显示在这里' }}</div>
            <button v-if="!def.noSample" class="btn" type="button" @click="loadSample">载入示例</button>
          </div>
        </div>
        <div class="status">
          <span class="stat" :class="outTone" :title="outStat">{{ outStat }}</span>
          <span class="spacer"></span>
          <span>{{ outSize }}</span>
        </div>
      </section>
    </div>

    <details v-if="def.help" class="help" open>
      <summary>使用说明</summary>
      <div class="help-body" v-html="def.help"></div>
    </details>
  </div>
</template>
