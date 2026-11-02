// 文本展示相关的小工具：HTML 转义、JSON 语法高亮、行号、文件大小

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML_ESC[c]);

const TOK = /("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** 给已格式化的 JSON 文本加语法高亮，返回已转义的 HTML */
export function highlight(t: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(t))) {
    out += escapeHtml(t.slice(last, m.index));
    if (m[1]) out += m[2] ? `<span class="tk">${escapeHtml(m[1])}</span>${m[2]}` : `<span class="ts">${escapeHtml(m[1])}</span>`;
    else if (m[3]) out += `<span class="tb">${m[3]}</span>`;
    else if (m[4]) out += '<span class="tz">null</span>';
    else out += `<span class="tn">${m[5]}</span>`;
    last = TOK.lastIndex;
  }
  return out + escapeHtml(t.slice(last));
}

export function countLines(s: string): number {
  let c = 1;
  let i = -1;
  while ((i = s.indexOf('\n', i + 1)) !== -1) c++;
  return c;
}

/** 行号 HTML，出错的行会标红 */
export function gutterHtml(n: number, errLine = 0): string {
  const a = new Array<string | number>(n);
  for (let k = 0; k < n; k++) a[k] = k + 1 === errLine ? `<span class="gl-err">${k + 1}</span>` : k + 1;
  return a.join('\n');
}

export const fmtSize = (b: number): string =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;

const encoder = new TextEncoder();
export const byteLen = (s: string): number => encoder.encode(s).length;

/** 错误位置前后几行的代码片段（HTML），并用 ^ 指出出错的列 */
export function buildCtx(src: string, line: number, col: number): string {
  const lines = src.split('\n');
  const w = String(line + 1).length;
  const errText = (lines[line - 1] ?? '').replace(/\r$/, '');
  const start = errText.length > 90 ? Math.max(0, col - 1 - 45) : 0;
  const prefix = start > 0 ? '…' : '';
  const out: string[] = [];
  for (let l = Math.max(1, line - 2); l <= Math.min(lines.length, line + 1); l++) {
    const t = lines[l - 1].replace(/\r$/, '').replace(/\t/g, ' ');
    const seg = prefix + t.slice(start, start + 90) + (t.length > start + 90 ? '…' : '');
    const row = `${String(l).padStart(w)} │ ${escapeHtml(seg)}`;
    out.push(l === line ? `<span class="el">${row}</span>` : row);
    if (l === line) out.push(`<span class="caret">${' '.repeat(w)} │ ${' '.repeat(prefix.length + col - 1 - start)}^</span>`);
  }
  return out.join('\n');
}
