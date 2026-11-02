// 所有使用通用工作台的工具定义（按分类拆在各自的 defs.ts 里）
import { DEFS as JSON_DEFS } from './json/defs';
import { ENCODE_DEFS } from './encode/defs';
import type { ToolDef } from './json/types';

export const ALL_DEFS: Record<string, ToolDef> = { ...JSON_DEFS, ...ENCODE_DEFS };
