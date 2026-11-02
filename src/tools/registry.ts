// 已实现的工具：工具 id → 页面组件（按需加载）+ 传给组件的参数
// 新增工具时，在这里登记，并把 catalog.ts 里对应工具的标记加上 done
import type { AsyncComponentLoader } from 'vue';

export interface ToolImpl {
  load: AsyncComponentLoader;
  props?: Record<string, unknown>;
}

const workbench: AsyncComponentLoader = () => import('./json/JsonWorkbench.vue');

export const TOOL_IMPL: Record<string, ToolImpl> = {
  'json/format': { load: workbench, props: { mode: 'format' } },
  'json/minify': { load: workbench, props: { mode: 'minify' } },
  'json/viewer': { load: workbench, props: { mode: 'viewer' } },
  'json/escape': { load: workbench, props: { mode: 'escape' } },
  'json/yaml': { load: workbench, props: { mode: 'yaml' } },
  'json/xml': { load: workbench, props: { mode: 'xml' } },
  'json/csv': { load: workbench, props: { mode: 'csv' } },
  'encode/unicode': { load: workbench, props: { mode: 'unicode' } },
};
