// 3.3 加解密的测试：和 Node 自带的 crypto、CryptoJS、标准测试向量交叉验证
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto, { createCipheriv, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import CryptoJS from 'crypto-js';
import { decrypt, encrypt, pad, unpad, type CipherOpt } from '../src/core/cipher.ts';
import { generateRsa, maxPlain, parsePrivateKey, parsePublicKey, rsaDecrypt, rsaEncrypt, rsaSign, rsaVerify } from '../src/core/rsa.ts';
import { decodeJwt, relTime, signJwt, timeClaims, verifyJwt } from '../src/core/jwt.ts';
import { fromBase64, fromHex, toBase64, toHex, utf8Bytes, utf8Text } from '../src/core/bytes.ts';
import { parse } from '../src/core/json.ts';

const u = utf8Bytes;
const rnd = (n: number) => new Uint8Array(randomBytes(n));
const base = (o: Partial<CipherOpt>): CipherOpt => ({
  algo: 'aes', mode: 'cbc', padding: 'pkcs7', key: new Uint8Array(0), iv: new Uint8Array(0), pass: false, ivPrefix: false, fix: false, ...o,
});
const nodeEnc = (name: string, key: Uint8Array, iv: Uint8Array | null, data: Uint8Array, autoPad = true): string => {
  const c = createCipheriv(name, key, iv);
  c.setAutoPadding(autoPad);
  return Buffer.concat([c.update(data), c.final()]).toString('hex');
};
const LENS = [0, 1, 15, 16, 17, 31, 32, 33, 100, 1000];

test('AES：CBC / ECB / CFB / OFB / CTR 和 Node crypto 一致（128 / 192 / 256 位），能解回原文', async () => {
  for (const bits of [128, 192, 256]) {
    for (const [mode, name, padded] of [['cbc', 'cbc', true], ['ecb', 'ecb', true], ['cfb', 'cfb', false], ['ofb', 'ofb', false], ['ctr', 'ctr', false]] as const) {
      for (const n of LENS) {
        const key = rnd(bits / 8);
        const iv = rnd(16);
        const data = rnd(n);
        const o = base({ algo: 'aes', mode, key, iv });
        const r = await encrypt(data, o);
        assert.equal(toHex(r.bytes), nodeEnc(`aes-${bits}-${name}`, key, mode === 'ecb' ? null : iv, data, padded), `AES-${bits}-${mode} 长度 ${n}`);
        assert.equal(toHex((await decrypt(r.bytes, o)).bytes), toHex(data), `AES-${bits}-${mode} 解密 长度 ${n}`);
      }
    }
  }
});

test('AES-CTR：计数器整体进位（和 OpenSSL 一致）', async () => {
  const key = rnd(16);
  const iv = fromHex('000102030405060708090a0bfffffffe');
  const data = rnd(100);
  const r = await encrypt(data, base({ mode: 'ctr', key, iv }));
  assert.equal(toHex(r.bytes), nodeEnc('aes-128-ctr', key, iv, data, false));
  const iv2 = fromHex('ffffffffffffffffffffffffffffffff');
  assert.equal(toHex((await encrypt(data, base({ mode: 'ctr', key, iv: iv2 }))).bytes), nodeEnc('aes-128-ctr', key, iv2, data, false));
});

test('AES-GCM：和 Node crypto 一致，密文被改动时解密失败', async () => {
  for (const bits of [128, 256]) {
    const key = rnd(bits / 8);
    const iv = rnd(12);
    const data = u('快JSON GCM 测试');
    const c = createCipheriv(`aes-${bits}-gcm`, key, iv);
    const want = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]).toString('hex');
    const o = base({ mode: 'gcm', key, iv });
    const r = await encrypt(data, o);
    assert.equal(toHex(r.bytes), want);
    assert.equal(utf8Text((await decrypt(r.bytes, o)).bytes), '快JSON GCM 测试');
    const bad = r.bytes.slice();
    bad[0] ^= 1;
    await assert.rejects(decrypt(bad, o), /认证标签校验不通过/);
  }
  await assert.rejects(encrypt(u('x'), base({ algo: 'des', mode: 'gcm', key: rnd(8), iv: rnd(8) })), /GCM 模式只支持 AES/);
});

