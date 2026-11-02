/**
 * 测试数据生成：按 JSON 模板生成随机数据（写法参考 Mock.js，做了简化）。
 *
 *   "users|5": [{...}]      生成 5 个元素的数组；"users|2-8" 随机 2~8 个
 *   "tag|1": ["a","b","c"]  从数组里随机选一个
 *   "age|18-60": 0          18~60 的随机整数
 *   "id|+1": 1000           每生成一次加 1（1000、1001、1002…）
 *   "@name" "@email" "@int(1,100)" …  占位符，整段是占位符时返回对应类型的值；也可以嵌在文字里："用户@id"
 */
import type { JNode, JObj } from './json.ts';

/** 可复现的随机数（mulberry32） */
export function makeRandom(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const GIVEN = '伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超秀兰霞平刚桂英文华辉鑫宇浩然梓涵欣怡子轩一诺雨萱思远晨阳嘉怡俊杰佳琪博文天佑雅婷宇航';
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '重庆', '天津', '苏州', '青岛', '长沙', '郑州', '厦门', '宁波', '济南', '合肥', '大连'];
const PROVINCES = ['北京市', '上海市', '广东省', '浙江省', '江苏省', '四川省', '湖北省', '陕西省', '重庆市', '天津市', '山东省', '湖南省', '河南省', '福建省', '安徽省', '辽宁省'];
const STREETS = ['人民路', '解放路', '中山路', '建设路', '和平路', '长江路', '黄河路', '幸福路', '朝阳路', '文化路'];
const EN_FIRST = ['James', 'Mary', 'John', 'Linda', 'Robert', 'Emma', 'Michael', 'Olivia', 'David', 'Sophia', 'William', 'Ava', 'Daniel', 'Mia', 'Lucas', 'Grace'];
const EN_LAST = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Miller', 'Wilson', 'Moore', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Green', 'Baker'];
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud'.split(' ');
const CN_CHARS = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理府研质';
const DOMAINS = ['example.com', 'test.com', 'demo.cn', 'mail.com', 'kuaijson.com'];
const TLD = ['com', 'cn', 'net', 'org', 'io'];

