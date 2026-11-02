# 快JSON

开发者在线工具箱：JSON 格式化校验、树形查看、压缩转义、格式转换、编解码……
所有工具都只在浏览器本地运行，数据不会上传到服务器。

技术栈：Vite + Vue 3 + TypeScript + Vue Router，构建结果是纯静态网站。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 本地开发，打开 http://localhost:5173
npm test           # 运行 JSON 核心库测试
npm run build      # 类型检查 + 打包，输出到 dist/
npm run preview    # 本地预览打包结果
```

## 目录结构

```
src/
├── data/
│   ├── catalog.ts        工具目录（全站唯一的数据来源：分类、名称、说明、标记）
│   ├── toolIcons.ts      每个工具 / 分类对应的图标名
│   └── iconPaths.ts      Lucide 图标的 SVG 数据（脚本生成，只收录用到的）
├── core/                 纯逻辑，不依赖浏览器，可以在 Node 里测试
│   ├── json.ts           自研 JSON 解析器 + YAML / XML / CSV / 转义 / Unicode
│   └── text.ts           语法高亮、行号、文件大小等
├── tools/
│   ├── registry.ts       已实现的工具：工具 id → 页面组件
│   └── json/             JSON 工作台（8 个 JSON 相关工具共用）
├── components/           顶部导航、搜索面板、工具卡片、图标等
├── views/                首页、工具页、404
├── lib/                  本地存储、搜索、页面标题
├── store.ts              收藏、最近使用、主题等全局状态
└── styles/               全局样式和设计变量（浅色 / 深色）
tests/json.test.ts        核心库测试
```

## 新增一个工具

1. 在 `src/tools/` 下写好页面组件；纯逻辑放到 `src/core/`，并补测试。
2. 在 `src/tools/registry.ts` 里登记：`'分类/slug': { load: () => import('./xxx/Xxx.vue') }`。
3. 在 `src/data/catalog.ts` 里给这个工具加上 `done` 标记，首页和导航上的“开发中”标签会自动去掉。

## 部署

`npm run build` 后把 `dist/` 整个目录上传到任意静态服务器或 CDN 即可。

- 每个工具都会生成独立的 `index.html`（例如 `dist/json/format/index.html`），标题和描述各不相同，方便搜索引擎收录，**不需要**配置 URL 重写。
- 同时生成 `404.html` 和 `sitemap.xml`（只包含已上线的工具）。
- 正式域名在 `src/data/catalog.ts` 的 `SITE.url` 和 `public/robots.txt` 里修改。
- 部署在中国大陆的服务器需要先完成 ICP 备案，并把备案号填到 `src/App.vue` 的页脚。