test('标准测试向量：AES（FIPS-197）、DES、RC4', async () => {
  const aes = await encrypt(fromHex('00112233445566778899aabbccddeeff'), base({ mode: 'ecb', padding: 'none', key: fromHex('000102030405060708090a0b0c0d0e0f') }));
  assert.equal(toHex(aes.bytes), '69c4e0d86a7b0430d8cdb78070b4c55a');
  const des = await encrypt(fromHex('0123456789abcdef'), base({ algo: 'des', mode: 'ecb', padding: 'none', key: fromHex('133457799bbcdff1') }));
  assert.equal(toHex(des.bytes), '85e813540f0ab405');
  for (const [k, p, c] of [['Key', 'Plaintext', 'bbf316e8d940af0ad3'], ['Wiki', 'pedia', '1021bf0420'], ['Secret', 'Attack at dawn', '45a01f645fc35b383552544b9bf5']]) {
    const r = await encrypt(u(p), base({ algo: 'rc4', key: u(k) }));
    assert.equal(toHex(r.bytes), c, `RC4 ${k}`);
    assert.equal(utf8Text((await decrypt(r.bytes, base({ algo: 'rc4', key: u(k) }))).bytes), p);
  }
});

test('3DES：和 Node crypto 一致（24 字节密钥；16 字节按 K1 K2 K1）', async () => {
  const key = rnd(24);
  const iv = rnd(8);
  for (const n of LENS) {
    const data = rnd(n);
    let want: string | null = null;
    try { want = nodeEnc('des-ede3-cbc', key, iv, data); } catch { /* 这台机器的 OpenSSL 不支持 */ }
    const r = await encrypt(data, base({ algo: '3des', key, iv }));
    if (want) assert.equal(toHex(r.bytes), want, `3DES 长度 ${n}`);
    assert.equal(toHex((await decrypt(r.bytes, base({ algo: '3des', key, iv }))).bytes), toHex(data));
  }
  const k16 = rnd(16);
  const k24 = new Uint8Array([...k16, ...k16.subarray(0, 8)]);
  const d = rnd(40);
  assert.equal(toHex((await encrypt(d, base({ algo: '3des', key: k16, iv }))).bytes), toHex((await encrypt(d, base({ algo: '3des', key: k24, iv }))).bytes));
});

test('和 CryptoJS 互通：口令方式（5 种算法）、直接使用密钥', async () => {
  const C = CryptoJS as unknown as Record<string, { encrypt: (m: string, k: unknown, c?: unknown) => { toString(): string }; decrypt: (c: string, k: unknown, cfg?: unknown) => { toString(e: unknown): string } }>;
  const names: [CipherOpt['algo'], string][] = [['aes', 'AES'], ['des', 'DES'], ['3des', 'TripleDES'], ['rc4', 'RC4'], ['rabbit', 'Rabbit']];
  for (const [algo, name] of names) {
    const text = '快JSON 和 CryptoJS 互通 ' + algo;
    // CryptoJS 加密 → 我们解密
    const ct = C[name].encrypt(text, 'my pass').toString();
    assert.ok(ct.startsWith('U2FsdGVkX1'), ct);
    const o = base({ algo, pass: true, key: u('my pass') });
    assert.equal(utf8Text((await decrypt(fromBase64(ct).bytes, o)).bytes), text, `${name} 解密 CryptoJS 的密文`);
    // 我们加密 → CryptoJS 解密
    const mine = toBase64((await encrypt(u(text), o)).bytes);
    assert.equal(C[name].decrypt(mine, 'my pass').toString(CryptoJS.enc.Utf8), text, `CryptoJS 解密我们的 ${name} 密文`);
  }
  // 固定盐：结果可重复，并且和 CryptoJS 指定盐的结果一致
  const salt = fromHex('0102030405060708');
  const fixed = await encrypt(u('abc'), base({ pass: true, key: u('pw'), salt }));
  const cj = CryptoJS.AES.encrypt('abc', 'pw', { salt: CryptoJS.enc.Hex.parse('0102030405060708') } as never).toString();
  assert.equal(toBase64(fixed.bytes), cj);
  // 直接使用密钥：和 CryptoJS 传 WordArray 的结果一致
  const k = CryptoJS.enc.Utf8.parse('1234567890abcdef');
  const iv = CryptoJS.enc.Utf8.parse('abcdef1234567890');
  const raw = CryptoJS.AES.encrypt('你好，快JSON', k, { iv }).toString();
  const r = await encrypt(u('你好，快JSON'), base({ key: u('1234567890abcdef'), iv: u('abcdef1234567890') }));
  assert.equal(toBase64(r.bytes), raw);
  await assert.rejects(decrypt(r.bytes, base({ pass: true, key: u('x') })), /不是口令方式加密的/);
});

