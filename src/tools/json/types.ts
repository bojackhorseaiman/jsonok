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
  /** 不保存到浏览器（例如密钥、临时的对比值） */
  noSave?: boolean;
  /** 只在满足条件时显示（例如某个方向、某种语言） */
  show?: (o: Opts, dir: string) => boolean;
}

/** 通过“打开文件”载入的二进制文件（例如 Base64 编码图片） */
export interface AttachedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
  /** 大文件不读进内存，只保留文件本身，由工具分块读取 */
  blob?: File;
}

/** 表格结果的一行：第一列显示成彩色标签 */
export interface ListRow { tone: 'add' | 'del' | 'mod' | 'err' | 'info'; cells: string[] }

export type Result =
  | { kind: 'text'; text: string; json?: boolean; note?: string; inNote?: string; /** 状态栏颜色，默认绿色 */ tone?: 'ok' | 'warn' | 'err' }
  | { kind: 'tree'; root: JNode; text: string; note?: string }
  | {
      kind: 'list'; head: string[]; rows: ListRow[]; summary: string; okText: string; text: string; note?: string;
      /** 汇总行的颜色 */
      tone?: 'ok' | 'err';
      /** 点击结果单元格就复制 */
      copyable?: boolean;
    }
  /** 二进制结果：可以预览图片、下载文件；text 是十六进制预览（复制用） */
  | { kind: 'bin'; bytes: Uint8Array; mime: string; name: string; text: string; note?: string };

export interface RunCtx {
  /** 各个输入框的原始文本 */
  src: string[];
  /** 已解析好的 JSON（jsonIn 为 true 的输入框才有） */
  json: (ParseResult | null)[];
  o: Opts;
  dir: string;
  fmt: FmtOpt;
  /** 打开文件载入的二进制内容（没有时为 null） */
  file: AttachedFile | null;
  /** 显示进度（耗时较长的计算用） */
  progress: (text: string) => void;
  /** 用户已经改了输入或选项，这次计算的结果不再需要 */
  stale: () => boolean;
}

export interface Preset { label: string; o: Opts }

export interface ToolDef {
  /** 输入框个数，可以随方向变化 */
  inputs?: (dir: string) => 0 | 1 | 2;
  /** 这个输入框可以不填（例如 JWT 验证签名用的密钥） */
  optionalInput?: (dir: string, idx: number) => boolean;
  /** 这个输入框的内容不保存到浏览器（例如私钥、JWT） */
  noSaveInput?: (dir: string, idx: number) => boolean;
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
  sample?: (dir: string, o: Opts) => string[] | Promise<string[]>;
  /** 载入示例时同时设置的选项（例如 HMAC 的示例密钥） */
  sampleOpts?: (dir: string, o: Opts) => Opts;
  /** 不显示“示例”按钮 */
  noSample?: boolean;
  /** 打开文件的大小上限（MB），默认 50 */
  maxFileMB?: number;
  run: (c: RunCtx) => Result | Promise<Result>;
  /** 下载的文件扩展名 */
  ext?: (dir: string, o: Opts, res: Result) => string;
  /** 帮助说明（可信的静态 HTML） */
  help?: string;
  /** 一键填入的常用选项，例如 JSONPath 示例 */
  presets?: Preset[];
  /** 显示“重新生成”按钮（随机数据） */
  rerun?: boolean | ((dir: string) => boolean);
  /** 不显示“回填”按钮（结果放回输入框没有意义，例如密码哈希） */
  noBackfill?: boolean;
  rerunLabel?: string;
  /** 打开文件时接受的类型 */
  accept?: string;
  /** 特殊文件（如 Excel）的读取方式；返回 null 表示按普通文本读取 */
  readFile?: (f: File, dir: string) => Promise<{ text: string; dir?: string; note?: string; bin?: Uint8Array; blob?: File }> | null;
}

export const str = (o: Opts, k: string): string => String(o[k] ?? '');
export const bool = (o: Opts, k: string): boolean => o[k] === true;

/** 给错误标上是哪个输入框的问题（从 0 开始），工作台会把提示显示在那个输入框下面 */
export function inputErr(e: unknown, input: number): Error {
  const err = e instanceof Error ? e : new Error(String(e));
  (err as Error & { input?: number }).input = input;
  return err;
}
