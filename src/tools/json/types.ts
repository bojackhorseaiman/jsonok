// 工作台的工具定义：每个工具只需要描述“有哪些选项、怎么把输入变成结果”，界面由 Workbench.vue 统一负责
import type { FmtOpt, JNode, ParseResult } from '../../core/json';

export type OptVal = string | boolean;
export type Opts = Record<string, OptVal>;

export interface OptDef {
  key: string;
  label: string;
  type: 'select' | 'check' | 'text';
  options?: [value: string, label: string][];
  def: OptVal;
  title?: string;
  placeholder?: string;
  /** 文本框宽度（px） */
  width?: number;
  /** 只在满足条件时显示（例如某个方向、某种语言） */
  show?: (o: Opts, dir: string) => boolean;
}

/** 表格结果的一行：第一列显示成彩色标签 */
export interface ListRow { tone: 'add' | 'del' | 'mod' | 'err'; cells: string[] }

export type Result =
  | { kind: 'text'; text: string; json?: boolean; note?: string; inNote?: string }
  | { kind: 'tree'; root: JNode; text: string; note?: string }
  | { kind: 'list'; head: string[]; rows: ListRow[]; summary: string; okText: string; text: string; note?: string };

export interface RunCtx {
  /** 各个输入框的原始文本 */
  src: string[];
  /** 已解析好的 JSON（jsonIn 为 true 的输入框才有） */
  json: (ParseResult | null)[];
  o: Opts;
  dir: string;
  fmt: FmtOpt;
}

export interface Preset { label: string; o: Opts }

export interface ToolDef {
  /** 输入框个数，可以随方向变化 */
  inputs?: (dir: string) => 1 | 2;
  inTitles?: (dir: string) => string[];
  outTitle?: (dir: string) => string;
  placeholder?: (dir: string, idx: number) => string;
  opts: OptDef[];
  /** 方向切换，例如 JSON → YAML / YAML → JSON */
  dirs?: [value: string, label: string][];
  /** 回填时切换到的方向（结果放回左侧后要换个方向处理） */
  flip?: Record<string, string>;
  /** 输入内容单独保存，不和其他 JSON 工具共享（例如数据模板） */
  ownInput?: boolean;
  /** 这个输入框的内容是 JSON（工作台会先解析、报错、显示统计） */
  jsonIn?: (dir: string, idx: number) => boolean;
  sample?: (dir: string) => string[];
  run: (c: RunCtx) => Result | Promise<Result>;
  /** 下载的文件扩展名 */
  ext?: (dir: string, o: Opts, res: Result) => string;
  /** 帮助说明（可信的静态 HTML） */
  help?: string;
  /** 一键填入的常用选项，例如 JSONPath 示例 */
  presets?: Preset[];
  /** 显示“重新生成”按钮（随机数据） */
  rerun?: boolean;
  /** 打开文件时接受的类型 */
  accept?: string;
  /** 特殊文件（如 Excel）的读取方式；返回 null 表示按普通文本读取 */
  readFile?: (f: File, dir: string) => Promise<{ text: string; dir?: string; note?: string }> | null;
}

export const str = (o: Opts, k: string): string => String(o[k] ?? '');
export const bool = (o: Opts, k: string): boolean => o[k] === true;