export interface MockCtx {
  rnd: () => number;
  /** @id / @increment 的计数器 */
  seq: number;
  /** "key|+1" 的计数器，按模板位置区分 */
  inc: Map<string, number>;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function placeholders(ctx: MockCtx) {
  const r = ctx.rnd;
  const int = (min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const chars = (set: string, n: number) => Array.from({ length: n }, () => pick([...set])).join('');
  const date = () => new Date(Date.UTC(int(2015, 2026), int(0, 11), int(1, 28), int(0, 23), int(0, 59), int(0, 59)));
  const fmtDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const fmtTime = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const hex = (n: number) => chars('0123456789abcdef', n);
  const ename = () => `${pick(EN_FIRST)} ${pick(EN_LAST)}`;
  const word = (min = 3, max = 10) => chars('abcdefghijklmnopqrstuvwxyz', int(min, max));
  const csentence = (min = 8, max = 20) => chars(CN_CHARS, int(min, max)) + '。';

  // 返回值：number / boolean / string
  const P: Record<string, (args: string[]) => number | boolean | string> = {
    id: () => ++ctx.seq,
    increment: () => ++ctx.seq,
    int: ([a = '0', b = '1000']) => int(Number(a), Number(b)),
    integer: ([a = '0', b = '1000']) => int(Number(a), Number(b)),
    float: ([a = '0', b = '1000', d = '2']) => Number((r() * (Number(b) - Number(a)) + Number(a)).toFixed(Number(d))),
    bool: () => r() < 0.5,
    boolean: () => r() < 0.5,
    pick: (args) => {
      const v = pick(args.length ? args : ['']);
      return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    },
    string: ([n]) => (n ? chars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', Number(n)) : word(6, 12)),
    word: ([a, b]) => word(a ? Number(a) : 3, b ? Number(b) : a ? Number(a) : 10),
    cword: ([a, b]) => chars(CN_CHARS, int(a ? Number(a) : 1, b ? Number(b) : a ? Number(a) : 4)),
    sentence: () => {
      const s = Array.from({ length: int(6, 14) }, () => pick(WORDS)).join(' ');
      return s[0].toUpperCase() + s.slice(1) + '.';
    },
    csentence: ([a, b]) => csentence(a ? Number(a) : 8, b ? Number(b) : a ? Number(a) : 20),
    title: () => chars(CN_CHARS, int(4, 10)),
    name: () => pick([...SURNAMES]) + chars(GIVEN, int(1, 2)),
    ename: () => ename(),
    phone: () => '1' + pick(['3', '5', '7', '8', '9']) + chars('0123456789', 9),
    email: () => `${word(4, 10)}${int(1, 999)}@${pick(DOMAINS)}`,
    domain: () => `${word(4, 10)}.${pick(TLD)}`,
    url: () => `https://www.${word(4, 10)}.${pick(TLD)}/${word(3, 8)}`,
    ip: () => `${int(1, 223)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`,
    guid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`,
    date: () => fmtDate(date()),
    time: () => fmtTime(date()),
    datetime: () => {
      const d = date();
      return `${fmtDate(d)} ${fmtTime(d)}`;
    },
    timestamp: () => date().getTime(),
    now: () => {
      const d = new Date();
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },
    city: () => pick(CITIES),
    province: () => pick(PROVINCES),
    address: () => `${pick(PROVINCES)}${pick(CITIES)}市${pick(STREETS)}${int(1, 999)}号`,
    zip: () => chars('0123456789', 6),
    color: () => '#' + hex(6),
    image: ([size = '200x100']) => `https://dummyimage.com/${/^\d+x\d+$/.test(size) ? size : '200x100'}`,
  };
  return P;
}

const PH = /@([a-z]+)(?:\(([^)]*)\))?/g;

function fillString(s: string, P: ReturnType<typeof placeholders>): JNode {
  const whole = /^@([a-z]+)(?:\(([^)]*)\))?$/.exec(s);
  const call = (name: string, args: string | undefined) => {
    const f = P[name];
    if (!f) return undefined;
    const list = args === undefined || args.trim() === '' ? [] : args.split(',').map((x) => x.trim());
    return f(list);
  };
  if (whole) {
    const v = call(whole[1], whole[2]);
    if (v === undefined) return { t: 's', v: s };
    if (typeof v === 'number') return { t: 'n', raw: String(v) };
    if (typeof v === 'boolean') return { t: 'b', v };
    return { t: 's', v };
  }
  return {
    t: 's',
    v: s.replace(PH, (m, name: string, args: string | undefined) => {
      const v = call(name, args);
      return v === undefined ? m : String(v);
    }),
  };
}

function gen(nd: JNode, ctx: MockCtx, P: ReturnType<typeof placeholders>, path: string): JNode {
  const int = (min: number, max: number) => Math.floor(ctx.rnd() * (max - min + 1)) + min;
  if (nd.t === 's') return fillString(nd.v, P);
  if (nd.t === 'a') return { t: 'a', items: nd.items.map((v, i) => gen(v, ctx, P, `${path}[${i}]`)) };
  if (nd.t !== 'o') return nd;
  const items: [string, JNode][] = [];
  for (const [rawKey, v] of nd.items) {
    const m = /^(.*)\|(\+\d+|\d+(?:-\d+)?)$/.exec(rawKey);
    if (!m) {
      items.push([rawKey, gen(v, ctx, P, `${path}.${rawKey}`)]);
      continue;
    }
    const [, key, rule] = m;
    const p = `${path}.${key}`;
    if (rule.startsWith('+')) {
      // 自增：第一次取模板里的值，之后每次加步长
      const step = Number(rule.slice(1));
      const start = v.t === 'n' ? Number(v.raw) : 1;
      const cur = ctx.inc.has(p) ? ctx.inc.get(p)! + step : start;
      ctx.inc.set(p, cur);
      items.push([key, { t: 'n', raw: String(cur) }]);
      continue;
    }
    const [a, b] = rule.split('-').map(Number);
    const count = b === undefined ? a : int(Math.min(a, b), Math.max(a, b));
    if (v.t === 'a') {
      if (!v.items.length) { items.push([key, { t: 'a', items: [] }]); continue; }
      if (b === undefined && a === 1) {
        // "key|1": [...] 随机选一个
        items.push([key, gen(v.items[Math.floor(ctx.rnd() * v.items.length)], ctx, P, p)]);
        continue;
      }
      const out: JNode[] = [];
      for (let i = 0; i < count; i++) out.push(gen(v.items[i % v.items.length], ctx, P, p));
      items.push([key, { t: 'a', items: out }]);
      continue;
    }
    if (v.t === 'n') { items.push([key, { t: 'n', raw: String(count) }]); continue; }
    if (v.t === 's') { items.push([key, { t: 's', v: Array.from({ length: count }, () => fillString(v.v, P)).map((x) => (x.t === 's' ? x.v : '')).join('') }]); continue; }
    if (v.t === 'b') { items.push([key, { t: 'b', v: ctx.rnd() < 0.5 }]); continue; }
    if (v.t === 'o') {
      // "key|2": {...} 从对象里随机取 2 个字段
      const keys = [...v.items].sort(() => ctx.rnd() - 0.5).slice(0, count);
      items.push([key, gen({ t: 'o', items: keys } as JObj, ctx, P, p)]);
      continue;
    }
    items.push([key, v]);
  }
  return { t: 'o', items };
}

export function mockData(template: JNode, count: number, seed?: number): JNode {
  const ctx: MockCtx = { rnd: makeRandom(seed), seq: 0, inc: new Map() };
  const P = placeholders(ctx);
  const n = Math.max(1, Math.min(1000, Math.floor(count) || 1));
  if (n === 1) return gen(template, ctx, P, '$');
  return { t: 'a', items: Array.from({ length: n }, () => gen(template, ctx, P, '$')) };
}
