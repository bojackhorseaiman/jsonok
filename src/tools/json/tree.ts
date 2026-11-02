import type { InjectionKey, Ref } from 'vue';

/** 树形视图共享的状态：当前选中的路径、展开 / 折叠全部的指令 */
export interface TreeCtx {
  selected: Ref<string>;
  /** 每次点“展开全部 / 折叠全部”加 1，节点据此响应 */
  gen: Ref<number>;
  action: Ref<'' | 'expand' | 'collapse'>;
  /** 展开全部时最多展开多少个节点，防止页面卡死 */
  budget: { n: number };
}

export const TREE_CTX: InjectionKey<TreeCtx> = Symbol('tree');

/** 一次最多渲染多少个子节点，更多的点“加载更多” */
export const CHUNK = 1000;
