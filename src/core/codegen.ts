/**
 * JSON 转代码：根据示例 JSON 推断类型，生成各种语言的类 / 结构体。
 * - 数组里的多个对象会合并成一个类：有的元素缺少的字段标为可选
 * - 出现过 null 的字段标为可空；整数按大小选 int / long / 大数类型
 */
import type { JNode } from './json.ts';
import { isIntRaw } from './json.ts';

export type Lang = 'ts' | 'java' | 'kotlin' | 'csharp' | 'go' | 'python' | 'rust' | 'swift' | 'dart' | 'php' | 'cpp';

/** [语言, 显示名, 文件扩展名] */
export const LANGS: [Lang, string, string][] = [
  ['ts', 'TypeScript', 'ts'],
  ['java', 'Java', 'java'],
  ['kotlin', 'Kotlin', 'kt'],
  ['csharp', 'C#', 'cs'],
  ['go', 'Go', 'go'],
  ['python', 'Python', 'py'],
  ['rust', 'Rust', 'rs'],
  ['swift', 'Swift', 'swift'],
  ['dart', 'Dart', 'dart'],
  ['php', 'PHP', 'php'],
  ['cpp', 'C++ (nlohmann/json)', 'hpp'],
];

export interface CodeOpt {
  lang: Lang;
  /** 根类名 */
  root: string;
  tsStyle: 'interface' | 'type';
  javaStyle: 'lombok' | 'pojo' | 'record';
  pyStyle: 'dataclass' | 'pydantic' | 'typeddict';
  csLib: 'stj' | 'newtonsoft';
  ktLib: 'kotlinx' | 'gson';
}

// ================= 类型推断 =================

type Prim = 'string' | 'int' | 'long' | 'big' | 'float' | 'bool' | 'any';

interface Shape {
  k: 'null' | 'prim' | 'arr' | 'obj' | 'any';
  p?: Prim;
  item?: Shape | null;
  fields?: Map<string, { s: Shape; n: number }>;
  objs?: number;
  nullable?: boolean;
}

const INT32 = 2147483647n;
const INT64 = 9223372036854775807n;

function intKind(raw: string): Prim {
  let v = BigInt(raw);
  if (v < 0n) v = -v - 1n;
  return v <= INT32 ? 'int' : v <= INT64 ? 'long' : 'big';
}

function shapeOf(nd: JNode): Shape {
  switch (nd.t) {
    case 'z': return { k: 'null' };
    case 's': return { k: 'prim', p: 'string' };
    case 'b': return { k: 'prim', p: 'bool' };
    case 'n': return { k: 'prim', p: isIntRaw(nd.raw) ? intKind(nd.raw) : 'float' };
    case 'a': {
      let item: Shape | null = null;
      for (const v of nd.items) item = item ? mergeShape(item, shapeOf(v)) : shapeOf(v);
      return { k: 'arr', item };
    }
    case 'o': {
      const fields = new Map<string, { s: Shape; n: number }>();
      for (const [k, v] of nd.items) {
        const prev = fields.get(k);
        fields.set(k, { s: prev ? mergeShape(prev.s, shapeOf(v)) : shapeOf(v), n: 1 });
      }
      return { k: 'obj', fields, objs: 1 };
    }
  }
}

const INTS: Prim[] = ['int', 'long', 'big'];

function mergePrim(a: Prim, b: Prim): Prim {
  if (a === b) return a;
  const ia = INTS.indexOf(a);
  const ib = INTS.indexOf(b);
  if (ia >= 0 && ib >= 0) return INTS[Math.max(ia, ib)];
  if ((ia >= 0 || a === 'float') && (ib >= 0 || b === 'float')) return 'float';
  return 'any';
}

