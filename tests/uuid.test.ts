// 3.4b UUID 的测试：标准值来自 Python uuid 模块和 RFC 9562 示例
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMESPACES, formatUuid, inspectUuid, uuidBytes, v3, v4, v5, v7Generator } from '../src/core/uuid.ts';
import { utf8Bytes } from '../src/core/bytes.ts';

const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{12}$/;
const dns = uuidBytes(NAMESPACES.dns);

test('v4：格式、版本号、变体、不重复', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const s = formatUuid(v4());
    const m = RE.exec(s);
    assert.ok(m, s);
    assert.equal(m[1], '4');
    assert.ok('89ab'.includes(m[2]), s);
    seen.add(s);
  }
  assert.equal(seen.size, 2000);
  assert.match(crypto.randomUUID(), RE, '和浏览器自带的 randomUUID 格式一致');
});

test('v3 / v5：和 Python uuid 模块的结果一致', () => {
  const name = (s: string) => utf8Bytes(s);
  assert.equal(formatUuid(v5(dns, name('www.example.com'))), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  assert.equal(formatUuid(v5(dns, name('www.kuaijson.com'))), "e081bf5b-7fc9-50e9-af0e-759b6744ec53");
  assert.equal(formatUuid(v3(dns, name('www.example.com'))), "5df41881-3aed-3515-88a7-2f4a814cf09e");
  assert.equal(formatUuid(v3(dns, name('www.kuaijson.com'))), "5c76ac6b-b011-32db-9d2a-32fa3144aa73");
  assert.equal(formatUuid(v5(uuidBytes(NAMESPACES.url), name('https://www.kuaijson.com/快'))), "316ebd40-8e04-5648-a035-a11393315f4b");
  assert.equal(formatUuid(v5(uuidBytes('550e8400-e29b-41d4-a716-446655440000'), name('订单-10001'))), "2cdb07f3-ec8f-5211-8b17-44abca025ba1");
});

test('v7：时间戳、同一毫秒内严格递增、计数器用完借用下一毫秒、时间回拨', () => {
  const t = 1_762_000_000_123;
  let now = t;
  const gen = v7Generator(() => now);
  const list = Array.from({ length: 50 }, () => formatUuid(gen()));
  assert.deepEqual([...list].sort(), list, '同一毫秒内也要递增');
  assert.equal(new Set(list).size, 50);
  for (const s of list) {
    assert.equal(RE.exec(s)?.[1], '7', s);
    assert.equal(inspectUuid(s).time?.getTime(), t);
  }
  // 计数器用完：时间戳往后借 1 毫秒
  const zeros = (n: number) => new Uint8Array(n);
  const g2 = v7Generator(() => t, zeros);
  const first = g2();
  assert.equal((first[6] & 0x0f) * 256 + first[7], 0);
  let last = first;
  for (let i = 0; i < 0x1000; i++) last = g2();
  assert.equal(inspectUuid(formatUuid(last)).time?.getTime(), t + 1);
  // 系统时间往回调：仍然递增
  now = t + 10;
  const a = formatUuid(gen());
  now = t + 5;
  const b = formatUuid(gen());
  assert.ok(b > a, `${a} < ${b}`);
});

test('格式：大写、去横线、大括号', () => {
  const b = uuidBytes('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(formatUuid(b, { upper: true, hyphen: true, braces: false }), '550E8400-E29B-41D4-A716-446655440000');
  assert.equal(formatUuid(b, { upper: false, hyphen: false, braces: false }), '550e8400e29b41d4a716446655440000');
  assert.equal(formatUuid(b, { upper: true, hyphen: true, braces: true }), '{550E8400-E29B-41D4-A716-446655440000}');
});

test('读取：各种写法都能识别，错误给出中文原因', () => {
  const want = '550e8400-e29b-41d4-a716-446655440000';
  for (const s of [want, want.toUpperCase(), '{' + want + '}', '(' + want + ')', 'urn:uuid:' + want, 'URN:UUID:' + want, want.replace(/-/g, ''), '  ' + want + '  ']) {
    assert.equal(formatUuid(uuidBytes(s)), want, s);
  }
  assert.throws(() => uuidBytes('550e8400-e29b-41d4-a716-44665544000g'), /包含字符 "g"/);
  assert.throws(() => uuidBytes('550e8400e29b-41d4-a716-446655440000-'), /横线的位置不对/);
  assert.throws(() => uuidBytes('550e8400-e29b-41d4'), /应该是 32 位十六进制，现在是 16 位/);
});

test('解析：RFC 9562 的 v1 / v6 / v7 示例时间一致；Nil / Max / 微软变体', () => {
  const v1 = inspectUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846');
  assert.equal(v1.version, 1);
  assert.equal(v1.time?.getTime(), 1645557742000);
  assert.ok(v1.notes.includes('时钟序列 13256'), v1.notes.join(','));
  assert.ok(v1.notes.some((n) => n.includes('9f:6b:de:ce:d8:46（随机生成')), v1.notes.join(','));
  const v6 = inspectUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846');
  assert.equal(v6.version, 6);
  assert.equal(v6.time?.getTime(), 1645557742000);
  const v7 = inspectUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
  assert.equal(v7.label, 'v7（时间戳 + 随机，可排序）');
  assert.equal(v7.time?.getTime(), 1645557742000);
  assert.equal(v7.canonical, '017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  assert.equal(inspectUuid("2ed6657d-e927-568b-95e1-2665a8aea6a2").label, 'v5（名字 + SHA-1）');
  assert.equal(inspectUuid('550e8400-e29b-41d4-a716-446655440000').time, undefined);
  assert.equal(inspectUuid('00000000-0000-0000-0000-000000000000').label, 'Nil（全 0）');
  assert.equal(inspectUuid('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF').label, 'Max（全 F）');
  const ms = inspectUuid('00000000-0000-0000-c000-000000000046');
  assert.equal(ms.variant, '微软 GUID（旧格式）');
  assert.equal(ms.label, '非标准');
  const mac = inspectUuid('c232ab00-9414-11ec-b3c8-0a6bdeced846');
  assert.ok(mac.notes.includes('MAC 地址 0a:6b:de:ce:d8:46'), mac.notes.join(','));
});
