// XML → JSON：自带的小型 XML 解析器（不依赖浏览器的 DOMParser，方便测试，报错带行列）
import type { JNode, JObj } from './json.ts';
import { locError } from './json.ts';

export interface XmlOpt {
  /** 属性名前缀，例如 @id；为空时属性和子元素同级 */
  attrPrefix: string;
  /** 忽略所有属性 */
  ignoreAttrs: boolean;
  /** 自动识别数字和布尔 */
  types: boolean;
  /** 同时有属性 / 子元素和文字时，文字放在这个键下 */
  textKey: string;
}

interface El { name: string; attrs: [string, string][]; kids: (El | string)[] }

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const NAME = /[A-Za-z_:\u00C0-\uFFFF][\w.\-:\u00B7\u00C0-\uFFFF]*/y;

function parseXml(src: string): El {
  let i = 0;
  const n = src.length;
  function fail(msg: string, at: number = i): never {
    throw locError(src, at, msg, 'XML');
  }
  const decode = (s: string, at: number) =>
    s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(cp); } catch { return fail(`无效的字符引用 ${m}`, at); }
      }
      if (e in ENT) return ENT[e];
      return m; // 未知实体（DTD 里定义的）保持原样
    });
  const name = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) fail('这里应为标签名或属性名');
    i = NAME.lastIndex;
    return m[0];
  };
  const ws = () => { while (i < n && /\s/.test(src[i])) i++; };
  /** 跳过注释、声明、处理指令、DOCTYPE；跳过了返回 true */
  const misc = (): boolean => {
    if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i + 4);
      if (j < 0) fail('注释 <!-- 没有结束的 -->');
      i = j + 3;
      return true;
    }
    if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i + 2);
      if (j < 0) fail('<? 没有结束的 ?>');
      i = j + 2;
      return true;
    }
    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {
      let depth = 0;
      for (let j = i + 9; j < n; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        else if (src[j] === '>' && depth <= 0) { i = j + 1; return true; }
      }
      fail('<!DOCTYPE 没有结束的 >');
    }
    return false;
  };
  const element = (): El => {
    const start = i;
    i++; // <
    const tag = name();
    const el: El = { name: tag, attrs: [], kids: [] };
    for (;;) {
      ws();
      if (src.startsWith('/>', i)) { i += 2; return el; }
      if (src[i] === '>') { i++; break; }
      if (i >= n) fail(`<${tag}> 标签没有结束的 >`, start);
      const an = name();
      ws();
      if (src[i] !== '=') fail(`属性 ${an} 后面应为 =`);
      i++;
      ws();
      const qc = src[i];
      if (qc !== '"' && qc !== "'") fail(`属性 ${an} 的值必须用引号包裹`);
      const j = src.indexOf(qc, i + 1);
      if (j < 0) fail(`属性 ${an} 的值缺少结束引号`);
      el.attrs.push([an, decode(src.slice(i + 1, j), i)]);
      i = j + 1;
    }
    for (;;) {
      if (i >= n) fail(`<${tag}> 没有对应的结束标签 </${tag}>`, start);
      if (src.startsWith('</', i)) {
        const at = i;
        i += 2;
        const end = name();
        ws();
        if (src[i] !== '>') fail(`结束标签 </${end} 缺少 >`);
        i++;
        if (end !== tag) fail(`标签不匹配：<${tag}> 的结束标签写成了 </${end}>`, at);
        return el;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const j = src.indexOf(']]>', i + 9);
        if (j < 0) fail('CDATA 没有结束的 ]]>');
        el.kids.push(src.slice(i + 9, j));
        i = j + 3;
        continue;
      }
      if (src[i] === '<') {
        if (misc()) continue;
        el.kids.push(element());
        continue;
      }
      const j = src.indexOf('<', i);
      const end = j < 0 ? n : j;
      el.kids.push(decode(src.slice(i, end), i));
      i = end;
    }
  };

  if (src.charCodeAt(0) === 0xfeff) i = 1;
  let root: El | null = null;
  for (;;) {
    ws();
    if (i >= n) break;
    if (src[i] !== '<') fail(root ? '根元素之后不能再有文字内容' : 'XML 应以 < 开头');
    if (misc()) continue;
    if (root) fail('XML 只能有一个根元素');
    root = element();
  }
  if (!root) fail('没有找到 XML 元素', 0);
  return root;
}

function typedText(s: string, types: boolean): JNode {
  if (types) {
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return { t: 'n', raw: s };
    if (s === 'true' || s === 'false') return { t: 'b', v: s === 'true' };
  }
  return { t: 's', v: s };
}

function convert(el: El, o: XmlOpt): JNode {
  const items: [string, JNode][] = [];
  if (!o.ignoreAttrs) for (const [k, v] of el.attrs) items.push([o.attrPrefix + k, typedText(v, o.types)]);
  const groups = new Map<string, JNode[]>();
  let text = '';
  for (const k of el.kids) {
    if (typeof k === 'string') text += k;
    else {
      const v = convert(k, o);
      const g = groups.get(k.name);
      if (g) g.push(v);
      else groups.set(k.name, [v]);
    }
  }
  const t = text.trim();
  if (!items.length && !groups.size) return typedText(t, o.types);
  for (const [k, vs] of groups) items.push([k, vs.length === 1 ? vs[0] : { t: 'a', items: vs }]);
  if (t) items.push([o.textKey || '#text', typedText(t, o.types)]);
  return { t: 'o', items } as JObj;
}

export function xmlToJson(src: string, o: XmlOpt): JNode {
  const root = parseXml(src);
  return { t: 'o', items: [[root.name, convert(root, o)]] };
}