test('填充方式：6 种都能往返；错误的密钥能检测出来', async () => {
  for (const p of ['pkcs7', 'zero', 'iso10126', 'ansix923', 'iso97971'] as const) {
    for (const n of [1, 15, 16, 17, 31]) {
      const data = new Uint8Array(n).fill(0x41);
      const padded = pad(data, 16, p);
      assert.equal(padded.length % 16, 0, p);
      assert.deepEqual([...unpad(padded, 16, p)], [...data], `${p} 长度 ${n}`);
    }
  }
  assert.equal(pad(new Uint8Array(16), 16, 'zero').length, 16, 'ZeroPadding 长度正好时不再补');
  assert.throws(() => pad(new Uint8Array(15), 16, 'none'), /整数倍/);
  assert.throws(() => unpad(new Uint8Array([1, 2, 3, 0]), 4, 'pkcs7'), /填充不正确/);
  assert.throws(() => unpad(new Uint8Array([1, 2, 2, 3]), 4, 'pkcs7'), /填充不正确/);
  assert.throws(() => unpad(new Uint8Array([1, 2, 0, 0]), 4, 'iso97971'), /填充不正确/);
  const o = base({ key: u('1234567890abcdef'), iv: u('abcdef1234567890') });
  const ct = (await encrypt(u('快JSON 测试错误的密钥'), o)).bytes;
  await assert.rejects(decrypt(ct, { ...o, key: u('1234567890abcdeX') }), /填充不正确/);
  await assert.rejects(decrypt(ct.subarray(0, ct.length - 3), o), /不是 16 字节的整数倍/);
});

test('密钥 / IV：长度检查、补 0、随机 IV 放在前面、ECB 忽略 IV', async () => {
  await assert.rejects(encrypt(u('x'), base({ key: u('short'), iv: rnd(16) })), /AES 的密钥必须是 16 字节（128 位） \/ 24 字节（192 位） \/ 32 字节（256 位），现在是 5 字节/);
  await assert.rejects(encrypt(u('x'), base({ key: rnd(16) })), /CBC 模式需要 IV（16 字节）/);
  await assert.rejects(encrypt(u('x'), base({ key: rnd(16), iv: rnd(8) })), /AES 的 IV 必须是 16 字节/);
  const fixed = await encrypt(u('x'), base({ key: u('short'), iv: u('iv'), fix: true }));
  assert.ok(fixed.notes.some((x) => x.includes('密钥长度 5 字节，已补 0 到 16 字节')) && fixed.notes.some((x) => x.includes('IV 长度 2 字节，已补 0 到 16 字节')), fixed.notes.join(' | '));
  const same = await encrypt(u('x'), base({ key: u('short\0\0\0\0\0\0\0\0\0\0\0'), iv: u('iv\0\0\0\0\0\0\0\0\0\0\0\0\0\0') }));
  assert.equal(toHex(fixed.bytes), toHex(same.bytes));
  const key = rnd(32);
  const a = await encrypt(u('随机 IV'), base({ key, ivPrefix: true }));
  const b = await encrypt(u('随机 IV'), base({ key, ivPrefix: true }));
  assert.notEqual(toHex(a.bytes), toHex(b.bytes), '每次 IV 不同，密文不同');
  assert.equal(a.bytes.length, 32);
  assert.equal(utf8Text((await decrypt(a.bytes, base({ key, ivPrefix: true }))).bytes), '随机 IV');
  const ecb = await encrypt(u('x'), base({ mode: 'ecb', key, iv: rnd(16) }));
  assert.ok(ecb.notes.includes('ECB 模式不使用 IV，已忽略'));
  const gcm = await encrypt(u('x'), base({ mode: 'gcm', key, ivPrefix: true }));
  assert.equal(gcm.bytes.length, 12 + 1 + 16, 'GCM：12 字节 IV + 密文 + 16 字节标签');
  assert.equal(utf8Text((await decrypt(gcm.bytes, base({ mode: 'gcm', key, ivPrefix: true }))).bytes), 'x');
  await assert.rejects(encrypt(u('x'), base({ algo: 'rabbit', key: rnd(10) })), /Rabbit 的密钥必须是 16 字节/);
  const rab = base({ algo: 'rabbit', key: rnd(16), iv: rnd(8) });
  assert.equal(utf8Text((await decrypt((await encrypt(u('Rabbit 往返'), rab)).bytes, rab)).bytes), 'Rabbit 往返');
});

