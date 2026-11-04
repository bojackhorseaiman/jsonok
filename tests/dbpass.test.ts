// 3.4d 数据库密码的测试：标准值由 Python hashlib 按定义计算（MySQL 的 password 是公开的著名值）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDbHash, formatScram, mysqlNative, parseScram, pgMd5, pgScram, saslPrep, sqlFor, verifyDb } from '../src/core/dbpass.ts';

const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);

test('MySQL / MariaDB：mysql_native_password', () => {
  assert.equal(mysqlNative('password'), '*2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19');
  assert.equal(mysqlNative('kuaijson@2026'), '*3E2163B15FC19FC771A154C0BFE1261C1B915E38');
  assert.equal(mysqlNative('快JSON密码'), '*94B50724950484A1117F455F42E01123408F3BF1');
});

test('PostgreSQL md5：密码 + 用户名', () => {
  assert.equal(pgMd5('password', 'postgres'), 'md532e12f215ba27cb750c9e093ce4b5127');
  assert.equal(pgMd5('kuaijson@2026', 'kuaijson'), 'md56b98d1b335dcc7d8b26e542ea436d736');
  assert.equal(pgMd5('快JSON密码', 'kj_user'), 'md557f83b421d52c688a293fe172d975b15');
});

test('PostgreSQL SCRAM-SHA-256：固定盐时和 Python 一致', async () => {
  assert.equal(await pgScram('password', 4096, SALT), 'SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$4PSH04DiBM59z6mw0gs6x1r6+duXYQ+R0KwGZr+W5/o=:IgPInY95tTazYxnARISZb/eTxuX/JRwWgrM9ByaOUIk=');
  assert.equal(await pgScram('快JSON密码', 4096, SALT), 'SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$jomFQC/gAYIPmc/+qy5vjccg2rY6DF73OXAdgoA/hf8=:xa0jckKarxXfr3z2kqGoX+4mrVIVcx8GCaNIsFgoo8M=');
  const s = new TextEncoder().encode('kuaijson-salt');
  assert.equal(await pgScram('pencil', 4096, s), 'SCRAM-SHA-256$4096:a3VhaWpzb24tc2FsdA==$fV3JyJQqkfhz1kU1I1yym/q258n8GOdwgDHdGx6nRpE=:Pvk9H5PNGOeUiE7rQMNYCnRgAw5Wo6zkt6CfanvGS2A=');
  const a = await pgScram('password');
  const b = await pgScram('password');
  assert.notEqual(a, b, '随机盐');
  assert.equal(parseScram(a).salt.length, 16);
  assert.equal(formatScram(parseScram(a)), a);
  await assert.rejects(pgScram('x', 0), /迭代次数应该是 1 ~ 10000000/);
});

test('SASLprep：全角转半角、特殊空格、不可见字符、控制字符', async () => {
  assert.deepEqual(saslPrep('ＡＢＣ'), { text: 'ABC', changed: true, raw: false });
  assert.deepEqual(saslPrep('a\u00A0b\u3000c'), { text: 'a b c', changed: true, raw: false });
  assert.deepEqual(saslPrep('a\u200Bb\u00ADc'), { text: 'abc', changed: true, raw: false });
  assert.deepEqual(saslPrep('快JSON密码'), { text: '快JSON密码', changed: false, raw: false });
  assert.deepEqual(saslPrep('a\tb'), { text: 'a\tb', changed: false, raw: true });
  assert.equal(await pgScram('ｐａｓｓｗｏｒｄ', 4096, SALT), await pgScram('password', 4096, SALT));
});

test('识别哈希格式，错误给出中文原因', () => {
  assert.equal(detectDbHash('*2470c0c06dee42fd1618bb99005adca2ec9d1e19').norm, '*2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19');
  assert.equal(detectDbHash("'*2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19'").kind, 'mysql', '带引号也能认');
  assert.match(detectDbHash('2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19').note ?? '', /没有开头的 \*/);
  assert.equal(detectDbHash('md532e12f215ba27cb750c9e093ce4b5127').kind, 'pg-md5');
  assert.equal(detectDbHash(' SCRAM-SHA-256$4096:AA==$AA==:AA== ').kind, 'pg-scram');
  assert.throws(() => detectDbHash('*2470C0C06DEE'), /共 41 个字符，现在是 13 个/);
  assert.throws(() => detectDbHash('565491d704013245'), /OLD_PASSWORD/);
  assert.throws(() => detectDbHash('$A$005$abc'), /caching_sha2_password/);
  assert.throws(() => detectDbHash('$2y$10$abc'), /Bcrypt \/ Scrypt/);
  assert.throws(() => detectDbHash('hello'), /无法识别哈希格式/);
  assert.throws(() => parseScram('SCRAM-SHA-256$4096:AA==$AA==:AA=='), /32 字节/);
});

test('验证密码：三种格式', async () => {
  assert.equal((await verifyDb('password', '*2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19', '')).ok, true);
  assert.equal((await verifyDb('Password', '*2470C0C06DEE42FD1618BB99005ADCA2EC9D1E19', '')).ok, false);
  assert.equal((await verifyDb('password', 'md532e12f215ba27cb750c9e093ce4b5127', 'postgres')).ok, true);
  assert.equal((await verifyDb('password', 'md532e12f215ba27cb750c9e093ce4b5127', 'Postgres')).ok, false, '用户名区分大小写');
  await assert.rejects(verifyDb('password', 'md532e12f215ba27cb750c9e093ce4b5127', ''), /需要填写用户名/);
  const h = await pgScram('快JSON密码');
  assert.equal((await verifyDb('快JSON密码', h, '')).ok, true);
  assert.equal((await verifyDb('快JSON密码 ', h, '')).ok, false);
});

test('SQL 语句：引号转义', () => {
  const my = sqlFor('mysql', '*AB', "o'neil", 'localhost');
  assert.equal(my[0].sql, "CREATE USER 'o''neil'@'localhost' IDENTIFIED WITH mysql_native_password AS '*AB';");
  assert.equal(my[3].sql, "SET PASSWORD FOR 'o''neil'@'localhost' = '*AB';");
  assert.equal(sqlFor('mysql', '*AB', '', '')[2].sql, "CREATE USER 'username'@'%' IDENTIFIED BY PASSWORD '*AB';");
  const pg = sqlFor('pg-scram', 'SCRAM-SHA-256$1:a$b:c', 'App"User', '');
  assert.equal(pg[0].sql, `CREATE ROLE "App""User" LOGIN PASSWORD 'SCRAM-SHA-256$1:a$b:c';`);
  assert.equal(pg[1].sql, `ALTER ROLE "App""User" PASSWORD 'SCRAM-SHA-256$1:a$b:c';`);
});
