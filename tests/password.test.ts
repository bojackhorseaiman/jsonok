// 3.4a 随机密码生成的测试：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBIGUOUS, SETS, buildPools, crackTime, entropyBits, generatePassword, poolSize, strength, type PwOpt } from '../src/core/password.ts';

const base: PwOpt = { length: 16, upper: true, lower: true, digit: true, symbol: true, symbols: SETS.symbol, noAmbiguous: true, eachType: true };

test('字符池：去掉易混淆字符、空白、重复字符', () => {
  assert.equal(poolSize({ ...base, noAmbiguous: false }), 26 + 26 + 10 + SETS.symbol.length);
  assert.equal(poolSize(base), 26 + 26 + 10 + SETS.symbol.length - 6, '去掉 O I o l 0 1（| 不在默认符号里）');
  const p = buildPools({ ...base, symbols: '! @ !a|' });
  assert.deepEqual(p.map((x) => x.name), ['大写字母', '小写字母', '数字', '符号']);
  assert.deepEqual(p[3].chars, ['!', '@'], '空格、重复的 !、已在小写里的 a、易混淆的 | 都去掉');
  assert.throws(() => buildPools({ ...base, upper: false, lower: false, digit: false, symbol: false }), /请至少选择一种字符/);
  assert.throws(() => buildPools({ ...base, upper: false, lower: false, digit: false, symbols: '|' }), /“符号”里没有可用的字符，请检查符号范围/);
});

test('生成：长度、只用允许的字符、每种至少一个、排除易混淆字符', () => {
  for (let i = 0; i < 300; i++) {
    const len = 4 + (i % 40);
    const p = generatePassword({ ...base, length: len });
    assert.equal([...p].length, len);
    assert.ok(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p), p);
    assert.ok(![...p].some((ch) => AMBIGUOUS.includes(ch)), p);
  }
  const d = generatePassword({ ...base, length: 32, upper: false, lower: false, symbol: false });
  assert.match(d, /^[2-9]{32}$/);
  const s = generatePassword({ ...base, length: 20, upper: false, lower: false, digit: false, symbols: '!@' });
  assert.match(s, /^[!@]{20}$/);
  assert.throws(() => generatePassword({ ...base, length: 3 }), /长度至少要 4/);
  assert.equal(generatePassword({ ...base, length: 3, eachType: false }).length, 3);
  assert.throws(() => generatePassword({ ...base, length: 0 }), /至少是 1/);
});

test('生成：用可控的随机数，结果确定且被打乱', () => {
  // 总是取 0：每种至少一个的字符先放进去，然后打乱
  const p = generatePassword({ ...base, length: 6, noAmbiguous: false }, () => 0);
  assert.equal(p.length, 6);
  assert.deepEqual([...p].sort(), ['!', '0', 'A', 'A', 'A', 'a'].sort());
});

test('生成：各字符出现的次数大致均匀（没有取模偏差）', () => {
  const o = { ...base, length: 20000, upper: false, lower: false, symbol: false, noAmbiguous: false, eachType: false };
  const p = generatePassword(o);
  const counts = new Map<string, number>();
  for (const ch of p) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  assert.equal(counts.size, 10);
  for (const [ch, n] of counts) assert.ok(n > 1700 && n < 2300, `${ch} 出现了 ${n} 次`);
});

test('强度：熵、等级、破解时间', () => {
  assert.equal(entropyBits(10, 1), 0);
  assert.equal(Math.round(entropyBits(16, 62)), 95);
  assert.deepEqual([20, 30, 50, 90, 200].map((b) => strength(b).label), ['很弱', '弱', '一般', '强', '很强']);
  assert.equal(crackTime(10), '不到 1 秒');
  assert.equal(crackTime(entropyBits(8, 26)), '1 秒');
  assert.equal(crackTime(48), '23 分钟');
  assert.equal(crackTime(64), '3 年');
  assert.equal(crackTime(80), '19 万年');
  assert.equal(crackTime(128), '超过 1 亿年');
  assert.equal(crackTime(entropyBits(128, 94)), '超过 1 亿年', '最长的密码也不会溢出');
});