function mergeShape(a: Shape, b: Shape): Shape {
  if (a.k === 'null') return { ...b, nullable: true };
  if (b.k === 'null') return { ...a, nullable: true };
  const nullable = !!(a.nullable || b.nullable);
  if (a.k === 'prim' && b.k === 'prim') {
    const p = mergePrim(a.p!, b.p!);
    return p === 'any' ? { k: 'any', nullable } : { k: 'prim', p, nullable };
  }
  if (a.k === 'arr' && b.k === 'arr') {
    const x = a.item ?? null;
    const y = b.item ?? null;
    return { k: 'arr', item: x && y ? mergeShape(x, y) : x ?? y, nullable };
  }
  if (a.k === 'obj' && b.k === 'obj') {
    const fields = new Map(a.fields);
    for (const [k, f] of b.fields!) {
      const prev = fields.get(k);
      fields.set(k, prev ? { s: mergeShape(prev.s, f.s), n: prev.n + f.n } : f);
    }
    return { k: 'obj', fields, objs: a.objs! + b.objs!, nullable };
  }
  return { k: 'any', nullable };
}

export type TRef =
  | { k: 'prim'; p: Prim; nullable: boolean }
  | { k: 'arr'; item: TRef; nullable: boolean }
  | { k: 'obj'; cls: ClassDef; nullable: boolean };

export interface Field { key: string; type: TRef; optional: boolean }
export interface ClassDef { name: string; fields: Field[] }

// ================= 命名 =================

function words(s: string): string[] {
  return s
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z\d\u4e00-\u9fa5]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const pascal = (s: string) => words(s).map(cap).join('');
const camel = (s: string) => {
  const w = words(s);
  return w.length ? w[0] + w.slice(1).map(cap).join('') : '';
};
const snake = (s: string) => words(s).join('_');
const isIdent = (s: string) => /^[A-Za-z_][A-Za-z\d_]*$/.test(s);

function singular(name: string): string {
  if (/List$/.test(name) && name.length > 4) return name.slice(0, -4);
  if (/[^aeiou]ies$/i.test(name)) return name.slice(0, -3) + 'y';
  if (/(ss|x|ch|sh)es$/i.test(name)) return name.slice(0, -2);
  if (/[^s]s$/i.test(name) && name.length > 2) return name.slice(0, -1);
  return name + 'Item';
}

function build(root: JNode, rootName: string): ClassDef[] {
  const classes: ClassDef[] = [];
  const used = new Set<string>();
  const unique = (hint: string): string => {
    let base = pascal(hint) || 'Item';
    if (/^\d/.test(base)) base = 'T' + base;
    let name = base;
    for (let i = 2; used.has(name); i++) name = base + i;
    used.add(name);
    return name;
  };
  const mat = (s: Shape, hint: string): TRef => {
    const nullable = !!s.nullable;
    switch (s.k) {
      case 'null': return { k: 'prim', p: 'any', nullable: true };
      case 'any': return { k: 'prim', p: 'any', nullable };
      case 'prim': return { k: 'prim', p: s.p!, nullable };
      case 'arr': return { k: 'arr', item: s.item ? mat(s.item, singular(pascal(hint) || 'Item')) : { k: 'prim', p: 'any', nullable: false }, nullable };
      case 'obj': {
        const cls: ClassDef = { name: unique(hint), fields: [] };
        classes.push(cls);
        for (const [key, f] of s.fields!) cls.fields.push({ key, type: mat(f.s, key), optional: f.n < s.objs! });
        return { k: 'obj', cls, nullable };
      }
    }
  };
  const top = shapeOf(root);
  // 根是数组时，元素的类直接用根类名
  if (top.k === 'arr' && top.item) mat(top.item, rootName);
  else mat(top, rootName);
  if (!classes.length) throw new Error('JSON 里没有对象，无法生成类。请输入对象，或元素是对象的数组');
  return classes;
}

/** 字段名去重：不同的键转换后可能同名（例如 userName 和 user_name） */
function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const c = seen.get(n) ?? 0;
    seen.set(n, c + 1);
    return c ? n + (c + 1) : n;
  });
}

