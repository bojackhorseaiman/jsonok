// 3.4c Bcrypt / Scrypt 的测试：OpenBSD / PHP 手册的 Bcrypt 示例、RFC 7914 和 passlib 的 Scrypt 示例
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BCRYPT_RE, bcryptHash, bcryptOverLimit, bcryptVerify, checkScryptParams, parseBcrypt, parseScryptPhc,
  readKey, sameBytes, scryptDerive, scryptMemory, scryptPhc,
} from '../src/core/kdf.ts';
import { fromBase64, toHex, utf8Bytes } from '../src/core/bytes.ts';

test('Bcrypt：标准测试向量（指定盐时结果固定）', async () => {
  assert.equal(await bcryptHash('U*U', { cost: 5, prefix: '2a', salt: '$2a$05$CCCCCCCCCCCCCCCCCCCCC.' }), '$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW');
  assert.equal(await bcryptHash('', { cost: 6, prefix: '2a', salt: '$2a$06$DCq7YPn5Rq63x1Lad4cll.' }), '$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.');
});

test('Bcrypt：生成、前缀、每次结果不同、验证、进度', async () => {
  const progress: number[] = [];
  const a = await bcryptHash('快JSON 密码', { cost: 4, prefix: '2y', onProgress: (f) => progress.push(f) });
  const b = await bcryptHash('快JSON 密码', { cost: 4, prefix: '2b' });
  assert.match(a, /^\$2y\$04\$/);
  assert.match(b, /^\$2b\$04\$/);
  assert.ok(BCRYPT_RE.test(a) && a.length === 60);
  assert.notEqual(a.slice(7), b.slice(7), '随机盐，结果不同');
  assert.ok(progress.length > 0 && progress.at(-1)! <= 1);
  for (const h of [a, b, a.replace('$2y$', '$2a$')]) {
    assert.equal((await bcryptVerify('快JSON 密码', h)).ok, true, h);
    assert.equal((await bcryptVerify('快JSON 密码 ', h)).ok, false);
  }
  assert.deepEqual((await bcryptVerify('快JSON 密码', a)).info, { prefix: '$2y$', cost: 4, salt: a.slice(7, 29) });
  await assert.rejects(bcryptHash('x', { cost: 3, prefix: '2b' }), /强度应该是 4 ~ 31/);
});

test('Bcrypt：PHP 手册里 password_verify 的示例', async () => {
  assert.equal((await bcryptVerify('rasmuslerdorf', '$2y$07$BCryptRequires22Chrcte/VlQH0piJtjXl.0t1XkA8pw9dMXTpOq')).ok, true);
  assert.equal((await bcryptVerify('rasmuslerdorf2', '$2y$07$BCryptRequires22Chrcte/VlQH0piJtjXl.0t1XkA8pw9dMXTpOq')).ok, false);
});

test('Bcrypt：哈希格式错误时给出中文原因；72 字节限制', async () => {
  assert.throws(() => parseBcrypt('$2y$10$abc'), /长度应该是 60 个字符，现在是 10 个/);
  assert.throws(() => parseBcrypt('5f4dcc3b5aa765d61d8327deb882cf99'), /不是 Bcrypt 哈希/);
  assert.throws(() => parseBcrypt('$2x$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW'), /\$2x\$ 是早期有缺陷/);
  assert.equal(bcryptOverLimit('a'.repeat(72)), 0);
  assert.equal(bcryptOverLimit('a'.repeat(70) + '中'), 1, '汉字占 3 个字节');
  const h = await bcryptHash('a'.repeat(72) + 'xyz', { cost: 4, prefix: '2b' });
  assert.equal((await bcryptVerify('a'.repeat(72) + 'abc', h)).ok, true, '超过 72 字节的部分不起作用');
});

test('Scrypt：RFC 7914 测试向量、和 Python hashlib 一致', async () => {
  const k1 = await scryptDerive(utf8Bytes('password'), utf8Bytes('NaCl'), { ln: 10, r: 8, p: 16, dkLen: 64 });
  assert.equal(toHex(k1), 'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640');
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
  const k2 = await scryptDerive(utf8Bytes('快JSON密码'), salt, { ln: 14, r: 8, p: 1, dkLen: 32 });
  assert.equal(toHex(k2), '5304ff7c6c1ec3afe8c98738c0276198b7285f2917407914122b2eed4a20f9cc');
  assert.equal(scryptPhc({ ln: 14, r: 8, p: 1, dkLen: 32 }, salt, k2), '$scrypt$ln=14,r=8,p=1$AAECAwQFBgcICQoLDA0ODw$UwT/fGwew6/oyYc4wCdhmLcoXykXQHkUEisu7Uog+cw');
  const k3 = await scryptDerive(utf8Bytes('kuaijson'), utf8Bytes('kuaijson-salt'), { ln: 10, r: 4, p: 2, dkLen: 16 });
  assert.equal(toHex(k3), '5a051fba327b670621e842e8e5d88744');
});

test('Scrypt：PHC 字符串（passlib 文档示例）、进度、取消、参数检查', async () => {
  const x = parseScryptPhc('$scrypt$ln=16,r=8,p=1$aM15713r3Xsvxbi31lqr1Q$nFNh2CVHVjNldFVKDHDlm4CbdRSCdEBsjjJxD+iCs5E');
  assert.deepEqual(x.prm, { ln: 16, r: 8, p: 1, dkLen: 32 });
  const key = await scryptDerive(utf8Bytes('password'), x.salt, x.prm);
  assert.ok(sameBytes(key, x.key), 'passlib 文档里的 scrypt.hash("password")');
  assert.deepEqual([...parseScryptPhc('$scrypt$ln=1,r=1,p=1$a.b/$AA').salt], [...fromBase64('a+b/').bytes], 'passlib 用 . 代替 +');
  assert.throws(() => parseScryptPhc('$scrypt$n=16$abc$def'), /不是 Scrypt 的标准字符串/);
  const steps: number[] = [];
  await scryptDerive(utf8Bytes('x'), utf8Bytes('s'), { ln: 12, r: 8, p: 1, dkLen: 32 }, { onProgress: (f) => steps.push(f) });
  assert.ok(steps.length > 0);
  await assert.rejects(scryptDerive(utf8Bytes('x'), utf8Bytes('s'), { ln: 14, r: 8, p: 1, dkLen: 32 }, { stale: () => true }), /已取消/);
  assert.equal(scryptMemory({ ln: 14, r: 8 }), 16 * 1024 * 1024);
  assert.throws(() => checkScryptParams({ ln: 20, r: 8, p: 1, dkLen: 32 }), /需要约 1024 MB 内存/);
  assert.throws(() => checkScryptParams({ ln: 14, r: 0, p: 1, dkLen: 32 }), /r（块大小）应该是 1 ~ 32/);
});

test('辅助函数：读取密钥、比较', () => {
  assert.deepEqual([...readKey('0a0b')], [10, 11]);
  assert.deepEqual([...readKey('CgsM')], [10, 11, 12]);
  assert.ok(sameBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 2])));
  assert.ok(!sameBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 3])));
  assert.ok(!sameBytes(Uint8Array.from([1]), Uint8Array.from([1, 2])));
});
