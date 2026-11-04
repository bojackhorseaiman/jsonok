// 所有使用通用工作台的工具定义（按分类拆在各自的文件里）
import { DEFS as JSON_DEFS } from './json/defs';
import { ENCODE_DEFS } from './encode/defs';
import { CRYPTO_DEFS } from './encode/cryptoDefs';
import { PW_DEFS } from './encode/pwDefs';
import type { ToolDef } from './json/types';

export const ALL_DEFS: Record<string, ToolDef> = { ...JSON_DEFS, ...ENCODE_DEFS, ...CRYPTO_DEFS, ...PW_DEFS };
