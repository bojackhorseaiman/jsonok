// JSON Schema：根据示例数据生成 Schema；用 Schema 校验数据（校验器：@cfworker/json-schema）
import { Validator } from '@cfworker/json-schema';
import type { Schema, SchemaDraft } from '@cfworker/json-schema';
import type { JNode } from './json.ts';
import { isIntRaw } from './json.ts';

// ================= 生成 =================

export interface GenOpt {
  /** 把每个对象里都出现的字段设为必填 */
  required: boolean;
  /** 识别常见字符串格式（日期时间、邮箱、网址、IP、UUID） */
  format: boolean;
  draft: '07' | '2020-12';
}

/** 推断过程中的中间结构：同一位置出现的多个值会合并到一起 */
interface Shape {
  types: Set<string>;
  props?: Map<string, Shape>;
  /** 每个字段在多少个对象里出现过 */
  counts?: Map<string, number>;
  /** 合并了多少个对象 */
  objs?: number;
  /** 数组元素的合并结果；空数组为 null */
  items?: Shape | null;
  /** 字符串格式：undefined 还没见过字符串；null 格式不统一 */
  format?: string | null;
}

const FORMATS: [string, RegExp][] = [
  ['date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^https?:\/\/\S+$/],
  ['ipv4', /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
];

function shapeOf(nd: JNode, o: GenOpt): Shape {
  switch (nd.t) {
    case 's': {
      const f = o.format ? FORMATS.find(([, re]) => re.test(nd.v))?.[0] ?? null : null;
      return { types: new Set(['string']), format: f };
    }
    case 'n': return { types: new Set([isIntRaw(nd.raw) ? 'integer' : 'number']) };
    case 'b': return { types: new Set(['boolean']) };
    case 'z': return { types: new Set(['null']) };
    case 'a': {
      let items: Shape | null = null;
      for (const v of nd.items) items = items ? mergeShape(items, shapeOf(v, o)) : shapeOf(v, o);
      return { types: new Set(['array']), items };
    }
    case 'o': {
      const props = new Map<string, Shape>();
      const counts = new Map<string, number>();
      for (const [k, v] of nd.items) {
        const prev = props.get(k);
        props.set(k, prev ? mergeShape(prev, shapeOf(v, o)) : shapeOf(v, o));
        counts.set(k, 1);
      }
      return { types: new Set(['object']), props, counts, objs: 1 };
    }
  }
}

function mergeShape(a: Shape, b: Shape): Shape {
  const r: Shape = { types: new Set([...a.types, ...b.types]) };
  if (a.props || b.props) {
    const props = new Map(a.props ?? []);
    const counts = new Map(a.counts ?? []);
    for (const [k, s] of b.props ?? []) {
      const prev = props.get(k);
      props.set(k, prev ? mergeShape(prev, s) : s);
      counts.set(k, (counts.get(k) ?? 0) + (b.counts?.get(k) ?? 0));
    }
    r.props = props;
    r.counts = counts;
    r.objs = (a.objs ?? 0) + (b.objs ?? 0);
  }
  if (a.items !== undefined || b.items !== undefined) {
    const x = a.items ?? null;
    const y = b.items ?? null;
    r.items = x && y ? mergeShape(x, y) : x ?? y;
  }
  if (a.format === undefined) r.format = b.format;
  else if (b.format === undefined || a.format === b.format) r.format = a.format;
  else r.format = null;
  return r;
}

const TYPE_ORDER = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

function shapeToNode(s: Shape, o: GenOpt): JNode {
  const items: [string, JNode][] = [];
  const types = TYPE_ORDER.filter((t) => s.types.has(t) && !(t === 'integer' && s.types.has('number')));
  if (types.length === 1) items.push(['type', { t: 's', v: types[0] }]);
  else if (types.length > 1) items.push(['type', { t: 'a', items: types.map((v) => ({ t: 's', v }) as JNode) }]);
  if (s.types.has('string') && s.format) items.push(['format', { t: 's', v: s.format }]);
  if (s.props) {
    items.push(['properties', { t: 'o', items: [...s.props].map(([k, v]) => [k, shapeToNode(v, o)] as [string, JNode]) }]);
    if (o.required) {
      const req = [...s.props.keys()].filter((k) => (s.counts?.get(k) ?? 0) === s.objs);
      if (req.length) items.push(['required', { t: 'a', items: req.map((v) => ({ t: 's', v }) as JNode) }]);
    }
  }
  if (s.items !== undefined) items.push(['items', s.items ? shapeToNode(s.items, o) : { t: 'o', items: [] }]);
  return { t: 'o', items };
}

export const DRAFT_URI: Record<GenOpt['draft'], string> = {
  '07': 'http://json-schema.org/draft-07/schema#',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
};

export function generateSchema(root: JNode, o: GenOpt): JNode {
  const body = shapeToNode(shapeOf(root, o), o);
  if (body.t !== 'o') return body;
  return { t: 'o', items: [['$schema', { t: 's', v: DRAFT_URI[o.draft] }], ...body.items] };
}

// ================= 校验 =================

export interface SchemaIssue {
  /** 出错位置，例如 $.users[0].name */
  path: string;
  keyword: string;
  /** 错误类别（中文） */
  label: string;
  /** 具体说明（尽量翻译成中文） */
  message: string;
}

function detectDraft(schema: unknown): SchemaDraft {
  const uri = schema && typeof schema === 'object' ? String((schema as Record<string, unknown>).$schema ?? '') : '';
  if (uri.includes('2020-12')) return '2020-12';
  if (uri.includes('2019-09')) return '2019-09';
  if (uri.includes('draft-04')) return '4';
  return '7';
}

/** 只是“子结构有错误”的汇总性错误，具体错误会单独列出，不重复显示 */
const WRAPPERS = new Set(['properties', 'items', 'prefixItems', 'allOf', '$ref', '$dynamicRef', 'patternProperties', 'dependentSchemas', 'then', 'else', 'false', 'unevaluatedItems']);

const LABEL: Record<string, string> = {
  type: '类型不符',
  required: '缺少必填字段',
  enum: '不在可选值中',
  const: '值不符',
  format: '格式不符',
  pattern: '不匹配正则',
  minLength: '长度太短',
  maxLength: '长度太长',
  minimum: '数值太小',
  maximum: '数值太大',
  exclusiveMinimum: '数值太小',
  exclusiveMaximum: '数值太大',
  multipleOf: '不是指定倍数',
  minItems: '元素太少',
  maxItems: '元素太多',
  uniqueItems: '元素重复',
  contains: '缺少符合条件的元素',
  minProperties: '字段太少',
  maxProperties: '字段太多',
  additionalProperties: '多余的字段',
  unevaluatedProperties: '多余的字段',
  propertyNames: '字段名不符',
  dependentRequired: '缺少关联字段',
  dependencies: '缺少关联字段',
  anyOf: '不满足 anyOf',
  oneOf: '不满足 oneOf',
  not: '不满足 not',
  if: '不满足条件',
};

const TRANSLATE: [RegExp, (...m: string[]) => string][] = [
  [/^Instance does not have required property "(.*)"\.$/, (k) => `缺少必填字段 "${k}"`],
  [/^Instance type "(.*)" is invalid\. Expected "(.*)"\.$/, (a, b) => `类型应为 ${b}，实际是 ${a}`],
  [/^Instance does not match any of (.*)\.$/, (v) => `只能是这些值之一：${v}`],
  [/^String does not match format "(.*)"\.$/, (f) => `不符合 ${f} 格式`],
  [/^String does not match pattern\.$/, () => '不匹配 Schema 里的 pattern 正则'],
  [/^String is too long \((\d+) > (\d+)\)\.$/, (a, b) => `长度 ${a}，最多 ${b}`],
  [/^String is too short \((\d+) < (\d+)\)\.$/, (a, b) => `长度 ${a}，至少 ${b}`],
  [/^(.*) is less than or equal to (.*)\.$/, (a, b) => `${a} 必须大于 ${b}`],
  [/^(.*) is greater than or equal to (.*)\.$/, (a, b) => `${a} 必须小于 ${b}`],
  [/^(.*) is less than (.*)\.$/, (a, b) => `${a} 小于最小值 ${b}`],
  [/^(.*) is greater than (.*)\.$/, (a, b) => `${a} 大于最大值 ${b}`],
  [/^Array has too few items \((\d+) < (\d+)\)\.$/, (a, b) => `有 ${a} 个元素，至少 ${b} 个`],
  [/^Array has too many items \((\d+) > (\d+)\)\.$/, (a, b) => `有 ${a} 个元素，最多 ${b} 个`],
  [/^Duplicate items at indexes (\d+) and (\d+)\.$/, (a, b) => `第 ${a} 个和第 ${b} 个元素重复`],
  [/^Property "(.*)" does not match additional properties schema\.$/, (k) => `不允许出现字段 "${k}"`],
  [/^Instance does not match any subschemas\.$/, () => '不满足 anyOf 里的任何一个条件'],
  [/^Instance does not match exactly one subschema \((\d+) matches\)\.$/, (n) => `应恰好满足 oneOf 里的一个条件，实际满足 ${n} 个`],
];

function translate(msg: string): string {
  for (const [re, f] of TRANSLATE) {
    const m = re.exec(msg);
    if (m) return f(...m.slice(1));
  }
  return msg;
}

/** "#/users/0/name" → "$.users[0].name"（数组下标根据数据判断） */
function toPath(loc: string, data: unknown): string {
  let p = '$';
  let cur: unknown = data;
  for (const raw of loc.replace(/^#\/?/, '').split('/').filter(Boolean)) {
    const k = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      p += `[${k}]`;
      cur = cur[Number(k)];
    } else {
      p += /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
      cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    }
  }
  return p;
}

export function validateSchema(data: unknown, schema: unknown): SchemaIssue[] {
  if (typeof schema !== 'boolean' && (!schema || typeof schema !== 'object' || Array.isArray(schema))) {
    throw new Error('Schema 必须是一个对象（或 true / false）');
  }
  let v: Validator;
  try {
    v = new Validator(schema as Schema | boolean, detectDraft(schema), false);
  } catch (e) {
    throw new Error('Schema 本身有问题：' + (e instanceof Error ? e.message : String(e)));
  }
  const r = v.validate(data);
  if (r.valid) return [];
  return r.errors
    // anyOf / oneOf / not 里面各个分支的错误不单独列出，只显示汇总的那一条
    .filter((e) => !WRAPPERS.has(e.keyword) && !/\/(anyOf|oneOf)\/\d+\//.test(e.keywordLocation) && !/\/not\/./.test(e.keywordLocation))
    .map((e) => ({
      path: toPath(e.instanceLocation, data),
      keyword: e.keyword,
      label: LABEL[e.keyword] ?? e.keyword,
      message: translate(e.error),
    }));
}
