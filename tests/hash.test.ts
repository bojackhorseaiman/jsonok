// 3.2 哈希和签名的测试：标准测试向量 + 和 Node 自带的 crypto 交叉验证
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { ALGOS, digest, digestBlob, formatDigest, getAlgo, hmac, matchDigest } from '../src/core/hash.ts';
import { ALGO_INFO, COMMON_FILE, COMMON_HASH } from '../src/core/hashList.ts';
import { toHex, utf8Bytes } from '../src/core/bytes.ts';

const u = utf8Bytes;
const H = (id: string, s: string | Uint8Array) => toHex(digest(getAlgo(id), typeof s === 'string' ? u(s) : s));

test('算法清单：30 种，都有实现，名称不重复', () => {
  assert.equal(ALGO_INFO.length, 30);
  assert.equal(ALGOS.length, 30);
  assert.equal(new Set(ALGO_INFO.map((a) => a.id)).size, 30);
  assert.equal(new Set(ALGO_INFO.map((a) => a.label)).size, 30);
  for (const id of [...COMMON_HASH, ...COMMON_FILE]) assert.ok(getAlgo(id), id);
  for (const a of ALGOS) assert.equal(digest(a, u('x')).length * 8, a.bits, a.id + ' 输出位数');
});

test('MD2：RFC 1319 测试向量', () => {
  const v: [string, string][] = [
    ['', '8350e5a3e24c153df2275c9f80692773'],
    ['a', '32ec01ec4a6dac72c0ab96fb34c0b5d1'],
    ['abc', 'da853b0d3f88d99b30283a69e6ded6bb'],
    ['message digest', 'ab4f496bfb2a530b219ff33031fe06b0'],
    ['abcdefghijklmnopqrstuvwxyz', '4e8ddff3650292ab5a4108c3aa47940b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'da33def2a42df13975352846c30338cd'],
    ['1234567890'.repeat(8), 'd5976f79d83d3a0dc9806c3c66f3efd8'],
  ];
  for (const [s, h] of v) assert.equal(H('md2', s), h, JSON.stringify(s));
});

test('MD4：RFC 1320 测试向量', () => {
  const v: [string, string][] = [
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
    ['1234567890'.repeat(8), 'e33b4ddc9c38f2199c3e7b164fcc0536'],
  ];
  for (const [s, h] of v) assert.equal(H('md4', s), h, JSON.stringify(s));
});

test('SM3：国标测试向量', () => {
  assert.equal(H('sm3', 'abc'), '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
  assert.equal(H('sm3', 'abcd'.repeat(16)), 'debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732');
});

test('Keccak / BLAKE3：标准测试向量', () => {
  assert.equal(H('keccak-256', ''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(H('keccak-256', 'abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(H('blake3', ''), 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  assert.equal(H('blake3', 'abc'), '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
});

test('CRC / Adler-32：标准校验值（"123456789"）', () => {
  assert.equal(H('crc32', '123456789'), 'cbf43926');
  assert.equal(H('crc16-modbus', '123456789'), '4b37');
  assert.equal(H('crc16-ccitt', '123456789'), '29b1');
  assert.equal(H('crc16-xmodem', '123456789'), '31c3');
  assert.equal(H('adler32', '123456789'), '091e01de');
  assert.equal(H('adler32', 'Wikipedia'), '11e60398');
  assert.equal(H('crc32', ''), '00000000');
  // Adler-32 分段取模：超过 5552 字节也正确
  const big = new Uint8Array(100000).fill(255);
  let a = 1;
  let b = 0;
  for (const x of big) { a = (a + x) % 65521; b = (b + a) % 65521; }
  assert.equal(H('adler32', big), (((b << 16) | a) >>> 0).toString(16).padStart(8, '0'));
});

// 和 Node 的 crypto 对比：覆盖分组边界（55 / 56 / 63 / 64 / 65 …）和分块输入
const NODE: Record<string, [string, number?]> = {
  md5: ['md5'], md4: ['md4'], sha1: ['sha1'], sha224: ['sha224'], sha256: ['sha256'], sha384: ['sha384'], sha512: ['sha512'],
  'sha512-224': ['sha512-224'], 'sha512-256': ['sha512-256'], 'sha3-224': ['sha3-224'], 'sha3-256': ['sha3-256'],
  'sha3-384': ['sha3-384'], 'sha3-512': ['sha3-512'], shake128: ['shake128', 32], shake256: ['shake256', 64],
  ripemd160: ['ripemd160'], 'blake2b-512': ['blake2b512'], 'blake2s-256': ['blake2s256'], sm3: ['sm3'],
};
const nodeHash = (name: string, len: number | undefined, data: Uint8Array): string | null => {
  try {
    return createHash(name, len ? { outputLength: len } : undefined).update(data).digest('hex');
  } catch {
    return null; // 这台机器的 OpenSSL 不支持（例如 md4 在新版本里属于 legacy）
  }
};
const LENS = [0, 1, 3, 15, 16, 17, 55, 56, 57, 63, 64, 65, 111, 112, 127, 128, 129, 135, 136, 137, 1000, 70001];

test('和 Node crypto 一致：一次输入、随机分块输入', () => {
  const checked: string[] = [];
  for (const [id, [name, len]] of Object.entries(NODE)) {
    if (nodeHash(name, len, new Uint8Array(0)) === null) continue;
    checked.push(id);
    const a = getAlgo(id);
    for (const n of LENS) {
      const data = new Uint8Array(randomBytes(n));
      const want = nodeHash(name, len, data);
      assert.equal(toHex(digest(a, data)), want, `${id} 长度 ${n}`);
      const h = a.create();
      for (let off = 0; off < n; ) {
        const step = 1 + Math.floor(Math.random() * 97);
        h.update(data.subarray(off, off + step));
        off += step;
      }
      assert.equal(toHex(h.digest()), want, `${id} 分块 长度 ${n}`);
    }
  }
  assert.ok(checked.length >= 15, '至少要对比 15 种算法，实际：' + checked.join(','));
});

test('自己实现的算法：分块输入和一次输入结果一致', () => {
  for (const id of ['md2', 'md4', 'sm3', 'crc32', 'crc16-modbus', 'crc16-ccitt', 'crc16-xmodem', 'adler32']) {
    const a = getAlgo(id);
    for (const n of LENS) {
      const data = new Uint8Array(randomBytes(n));
      const h = a.create();
      for (let off = 0; off < n; off += 7) h.update(data.subarray(off, off + 7));
      assert.equal(toHex(h.digest()), toHex(digest(a, data)), `${id} 长度 ${n}`);
    }
  }
});

test('HMAC：和 Node crypto 一致（密钥比分组短 / 一样长 / 更长）', () => {
  const msg = u('The quick brown fox jumps over the lazy dog');
  assert.equal(toHex(hmac(getAlgo('sha256'), u('key'), msg)), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  assert.equal(toHex(hmac(getAlgo('md5'), u('key'), msg)), '80070713463e7749b90c2dc24911e275');
  assert.equal(toHex(hmac(getAlgo('sha1'), u('key'), msg)), 'de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9');
  let n = 0;
  for (const a of ALGOS.filter((x) => x.hmac)) {
    const nodeName = NODE[a.id]?.[0];
    if (!nodeName || nodeHash(nodeName, undefined, new Uint8Array(0)) === null) continue;
    for (const kl of [0, 5, a.block, a.block + 1, 300]) {
      const key = new Uint8Array(randomBytes(kl));
      const data = new Uint8Array(randomBytes(200));
      assert.equal(toHex(hmac(a, key, data)), createHmac(nodeName, key).update(data).digest('hex'), `HMAC-${a.id} 密钥 ${kl}`);
    }
    n++;
  }
  assert.ok(n >= 12, '至少要对比 12 种 HMAC，实际 ' + n);
  assert.throws(() => hmac(getAlgo('crc32'), u('k'), msg), /不能用作 HMAC/);
});

test('文件分块计算：和一次计算结果一致，进度回调、取消', async () => {
  const data = new Uint8Array(randomBytes(50000));
  const algos = ['md5', 'sha256', 'sm3', 'crc32'].map(getAlgo);
  const steps: number[] = [];
  const got = await digestBlob(new Blob([data]), algos, { progress: (d) => steps.push(d) }, 4096);
  assert.deepEqual(got.map((x) => toHex(x)), algos.map((a) => toHex(digest(a, data))));
  assert.equal(steps.length, Math.ceil(50000 / 4096));
  assert.equal(steps.at(-1), 50000);
  const empty = await digestBlob(new Blob([]), [getAlgo('md5')]);
  assert.equal(toHex(empty[0]), 'd41d8cd98f00b204e9800998ecf8427e');
  await assert.rejects(digestBlob(new Blob([data]), algos, { stale: () => true }, 4096), /已取消/);
});

test('输出格式和对比', () => {
  const d = digest(getAlgo('md5'), u('abc'));
  assert.equal(formatDigest(d, 'hex'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(formatDigest(d, 'HEX'), '900150983CD24FB0D6963F7D28E17F72');
  assert.equal(formatDigest(d, 'base64'), 'kAFQmDzST7DWlj99KOF/cg==');
  for (const e of ['900150983CD24FB0D6963F7D28E17F72', ' 90 01 50 98 3c d2 4f b0 d6 96 3f 7d 28 e1 7f 72 ', '90:01:50:98:3c:d2:4f:b0:d6:96:3f:7d:28:e1:7f:72',
    'kAFQmDzST7DWlj99KOF/cg==', 'kAFQmDzST7DWlj99KOF/cg', 'kAFQmDzST7DWlj99KOF_cg', '900150983cd24fb0d6963f7d28e17f72  abc.txt']) {
    assert.ok(matchDigest(e, d), e);
  }
  assert.ok(!matchDigest('900150983cd24fb0d6963f7d28e17f73', d));
  assert.ok(!matchDigest('', d));
});