// ================= RSA =================

const node = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB = node.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = node.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PRIV1 = node.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const PUB1 = node.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

test('RSA 密钥：PKCS#8 / PKCS#1 / 只有 Base64 / 用私钥代替公钥', () => {
  const n = parsePublicKey(PUB).key.n.toString(16);
  for (const t of [PUB, PUB1, PUB.replace(/-----[^-]+-----|\s/g, '')]) assert.equal(parsePublicKey(t).key.n.toString(16), n);
  assert.equal(parsePublicKey(PRIV).from, '私钥');
  for (const t of [PRIV, PRIV1, PRIV.replace(/-----[^-]+-----|\s/g, '')]) assert.equal(parsePrivateKey(t).n.toString(16), n);
  assert.throws(() => parsePrivateKey(PUB), /你粘贴的是公钥/);
  assert.throws(() => parsePublicKey('hello world'), /密钥内容不完整/);
  assert.throws(() => parsePublicKey('中文'), /无法识别密钥/);
  assert.throws(() => parsePrivateKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----'), /加了密码的私钥/);
  assert.throws(() => parsePublicKey('-----BEGIN PUBLIC KEY-----\nMIIB'), /PEM 不完整/);
});

test('RSA 加解密：PKCS#1 v1.5 / OAEP 和 Node crypto 互通，分段加密', () => {
  const pub = parsePublicKey(PUB).key;
  const priv = parsePrivateKey(PRIV);
  const data = u('快JSON：RSA 加密测试');
  // Node 加密 → 我们解密
  const nodeP1 = new Uint8Array(nodeCrypto.publicEncrypt({ key: PUB, padding: nodeCrypto.constants.RSA_PKCS1_PADDING }, data));
  assert.equal(utf8Text(rsaDecrypt(priv, nodeP1, 'pkcs1').bytes), '快JSON：RSA 加密测试');
  for (const [pad, hash] of [['oaep1', 'sha1'], ['oaep256', 'sha256']] as const) {
    const enc = new Uint8Array(nodeCrypto.publicEncrypt({ key: PUB, padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: hash }, data));
    assert.equal(utf8Text(rsaDecrypt(priv, enc, pad).bytes), '快JSON：RSA 加密测试', pad);
    // 我们加密 → Node 解密
    const mine = rsaEncrypt(pub, data, pad, false).bytes;
    assert.equal(nodeCrypto.privateDecrypt({ key: PRIV, padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: hash }, mine).toString(), '快JSON：RSA 加密测试', pad);
  }
  for (const pad of ['pkcs1', 'oaep1', 'oaep256', 'oaep256j'] as const) {
    assert.equal(utf8Text(rsaDecrypt(priv, rsaEncrypt(pub, data, pad, false).bytes, pad).bytes), '快JSON：RSA 加密测试', pad + ' 往返');
  }
  assert.equal(maxPlain(pub, 'pkcs1'), 245);
  assert.equal(maxPlain(pub, 'oaep256'), 190);
  const long = rnd(1000);
  assert.throws(() => rsaEncrypt(pub, long, 'pkcs1', false), /超过了 2048 位密钥一次能加密的上限 245 字节/);
  const seg = rsaEncrypt(pub, long, 'pkcs1', true);
  assert.equal(seg.segments, 5);
  assert.equal(seg.bytes.length, 5 * 256);
  assert.equal(toHex(rsaDecrypt(priv, seg.bytes, 'pkcs1').bytes), toHex(long));
  assert.throws(() => rsaDecrypt(priv, seg.bytes.subarray(0, 300), 'pkcs1'), /应该是 256 字节（2048 位密钥）的整数倍/);
  const other = parsePrivateKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  assert.throws(() => rsaDecrypt(other, nodeP1, 'pkcs1'), /解密失败/);
});

test('RSA 签名：和 Node crypto 一致（PKCS#1 v1.5 结果相同；PSS 互相验证）', () => {
  const pub = parsePublicKey(PUB).key;
  const priv = parsePrivateKey(PRIV1);
  const data = u('快JSON 签名测试');
  for (const [alg, h] of [['sha256', 'sha256'], ['sha1', 'sha1'], ['sha384', 'sha384'], ['sha512', 'sha512'], ['md5', 'md5']] as const) {
    const mine = rsaSign(priv, data, alg);
    assert.equal(toHex(mine), nodeCrypto.sign(h, data, PRIV).toString('hex'), alg);
    assert.ok(rsaVerify(pub, data, mine, alg), alg + ' 验签');
    assert.ok(!rsaVerify(pub, u('被改过的内容'), mine, alg), alg + ' 内容不对时验签失败');
  }
  const pssOpt = { key: PRIV, padding: nodeCrypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
  const mine = rsaSign(priv, data, 'pss256');
  assert.ok(nodeCrypto.verify('sha256', data, { key: PUB, padding: nodeCrypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, mine), 'Node 验证我们的 PSS 签名');
  assert.ok(rsaVerify(pub, data, new Uint8Array(nodeCrypto.sign('sha256', data, pssOpt)), 'pss256'), '我们验证 Node 的 PSS 签名');
  assert.ok(!rsaVerify(pub, data, new Uint8Array(10), 'sha256'), '签名格式不对时返回 false，不报错');
});

test('RSA 生成密钥对：PKCS#8 / PKCS#1，生成的密钥能直接使用', async () => {
  for (const fmt of ['pkcs8', 'pkcs1'] as const) {
    const p = await generateRsa(1024, fmt);
    assert.ok(p.pub.startsWith('-----BEGIN PUBLIC KEY-----\n'));
    assert.ok(p.priv.startsWith(fmt === 'pkcs8' ? '-----BEGIN PRIVATE KEY-----\n' : '-----BEGIN RSA PRIVATE KEY-----\n'), p.priv.slice(0, 40));
    assert.ok(!p.priv.includes('\r'));
    const data = u('生成的密钥');
    assert.equal(utf8Text(rsaDecrypt(parsePrivateKey(p.priv), rsaEncrypt(parsePublicKey(p.pub).key, data, 'pkcs1', false).bytes, 'pkcs1').bytes), '生成的密钥');
    assert.ok(nodeCrypto.verify('sha256', data, p.pub, rsaSign(parsePrivateKey(p.priv), data, 'sha256')), 'Node 能用生成的公钥验签');
  }
});

// ================= JWT =================

const JWT_IO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const signOpt = { secretFmt: 'text' as const, kid: '', iat: false, expSec: 0, now: 1_700_000_000_000 };

test('JWT 解析：jwt.io 示例、Bearer 前缀、各种错误', async () => {
  const d = decodeJwt('Bearer ' + JWT_IO);
  assert.equal(d.alg, 'HS256');
  assert.deepEqual(d.payloadJS, { sub: '1234567890', name: 'John Doe', iat: 1516239022 });
  assert.equal((await verifyJwt(d, 'your-256-bit-secret', 'text')).ok, true);
  assert.equal((await verifyJwt(d, 'wrong', 'text')).ok, false);
  assert.equal((await verifyJwt(d, toBase64(u('your-256-bit-secret')), 'base64')).ok, true);
  assert.equal((await verifyJwt(d, JSON.stringify({ kty: 'oct', k: toBase64(u('your-256-bit-secret'), true, false) }), 'text')).ok, true, 'JWK 对称密钥');
  assert.throws(() => decodeJwt('abc.def'), /应该是用 \. 分隔的 3 段/);
  assert.throws(() => decodeJwt('a.b.c.d.e'), /这是加密的 JWE/);
  assert.throws(() => decodeJwt('###.e30.'), /第 1 段（Header）不是有效的 Base64URL/);
  assert.throws(() => decodeJwt(toBase64(u('not json'), true, false) + '.e30.'), /第 1 段（Header）解码后不是 JSON/);
  const none = decodeJwt(toBase64(u('{"alg":"none"}'), true, false) + '.e30.');
  assert.match((await verifyJwt(none, 'x', 'text')).message, /没有签名/);
});

test('JWT 签发：HS256 结果和 jwt.io 一致，iat / exp / kid', async () => {
  const payload = parse('{"sub":"1234567890","name":"John Doe","iat":1516239022}').root;
  const r = await signJwt(payload, { ...signOpt, alg: 'HS256', keyText: 'your-256-bit-secret' });
  assert.equal(r.token, JWT_IO);
  assert.match(r.warn, /密钥只有 19 字节/);
  const r2 = await signJwt(parse('{"a":1}').root, { ...signOpt, alg: 'HS512', keyText: 'k'.repeat(64), iat: true, expSec: 3600, kid: 'key-1' });
  const d = decodeJwt(r2.token);
  assert.deepEqual(d.headerJS, { alg: 'HS512', typ: 'JWT', kid: 'key-1' });
  assert.deepEqual(d.payloadJS, { a: 1, iat: 1_700_000_000, exp: 1_700_003_600 });
  assert.equal(r2.exp?.getTime(), 1_700_003_600_000);
  assert.equal(r2.warn, '');
  // 超长整数不丢精度
  const big = await signJwt(parse('{"uid":12345678901234567890}').root, { ...signOpt, alg: 'HS256', keyText: 'x'.repeat(32) });
  assert.ok(utf8Text(fromBase64(big.token.split('.')[1]).bytes).includes('12345678901234567890'));
  await assert.rejects(signJwt(parse('[1]').root, { ...signOpt, alg: 'HS256', keyText: 'x' }), /应该是 JSON 对象/);
  await assert.rejects(signJwt(payload, { ...signOpt, alg: 'XX1', keyText: 'x' }), /不支持的签名算法/);
});

const verifyNode = (token: string, alg: string, key: nodeCrypto.KeyObject, opts: Record<string, unknown> = {}) => {
  const [h, p, s] = token.split('.');
  const hash = alg === 'EdDSA' ? null : 'sha' + alg.slice(2);
  return nodeCrypto.verify(hash, Buffer.from(`${h}.${p}`), { key, ...opts } as never, fromBase64(s).bytes);
};
const signNode = (alg: string, key: nodeCrypto.KeyObject, opts: Record<string, unknown> = {}) => {
  const enc = (o: unknown) => toBase64(u(JSON.stringify(o)), true, false);
  const input = `${enc({ alg, typ: 'JWT' })}.${enc({ sub: 'node', n: 1 })}`;
  const hash = alg === 'EdDSA' ? null : 'sha' + alg.slice(2);
  const sig = nodeCrypto.sign(hash, Buffer.from(input), { key, ...opts } as never);
  return `${input}.${toBase64(new Uint8Array(sig), true, false)}`;
};

test('JWT：RS / PS / ES / EdDSA 签发和验证，和 Node crypto 互通', async () => {
  const rsaK = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaPriv = rsaK.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rsaPriv1 = rsaK.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const rsaPub = rsaK.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const rsaPub1 = rsaK.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const payload = parse('{"sub":"kuaijson"}').root;
  for (const alg of ['RS256', 'RS384', 'RS512', 'PS256', 'PS512']) {
    const pss = alg.startsWith('PS') ? { padding: nodeCrypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(alg.slice(2)) / 8 } : {};
    for (const priv of [rsaPriv, rsaPriv1]) {
      const r = await signJwt(payload, { ...signOpt, alg, keyText: priv });
      assert.ok(verifyNode(r.token, alg, rsaK.publicKey, pss), `${alg} Node 验证我们的签名`);
      for (const pub of [rsaPub, rsaPub1, rsaPriv]) assert.equal((await verifyJwt(decodeJwt(r.token), pub, 'text')).ok, true, `${alg} 自己验证`);
    }
    const t = signNode(alg, rsaK.privateKey, pss);
    assert.equal((await verifyJwt(decodeJwt(t), rsaPub, 'text')).ok, true, `${alg} 验证 Node 的签名`);
  }
  for (const [alg, curve] of [['ES256', 'prime256v1'], ['ES384', 'secp384r1'], ['ES512', 'secp521r1']] as const) {
    const ec = generateKeyPairSync('ec', { namedCurve: curve });
    const priv = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pub = ec.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const r = await signJwt(payload, { ...signOpt, alg, keyText: priv });
    assert.ok(verifyNode(r.token, alg, ec.publicKey, { dsaEncoding: 'ieee-p1363' }), `${alg} Node 验证我们的签名`);
    assert.equal((await verifyJwt(decodeJwt(signNode(alg, ec.privateKey, { dsaEncoding: 'ieee-p1363' })), pub, 'text')).ok, true, `${alg} 验证 Node 的签名`);
    // JWK / JWKS
    const jwk = ec.publicKey.export({ format: 'jwk' });
    assert.equal((await verifyJwt(decodeJwt(r.token), JSON.stringify(jwk), 'text')).ok, true, `${alg} JWK`);
    assert.equal((await verifyJwt(decodeJwt(r.token), JSON.stringify({ keys: [{ ...jwk, kid: 'a', use: 'sig' }] }), 'text')).ok, true, `${alg} JWKS`);
    const sec1 = ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    await assert.rejects(signJwt(payload, { ...signOpt, alg, keyText: sec1 }), /SEC1 格式的 EC 私钥/);
  }
  const ed = generateKeyPairSync('ed25519');
  const edPriv = ed.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const edPub = ed.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const r = await signJwt(payload, { ...signOpt, alg: 'EdDSA', keyText: edPriv });
  assert.ok(verifyNode(r.token, 'EdDSA', ed.publicKey), 'EdDSA Node 验证我们的签名');
  assert.equal((await verifyJwt(decodeJwt(signNode('EdDSA', ed.privateKey)), edPub, 'text')).ok, true, 'EdDSA 验证 Node 的签名');
  // 错误的公钥、改过的内容
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const rs = await signJwt(payload, { ...signOpt, alg: 'RS256', keyText: rsaPriv });
  assert.equal((await verifyJwt(decodeJwt(rs.token), other, 'text')).ok, false);
  const [h, , s] = rs.token.split('.');
  const tampered = `${h}.${toBase64(u('{"sub":"admin"}'), true, false)}.${s}`;
  assert.equal((await verifyJwt(decodeJwt(tampered), rsaPub, 'text')).ok, false);
  await assert.rejects(verifyJwt(decodeJwt(rs.token), edPub, 'text'), /密钥和算法 RS256 不匹配/);
});

test('JWT 时间：iat / nbf / exp 换算、过期判断', () => {
  const now = 1_700_000_000_000;
  const t = timeClaims({ iat: 1_699_996_400, nbf: 1_700_003_600, exp: 1_699_999_000 }, now);
  assert.deepEqual(t.items.map((x) => [x.key, x.rel]), [['iat', '1 小时前'], ['nbf', '1 小时后'], ['exp', '17 分钟前']]);
  assert.ok(t.expired && t.notYet);
  assert.equal(timeClaims({ exp: now + 86400e3 * 3 }, now).items[0].rel, '3 天后', '毫秒时间戳也能识别');
  assert.equal(relTime(-30e3), '30 秒前');
  assert.deepEqual(timeClaims('x').items, []);
});

test('工具定义：3 个加解密工具都已登记', () => {
  const src = readFileSync(new URL('../src/tools/encode/cryptoDefs.ts', import.meta.url), 'utf8');
  const ids = [...src.slice(src.indexOf('export const CRYPTO_DEFS')).matchAll(/^  '([\w/-]+)':/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['encode/cipher', 'encode/rsa', 'encode/jwt']);
});
