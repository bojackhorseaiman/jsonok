// 3.4e htpasswd 的测试：APR1 / MD5-crypt 标准值来自 openssl passwd
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apr1, htHash, htVerify, md5crypt, parseAccounts, parseHtpasswd, randomSalt, shaHash } from '../src/core/htpasswd.ts';

test('APR1 / MD5-crypt：和 openssl passwd 一致', () => {
  assert.equal(apr1('password', 'abcdefgh'), '$apr1$abcdefgh$FBwExRW4dCc8aL.OvjpIE1');
  assert.equal(apr1('kuaijson@2026', 'kuaijson'), '$apr1$kuaijson$gDpVRrmPPxkoibpDa9IEu0');
  assert.equal(apr1('快JSON密码', 'Zx.9/ab'), '$apr1$Zx.9/ab$8FlH3D.PdNRoEOXxfG8.A/', '中文密码、7 位盐');
  assert.equal(md5crypt('password', 'saltsalt', '$1$'), '$1$saltsalt$qjXMvbEw8oaL.CzflDtaK/');
  assert.equal(apr1('', 'abc'), '$apr1$abc$BfqKdn9xFDWJPa3kcp/PH0', '空密码');
  assert.equal(apr1('a'.repeat(40) + '中文', 'r4nd0m/.'), '$apr1$r4nd0m/.$CKB58AXrWR3IgGRAQn3dK0', '超过 16 字节的长密码');
  assert.equal(apr1('password', 'abcdefghXYZ'), '$apr1$abcdefgh$FBwExRW4dCc8aL.OvjpIE1', '盐只取前 8 位');
});

test('SHA-1 和随机盐', async () => {
  assert.equal(shaHash('password'), '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=');
  assert.equal(shaHash('kuaijson@2026'), '{SHA}EvYduSeb2aF2Mav/G9bWJRR5kJs=');
  const s = randomSalt();
  assert.match(s, /^[./0-9A-Za-z]{8}$/);
  assert.notEqual(randomSalt(), s);
  assert.match(apr1('x'), /^\$apr1\$[./0-9A-Za-z]{8}\$[./0-9A-Za-z]{22}$/);
  assert.match(await htHash('x', 'bcrypt', 4), /^\$2y\$04\$.{53}$/);
  assert.match(await htHash('x', 'sha1'), /^\{SHA\}/);
});

test('验证：各种格式', async () => {
  const ok = async (pw: string, h: string) => (await htVerify(pw, h)).ok;
  assert.equal(await ok('kuaijson@2026', '$apr1$kuaijson$gDpVRrmPPxkoibpDa9IEu0'), true);
  assert.equal(await ok('kuaijson@2027', '$apr1$kuaijson$gDpVRrmPPxkoibpDa9IEu0'), false);
  assert.equal(await ok('password', '$1$saltsalt$qjXMvbEw8oaL.CzflDtaK/'), true);
  assert.equal((await htVerify('password', '$1$saltsalt$qjXMvbEw8oaL.CzflDtaK/')).label, 'MD5-crypt（$1$）');
  assert.equal(await ok('password', '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g='), true);
  assert.equal(await ok('kuaijson@2026', '{SSHA}jUVooSMAt6pLlQQfwxsnin3Bj/8BAgME'), true, 'Python 算出的 {SSHA}');
  assert.equal(await ok('kuaijson@2025', '{SSHA}jUVooSMAt6pLlQQfwxsnin3Bj/8BAgME'), false);
  assert.equal(await ok('abc', '{PLAIN}abc'), true);
  assert.equal(await ok('rasmuslerdorf', '$2y$07$BCryptRequires22Chrcte/VlQH0piJtjXl.0t1XkA8pw9dMXTpOq'), true);
  const b = await htHash('快JSON密码', 'bcrypt', 4);
  assert.equal(await ok('快JSON密码', b), true);
  await assert.rejects(htVerify('x', '$apr1$abc$short'), /格式不对/);
  await assert.rejects(htVerify('x', '$6$salt$abcdef'), /SHA-512 crypt/);
  await assert.rejects(htVerify('x', 'rl.3StKT.4T8M'), /crypt（DES）/);
  await assert.rejects(htVerify('x', 'hello world'), /无法识别哈希格式/);
});

test('读取账号：用户名:密码', () => {
  const r = parseAccounts('admin:a:b:c\r\n\n alice :Alice#2026\nbob:\nadmin:dup');
  assert.deepEqual(r.list.map((x) => [x.user, x.pw, x.line]), [['admin', 'a:b:c', 1], ['alice', 'Alice#2026', 3], ['bob', '', 4], ['admin', 'dup', 5]]);
  assert.deepEqual(r.warns, ['bob 的密码是空的', '用户名 admin 在第 1 行和第 5 行重复，服务器只认第一个']);
  assert.throws(() => parseAccounts('admin'), /第 1 行缺少冒号/);
  assert.throws(() => parseAccounts('a:1\n:pw'), /第 2 行没有用户名/);
  assert.throws(() => parseAccounts('my user:pw'), /有空格/);
  assert.throws(() => parseAccounts('\n  \n'), /请输入账号/);
});

test('读取 htpasswd 文件：注释、空行、只有哈希', () => {
  const e = parseHtpasswd('# 注释\n\nadmin:$apr1$kuaijson$gDpVRrmPPxkoibpDa9IEu0\r\nguest:{SHA}abc=:备注\n$2y$10$xyz');
  assert.deepEqual(e, [
    { user: 'admin', hash: '$apr1$kuaijson$gDpVRrmPPxkoibpDa9IEu0', line: 3 },
    { user: 'guest', hash: '{SHA}abc=', line: 4 },
    { user: '', hash: '$2y$10$xyz', line: 5 },
  ]);
});
