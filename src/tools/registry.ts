// 已实现的工具：工具 id → 页面组件（按需加载）+ 传给组件的参数
// 新增工具时，在这里登记，并把 catalog.ts 里对应工具的标记加上 done
import type { AsyncComponentLoader } from 'vue';
import { DEF_IDS } from './json/ids';

export interface ToolImpl {
  load: AsyncComponentLoader;
  props?: Record<string, unknown>;
}

const workbench: AsyncComponentLoader = () => import('./json/Workbench.vue');

export const TOOL_IMPL: Record<string, ToolImpl> = {
  // 用通用工作台的工具（具体行为见 json/defs.ts）
  ...Object.fromEntries(DEF_IDS.map((id) => [id, { load: workbench, props: { id } }])),
  // 有独立界面的工具
  'json/editor': { load: () => import('./json/JsonEditor.vue') },
};
