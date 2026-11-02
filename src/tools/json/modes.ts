// JSON 工作台的各种模式：每个工具页用同一个工作台组件，只是模式不同

export type Mode = 'format' | 'minify' | 'viewer' | 'escape' | 'yaml' | 'xml' | 'csv' | 'unicode';
export type OptKey = 'indent' | 'sort' | 'ascii' | 'loose';

export interface ModeCfg {
  inTitle: string;
  outTitle: string;
  placeholder: string;
  /** 显示哪些选项 */
  opts: OptKey[];
  /** 有方向切换的模式（转义 / 去转义 等）：[值, 显示名] */
  dir?: [string, string][];
  /** 下载的文件类型；auto = 结果是 JSON 就存 .json，否则 .txt */
  ext: string;
}

const JSON_PH = '在此粘贴 JSON，或把 .json 文件拖到这里…';

export const MODES: Record<Mode, ModeCfg> = {
  format: { inTitle: '输入 JSON', outTitle: '格式化结果', placeholder: JSON_PH, opts: ['indent', 'sort', 'ascii', 'loose'], ext: 'json' },
  minify: { inTitle: '输入 JSON', outTitle: '压缩结果', placeholder: JSON_PH, opts: ['sort', 'ascii', 'loose'], ext: 'json' },
  viewer: { inTitle: '输入 JSON', outTitle: '树形视图', placeholder: JSON_PH, opts: ['sort', 'loose'], ext: 'json' },
  escape: {
    inTitle: '输入',
    outTitle: '结果',
    placeholder: '粘贴 JSON 或任意文本进行转义；切换到“去转义”可以还原 {\\"a\\":1} 这样的字符串…',
    opts: ['loose'],
    dir: [['escape', '转义'], ['unescape', '去转义']],
    ext: 'auto',
  },
  yaml: { inTitle: '输入 JSON', outTitle: 'YAML', placeholder: JSON_PH, opts: ['sort', 'loose'], ext: 'yaml' },
  xml: { inTitle: '输入 JSON', outTitle: 'XML', placeholder: JSON_PH, opts: ['loose'], ext: 'xml' },
  csv: { inTitle: '输入 JSON', outTitle: 'CSV', placeholder: '粘贴 JSON 数组，或 {"data":[...]} 这类包了一层的数据…', opts: ['loose'], ext: 'csv' },
  unicode: {
    inTitle: '输入',
    outTitle: '结果',
    placeholder: '粘贴包含 \\u4e2d\\u6587 这类编码的文本，或普通中文…',
    opts: [],
    dir: [['toCn', 'Unicode 转中文'], ['toU', '中文转 Unicode']],
    ext: 'txt',
  },
};

export const MIME: Record<string, string> = {
  json: 'application/json',
  yaml: 'text/yaml',
  xml: 'application/xml',
  csv: 'text/csv',
  txt: 'text/plain',
};

export const SAMPLE = String.raw`{"site":"快JSON","url":"https://www.kuaijson.com","version":"1.0.0","features":["格式化","校验","压缩","转义","树形视图","转 YAML/XML/CSV"],"stats":{"users":10240,"rating":4.9,"online":true,"beta":null},"orderId":1234567890123456789,"users":[{"id":1,"name":"张三","city":"青岛","tags":["dev","json"]},{"id":2,"name":"李四","city":"北京","tags":[]}],"tip":"\u6570\u636e\u53ea\u5728\u672c\u5730\u5904\u7406"}`;