const RESERVED: Partial<Record<Lang, Set<string>>> = {
  java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record var'.split(' ')),
  kotlin: new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' ')),
  csharp: new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while'.split(' ')),
  go: new Set('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(' ')),
  python: new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ')),
  rust: new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while'.split(' ')),
  swift: new Set('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super self Self throw throws true try Any Type'.split(' ')),
  dart: new Set('abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield'.split(' ')),
  php: new Set(['this']),
  cpp: new Set('alignas alignof and asm auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(' ')),
};

/** 生成合法的标识符：数字开头加前缀，关键字加后缀 */
function ident(name: string, lang: Lang, fallback = 'field'): string {
  let n = name || fallback;
  if (/^\d/.test(n)) n = (lang === 'go' ? 'N' : '_') + n;
  if (RESERVED[lang]?.has(n)) n = lang === 'rust' ? 'r#' + n : lang === 'swift' ? '`' + n + '`' : n + '_';
  return n;
}

const GO_INITIALISMS = new Set(['id', 'url', 'uri', 'http', 'https', 'api', 'json', 'xml', 'html', 'uuid', 'ip', 'sql', 'ui', 'cpu', 'tcp', 'udp', 'dns', 'ssh', 'tls', 'ttl', 'utf8']);
const goName = (key: string) => words(key).map((w) => (GO_INITIALISMS.has(w) ? w.toUpperCase() : cap(w))).join('');

const q = (s: string) => JSON.stringify(s);
/** Kotlin 字符串：额外转义 $，避免被当成字符串模板 */
const kq = (s: string) => q(s).replace(/\$/g, '\\$');
/** Dart 单引号字符串：转义 \ ' $ 和换行 */
const dq = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n') + "'";

// ================= 各语言 =================

type Gen = (classes: ClassDef[], o: CodeOpt) => string;

// ---------- TypeScript ----------
const genTs: Gen = (classes, o) => {
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') s = { string: 'string', int: 'number', long: 'number', big: 'number', float: 'number', bool: 'boolean', any: 'any' }[r.p];
    else if (r.k === 'arr') {
      const it = t(r.item);
      s = /[| ]/.test(it) ? `(${it})[]` : `${it}[]`;
    } else s = r.cls.name;
    return r.nullable && s !== 'any' ? `${s} | null` : s;
  };
  return classes
    .map((c) => {
      const body = c.fields.map((f) => `  ${/^[A-Za-z_$][\w$]*$/.test(f.key) ? f.key : q(f.key)}${f.optional ? '?' : ''}: ${t(f.type)};`).join('\n');
      return o.tsStyle === 'type' ? `export type ${c.name} = {\n${body}\n};` : `export interface ${c.name} {\n${body}\n}`;
    })
    .join('\n\n') + '\n';
};

// ---------- Java ----------
const genJava: Gen = (classes, o) => {
  const imports = new Set<string>();
  const t = (r: TRef): string => {
    if (r.k === 'prim') {
      if (r.p === 'big') imports.add('java.math.BigInteger');
      return { string: 'String', int: 'Integer', long: 'Long', big: 'BigInteger', float: 'Double', bool: 'Boolean', any: 'Object' }[r.p];
    }
    if (r.k === 'arr') {
      imports.add('java.util.List');
      return `List<${t(r.item)}>`;
    }
    return r.cls.name;
  };
  const style = o.javaStyle;
  if (style === 'lombok') imports.add('lombok.Data');
  const ann = (f: Field, n: string): string => {
    if (n === f.key) return '';
    imports.add('com.fasterxml.jackson.annotation.JsonProperty');
    return `@JsonProperty(${q(f.key)})`;
  };
  /** 生成一个类（不含结尾的 }）；嵌套类缩进一级、加 static */
  const one = (c: ClassDef, nested: boolean): string => {
    const ind = nested ? '    ' : '';
    const names = dedupe(c.fields.map((f) => ident(camel(f.key), 'java')));
    if (style === 'record') {
      const params = c.fields.map((f, i) => {
        const a = ann(f, names[i]);
        return `${ind}    ${a ? a + ' ' : ''}${t(f.type)} ${names[i]}`;
      });
      return `${ind}public record ${c.name}(\n${params.join(',\n')}\n${ind})`;
    }
    const lines: string[] = [];
    if (style === 'lombok') lines.push(`${ind}@Data`);
    lines.push(`${ind}public ${nested ? 'static ' : ''}class ${c.name} {`);
    c.fields.forEach((f, i) => {
      const a = ann(f, names[i]);
      if (a) lines.push(`${ind}    ${a}`);
      lines.push(`${ind}    private ${t(f.type)} ${names[i]};`);
    });
    if (style === 'pojo') {
      c.fields.forEach((f, i) => {
        const n = names[i];
        const N = cap(n.replace(/_$/, ''));
        const ty = t(f.type);
        lines.push('', `${ind}    public ${ty} get${N}() {`, `${ind}        return ${n};`, `${ind}    }`);
        lines.push('', `${ind}    public void set${N}(${ty} ${n}) {`, `${ind}        this.${n} = ${n};`, `${ind}    }`);
      });
    }
    return lines.join('\n');
  };
  const [root, ...rest] = classes;
  let body: string;
  if (style === 'record') {
    const nested = rest.map((c) => one(c, true) + ' {}');
    body = one(root, false) + (nested.length ? ` {\n\n${nested.join('\n\n')}\n}` : ' {}');
  } else {
    const nested = rest.map((c) => one(c, true) + '\n    }');
    body = one(root, false) + (nested.length ? '\n\n' + nested.join('\n\n') : '') + '\n}';
  }
  const imp = [...imports].sort().map((i) => `import ${i};`).join('\n');
  return (imp ? imp + '\n\n' : '') + body + '\n';
};

