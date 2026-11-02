import type { Router } from 'vue-router';

/** 设置页面标题和描述（单页切换时同步更新） */
export function setPage(title: string, desc: string): void {
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
}

/** 顶部的区块高度：两行导航（56 + 44） */
export const HEADER_OFFSET = 116;

/** 跳到首页的某个区块（分类、收藏）：已经在首页就平滑滚动，否则先回首页再定位 */
export function gotoSection(router: Router, id: string): void {
  if (router.currentRoute.value.name === 'home') {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(history.state, '', '#' + id);
    return;
  }
  void router.push({ path: '/', hash: '#' + id });
}
