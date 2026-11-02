// YAML → JSON（解析用 yaml 库；JSON → YAML 用 json.ts 里自己的 toYAML，能保留超长整数和键顺序）
import { parseAllDocuments } from 'yaml';
import type { JNode } from './json.ts';
import { fromJS, locError } from './json.ts';

export interface YamlResult { root: JNode; docs: number; lossy: number }

export function yamlToJson(src: string): YamlResult {
  const parsed = parseAllDocuments(src, { intAsBigInt: true, prettyErrors: false, uniqueKeys: false });
  const docs = Array.isArray(parsed) ? parsed : [];
  for (const d of docs) {
    const e = d.errors[0];
    if (e) {
      const msg = e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
      throw locError(src, e.pos?.[0] ?? 0, `YAML 语法错误：${msg}`, 'YAML');
    }
  }
  const info = { lossy: 0 };
  const values = docs.map((d) => fromJS(d.toJS({ maxAliasCount: 1000 }), info));
  if (!values.length) return { root: { t: 'z' }, docs: 0, lossy: 0 };
  return { root: values.length === 1 ? values[0] : { t: 'a', items: values }, docs: values.length, lossy: info.lossy };
}