// ---------- Kotlin ----------
const genKotlin: Gen = (classes, o) => {
  const imports = new Set<string>();
  const kx = o.ktLib === 'kotlinx';
  if (kx) imports.add('kotlinx.serialization.Serializable');
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') {
      if (kx && (r.p === 'any' || r.p === 'big')) {
        imports.add('kotlinx.serialization.json.JsonElement');
        s = 'JsonElement';
      } else {
        if (r.p === 'big') imports.add('java.math.BigInteger');
        s = { string: 'String', int: 'Int', long: 'Long', big: 'BigInteger', float: 'Double', bool: 'Boolean', any: 'Any' }[r.p];
      }
    } else if (r.k === 'arr') s = `List<${t(r.item)}>`;
    else s = r.cls.name;
    return r.nullable ? s + '?' : s;
  };
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(camel(f.key), 'kotlin')));
    const params = c.fields.map((f, i) => {
      let ann = '';
      if (names[i] !== f.key) {
        imports.add(kx ? 'kotlinx.serialization.SerialName' : 'com.google.gson.annotations.SerializedName');
        ann = `    ${kx ? '@SerialName' : '@SerializedName'}(${kq(f.key)})\n`;
      }
      let ty = t(f.type);
      const opt = f.optional || f.type.nullable;
      if (opt && !ty.endsWith('?')) ty += '?';
      return `${ann}    val ${names[i]}: ${ty}${opt ? ' = null' : ''},`;
    });
    return `${kx ? '@Serializable\n' : ''}data class ${c.name}(\n${params.join('\n')}\n)`;
  });
  const imp = [...imports].sort().map((i) => `import ${i}`).join('\n');
  return (imp ? imp + '\n\n' : '') + out.join('\n\n') + '\n';
};

// ---------- C# ----------
const genCsharp: Gen = (classes, o) => {
  const stj = o.csLib === 'stj';
  let usesList = false;
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') s = { string: 'string', int: 'int', long: 'long', big: 'decimal', float: 'double', bool: 'bool', any: 'object' }[r.p];
    else if (r.k === 'arr') {
      usesList = true;
      s = `List<${t(r.item)}>`;
    } else s = r.cls.name;
    return r.nullable ? s + '?' : s;
  };
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => {
      const n = ident(pascal(f.key) || 'Field', 'csharp');
      return n === c.name ? n + 'Value' : n;
    }));
    const props = c.fields.map((f, i) => {
      let ty = t(f.type);
      if (f.optional && !ty.endsWith('?')) ty += '?';
      return `    [${stj ? 'JsonPropertyName' : 'JsonProperty'}(${q(f.key)})]\n    public ${ty} ${names[i]} { get; set; }`;
    });
    return `public class ${c.name}\n{\n${props.join('\n\n')}\n}`;
  });
  const usings = [usesList ? 'using System.Collections.Generic;' : '', stj ? 'using System.Text.Json.Serialization;' : 'using Newtonsoft.Json;'].filter(Boolean);
  return usings.join('\n') + '\n\n' + out.join('\n\n') + '\n';
};

