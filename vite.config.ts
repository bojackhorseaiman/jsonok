import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SITE, TOOLS, isLive } from './src/data/catalog';

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * 构建后为每个工具生成独立的 index.html（/json/format/index.html 等），
 * 标题和描述各不相同，方便搜索引擎收录；不需要服务器配置 URL 重写。
 * 同时生成 404.html 和 sitemap.xml（只收录已上线的工具）。
 */
function staticPages(): Plugin {
  let cfg: ResolvedConfig;
  return {
    name: 'kuaijson-static-pages',
    apply: 'build',
    configResolved(c) {
      cfg = c;
    },
    closeBundle() {
      const out = resolve(cfg.root, cfg.build.outDir);
      const tpl = readFileSync(resolve(out, 'index.html'), 'utf8');
      const page = (title: string, desc: string) =>
        tpl
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escAttr(title)}</title>`)
          .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escAttr(desc)}" />`);

      for (const t of TOOLS) {
        const dir = resolve(out, t.id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          resolve(dir, 'index.html'),
          page(`${t.name} - ${SITE.name}在线工具`, `${t.name}：${t.desc}。免费在线使用，数据只在浏览器本地处理，不上传服务器。`),
        );
      }
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));

      const today = new Date().toISOString().slice(0, 10);
      const urls = ['/', ...TOOLS.filter(isLive).map((t) => `/${t.id}/`)];
      writeFileSync(
        resolve(out, 'sitemap.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          urls.map((u) => `  <url><loc>${SITE.url}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
          '\n</urlset>\n',
      );
      cfg.logger.info(`\n[kuaijson] 已生成 ${TOOLS.length} 个工具页面、404.html、sitemap.xml（${urls.length} 个地址）`);
    },
  };
}

export default defineConfig({
  plugins: [vue(), staticPages()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 800 },
});
