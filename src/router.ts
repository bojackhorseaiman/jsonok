import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import { HEADER_OFFSET } from './lib/page';

// 每个工具一个独立地址：/json/format/、/encode/unicode/ ……
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/:cat/:slug/', name: 'tool', component: () => import('./views/ToolView.vue') },
    { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: HEADER_OFFSET };
    return { top: 0 };
  },
});

export default router;