// ---------- Go ----------
const genGo: Gen = (classes) => {
  let usesNumber = false;
  const t = (r: TRef): string => {
    if (r.k === 'prim') {
      if (r.p === 'big') usesNumber = true;
      const s = { string: 'string', int: 'int', long: 'int64', big: 'json.Number', float: 'float64', bool: 'bool', any: 'any' }[r.p];
      return r.nullable && r.p !== 'any' ? '*' + s : s;
    }
    if (r.k === 'arr') return `[]${t(r.item)}`;
    return r.nullable ? '*' + r.cls.name : r.cls.name;
  };
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(goName(f.key) || 'Field', 'go')));
    const rows = c.fields.map((f, i) => [names[i], t(f.type), `\`json:${q(f.key + (f.optional ? ',omitempty' : ''))}\``]);
    const w0 = Math.max(0, ...rows.map((r) => r[0].length));
    const w1 = Math.max(0, ...rows.map((r) => r[1].length));
    const body = rows.map((r) => `\t${r[0].padEnd(w0)} ${r[1].padEnd(w1)} ${r[2]}`).join('\n');
    return `type ${c.name} struct {\n${body}\n}`;
  });
  return `package model\n\n${usesNumber ? 'import "encoding/json"\n\n' : ''}${out.join('\n\n')}\n`;
};

// ---------- Python ----------
const genPython: Gen = (classes, o) => {
  const typing = new Set<string>();
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') {
      if (r.p === 'any') typing.add('Any');
      s = { string: 'str', int: 'int', long: 'int', big: 'int', float: 'float', bool: 'bool', any: 'Any' }[r.p];
    } else if (r.k === 'arr') s = `list[${t(r.item)}]`;
    else s = r.cls.name;
    if (r.nullable && s !== 'Any') {
      typing.add('Optional');
      s = `Optional[${s}]`;
    }
    return s;
  };
  const optT = (f: Field) => {
    const s = t(f.type);
    if (s.startsWith('Optional[') || s === 'Any') return s;
    typing.add('Optional');
    return `Optional[${s}]`;
  };
  const style = o.pyStyle;
  const ordered = [...classes].reverse(); // 被引用的类先定义
  let needConfig = false;
  const blocks = ordered.map((c) => {
    if (style === 'typeddict') {
      typing.add('TypedDict');
      const anyBad = c.fields.some((f) => !isIdent(f.key) || RESERVED.python!.has(f.key));
      const ty = (f: Field) => {
        if (!f.optional) return t(f.type);
        typing.add('NotRequired');
        return `NotRequired[${t(f.type)}]`;
      };
      if (anyBad) return `${c.name} = TypedDict(${q(c.name)}, {\n${c.fields.map((f) => `    ${q(f.key)}: ${ty(f)},`).join('\n')}\n})`;
      return `class ${c.name}(TypedDict):\n${c.fields.map((f) => `    ${f.key}: ${ty(f)}`).join('\n') || '    pass'}`;
    }
    const names = dedupe(c.fields.map((f) => (style === 'dataclass' && isIdent(f.key) && !RESERVED.python!.has(f.key) ? f.key : ident(snake(f.key), 'python'))));
    const req: string[] = [];
    const opt: string[] = [];
    let aliased = false;
    c.fields.forEach((f, i) => {
      const n = names[i];
      const isOpt = f.optional || f.type.nullable;
      const ty = isOpt ? optT(f) : t(f.type);
      const differs = n !== f.key;
      if (style === 'pydantic') {
        if (differs) aliased = true;
        const field = differs ? (isOpt ? ` = Field(default=None, alias=${q(f.key)})` : ` = Field(alias=${q(f.key)})`) : isOpt ? ' = None' : '';
        (isOpt ? opt : req).push(`    ${n}: ${ty}${field}`);
      } else {
        const note = differs ? `  # JSON 字段名：${q(f.key)}` : '';
        (isOpt ? opt : req).push(`    ${n}: ${ty}${isOpt ? ' = None' : ''}${note}`);
      }
    });
    const lines = [...req, ...opt];
    if (style === 'pydantic') {
      if (aliased) needConfig = true;
      const cfg = aliased ? '    model_config = ConfigDict(populate_by_name=True)\n\n' : '';
      return `class ${c.name}(BaseModel):\n${cfg}${lines.join('\n') || '    pass'}`;
    }
    return `@dataclass\nclass ${c.name}:\n${lines.join('\n') || '    pass'}`;
  });
  const sections: string[] = ['from __future__ import annotations'];
  const std: string[] = [];
  if (style === 'dataclass') std.push('from dataclasses import dataclass');
  if (typing.size) std.push(`from typing import ${[...typing].sort().join(', ')}`);
  if (std.length) sections.push(std.join('\n'));
  if (style === 'pydantic') sections.push(`from pydantic import BaseModel${needConfig ? ', ConfigDict' : ''}${/Field\(/.test(blocks.join('')) ? ', Field' : ''}`);
  const head = [sections.join('\n\n')];
  return head.join('\n') + '\n\n\n' + blocks.join('\n\n\n') + '\n';
};

// ---------- Rust ----------
const genRust: Gen = (classes) => {
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') s = { string: 'String', int: 'i64', long: 'i64', big: 'serde_json::Value', float: 'f64', bool: 'bool', any: 'serde_json::Value' }[r.p];
    else if (r.k === 'arr') s = `Vec<${t(r.item)}>`;
    else s = r.cls.name;
    return r.nullable && !s.startsWith('serde_json::Value') ? `Option<${s}>` : s;
  };
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(snake(f.key) || 'field', 'rust')));
    const fields = c.fields.map((f, i) => {
      const n = names[i];
      const lines: string[] = [];
      if (n.replace(/^r#/, '') !== f.key) lines.push(`    #[serde(rename = ${q(f.key)})]`);
      let ty = t(f.type);
      if (f.optional && !ty.startsWith('Option<')) ty = `Option<${ty}>`;
      if (f.optional) lines.push('    #[serde(default, skip_serializing_if = "Option::is_none")]');
      lines.push(`    pub ${n}: ${ty},`);
      return lines.join('\n');
    });
    return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${c.name} {\n${fields.join('\n')}\n}`;
  });
  return 'use serde::{Deserialize, Serialize};\n\n' + out.join('\n\n') + '\n';
};

// ---------- Swift ----------
const genSwift: Gen = (classes) => {
  let usesAny = false;
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') {
      if (r.p === 'any') usesAny = true;
      s = { string: 'String', int: 'Int', long: 'Int', big: 'Decimal', float: 'Double', bool: 'Bool', any: 'AnyCodable' }[r.p];
    } else if (r.k === 'arr') s = `[${t(r.item)}]`;
    else s = r.cls.name;
    return r.nullable ? s + '?' : s;
  };
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(camel(f.key) || 'field', 'swift')));
    const props = c.fields.map((f, i) => {
      let ty = t(f.type);
      if (f.optional && !ty.endsWith('?')) ty += '?';
      return `    let ${names[i]}: ${ty}`;
    });
    let s = `struct ${c.name}: Codable {\n${props.join('\n')}`;
    if (names.some((n, i) => n.replace(/`/g, '') !== c.fields[i].key)) {
      const cases = c.fields.map((f, i) => (names[i].replace(/`/g, '') === f.key ? `        case ${names[i]}` : `        case ${names[i]} = ${q(f.key)}`));
      s += `\n\n    enum CodingKeys: String, CodingKey {\n${cases.join('\n')}\n    }`;
    }
    return s + '\n}';
  });
  const note = usesAny ? '// 注意：类型不确定的字段用了 AnyCodable，需要引入 Flight-School/AnyCodable 或自行定义\n\n' : '';
  return 'import Foundation\n\n' + note + out.join('\n\n') + '\n';
};

// ---------- Dart ----------
const genDart: Gen = (classes) => {
  const t = (r: TRef): string => {
    let s: string;
    if (r.k === 'prim') s = { string: 'String', int: 'int', long: 'int', big: 'num', float: 'double', bool: 'bool', any: 'dynamic' }[r.p];
    else if (r.k === 'arr') s = `List<${t(r.item)}>`;
    else s = r.cls.name;
    return r.nullable && s !== 'dynamic' ? s + '?' : s;
  };
  /** 从 JSON 读取的表达式 */
  const from = (e: string, r: TRef, nullable: boolean): string => {
    const n = nullable || r.nullable;
    if (r.k === 'prim') {
      if (r.p === 'any') return e;
      if (r.p === 'float') return n ? `(${e} as num?)?.toDouble()` : `(${e} as num).toDouble()`;
      return `${e} as ${t({ ...r, nullable: false })}${n ? '?' : ''}`;
    }
    if (r.k === 'obj') {
      const c = `${r.cls.name}.fromJson(${e} as Map<String, dynamic>)`;
      return n ? `${e} == null ? null : ${c}` : c;
    }
    const inner = from('e', r.item, false);
    return n ? `(${e} as List<dynamic>?)?.map((e) => ${inner}).toList()` : `(${e} as List<dynamic>).map((e) => ${inner}).toList()`;
  };
  /** 写回 JSON 的表达式 */
  const to = (e: string, r: TRef, nullable: boolean): string => {
    const n = nullable || r.nullable;
    if (r.k === 'prim') return e;
    if (r.k === 'obj') return n ? `${e}?.toJson()` : `${e}.toJson()`;
    const inner = to('e', r.item, false);
    if (inner === 'e') return e;
    return n ? `${e}?.map((e) => ${inner}).toList()` : `${e}.map((e) => ${inner}).toList()`;
  };
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(camel(f.key) || 'field', 'dart')));
    const opt = (f: Field) => f.optional || f.type.nullable;
    const ty = (f: Field) => {
      const s = t(f.type);
      return opt(f) && !s.endsWith('?') && s !== 'dynamic' ? s + '?' : s;
    };
    const fields = c.fields.map((f, i) => `  final ${ty(f)} ${names[i]};`).join('\n');
    const ctor = `  ${c.name}({${c.fields.map((f, i) => (opt(f) ? `this.${names[i]}` : `required this.${names[i]}`)).join(', ')}});`;
    const fj = c.fields.map((f, i) => `        ${names[i]}: ${from(`json[${dq(f.key)}]`, f.type, opt(f))},`).join('\n');
    const tj = c.fields.map((f, i) => `        ${dq(f.key)}: ${to(names[i], f.type, opt(f))},`).join('\n');
    return `class ${c.name} {\n${fields}\n\n${ctor}\n\n  factory ${c.name}.fromJson(Map<String, dynamic> json) => ${c.name}(\n${fj}\n      );\n\n  Map<String, dynamic> toJson() => {\n${tj}\n      };\n}`;
  });
  return out.join('\n\n') + '\n';
};

// ---------- PHP ----------
const genPhp: Gen = (classes) => {
  const t = (r: TRef): string => {
    if (r.k === 'prim') return { string: 'string', int: 'int', long: 'int', big: 'int|float', float: 'float', bool: 'bool', any: 'mixed' }[r.p];
    if (r.k === 'arr') return 'array';
    return r.cls.name;
  };
  const doc = (r: TRef): string => (r.k === 'arr' ? `${doc(r.item)}[]` : t(r));
  const out = classes.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(isIdent(f.key) ? f.key : camel(f.key) || 'field', 'php')));
    const props = c.fields.map((f, i) => {
      let ty = t(f.type);
      const opt = f.optional || f.type.nullable;
      if (opt && ty !== 'mixed') ty = ty.includes('|') ? ty + '|null' : '?' + ty;
      const lines: string[] = [];
      const notes: string[] = [];
      if (f.type.k === 'arr') notes.push(`@var ${doc(f.type)}`);
      if (names[i] !== f.key) notes.push(`JSON 字段名：${f.key}`);
      if (notes.length) lines.push(`    /** ${notes.join('，')} */`);
      lines.push(`    public ${ty} $${names[i]}${opt ? ' = null' : ''};`);
      return lines.join('\n');
    });
    return `class ${c.name}\n{\n${props.join('\n')}\n}`;
  });
  return '<?php\n\ndeclare(strict_types=1);\n\n' + out.join('\n\n') + '\n';
};

// ---------- C++ ----------
const genCpp: Gen = (classes) => {
  const inc = new Set<string>(['<nlohmann/json.hpp>']);
  const t = (r: TRef, inArray = false): string => {
    if (r.k === 'prim') {
      if (r.p === 'string') inc.add('<string>');
      if (r.p === 'long') inc.add('<cstdint>');
      const s = { string: 'std::string', int: 'int', long: 'int64_t', big: 'nlohmann::json', float: 'double', bool: 'bool', any: 'nlohmann::json' }[r.p];
      return inArray && r.nullable ? 'nlohmann::json' : s;
    }
    if (r.k === 'arr') {
      inc.add('<vector>');
      return `std::vector<${t(r.item, true)}>`;
    }
    return inArray && r.nullable ? 'nlohmann::json' : r.cls.name;
  };
  const ordered = [...classes].reverse();
  const out = ordered.map((c) => {
    const names = dedupe(c.fields.map((f) => ident(isIdent(f.key) ? f.key : snake(f.key) || 'field', 'cpp')));
    const isOpt = (f: Field) => f.optional || f.type.nullable;
    const decl = c.fields.map((f, i) => {
      const ty = t(f.type);
      if (isOpt(f) && ty !== 'nlohmann::json') {
        inc.add('<optional>');
        return `    std::optional<${ty}> ${names[i]};`;
      }
      return `    ${ty} ${names[i]};`;
    });
    const fj = c.fields.map((f, i) => {
      const k = q(f.key);
      const ty = t(f.type);
      if (ty === 'nlohmann::json') return `    if (j.contains(${k})) v.${names[i]} = j.at(${k});`;
      if (isOpt(f)) return `    if (j.contains(${k}) && !j.at(${k}).is_null()) v.${names[i]} = j.at(${k}).get<${ty}>();`;
      return `    j.at(${k}).get_to(v.${names[i]});`;
    });
    const tj = c.fields.map((f, i) => {
      const k = q(f.key);
      const ty = t(f.type);
      if (isOpt(f) && ty !== 'nlohmann::json') return `    if (v.${names[i]}) j[${k}] = *v.${names[i]};`;
      return `    j[${k}] = v.${names[i]};`;
    });
    return [
      `struct ${c.name} {\n${decl.join('\n')}\n};`,
      `inline void from_json(const nlohmann::json& j, ${c.name}& v) {\n${fj.join('\n')}\n}`,
      `inline void to_json(nlohmann::json& j, const ${c.name}& v) {\n    j = nlohmann::json::object();\n${tj.join('\n')}\n}`,
    ].join('\n\n');
  });
  const order = ['<cstdint>', '<optional>', '<string>', '<vector>', '<nlohmann/json.hpp>'];
  const includes = order.filter((h) => inc.has(h)).map((h) => `#include ${h}`).join('\n');
  return `#pragma once\n\n${includes}\n\n${out.join('\n\n')}\n`;
};

const GENS: Record<Lang, Gen> = {
  ts: genTs, java: genJava, kotlin: genKotlin, csharp: genCsharp, go: genGo, python: genPython,
  rust: genRust, swift: genSwift, dart: genDart, php: genPhp, cpp: genCpp,
};

export interface CodeResult { code: string; classes: number }

export function jsonToCode(root: JNode, o: CodeOpt): CodeResult {
  const classes = build(root, o.root.trim() || 'Root');
  return { code: GENS[o.lang](classes, o), classes: classes.length };
}
