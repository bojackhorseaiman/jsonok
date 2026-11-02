// 哈希算法清单（只有名字，不含实现）：页面选项直接用它，算法实现在 hash.ts 里、用到时才加载

export interface AlgoInfo {
  id: string;
  label: string;
  group: string;
  /** 能不能用作 HMAC（校验和类算法不行） */
  hmac: boolean;
}

const g = (group: string, hmac: boolean, list: [string, string][]): AlgoInfo[] =>
  list.map(([id, label]) => ({ id, label, group, hmac }));

export const ALGO_INFO: AlgoInfo[] = [
  ...g('MD', true, [['md5', 'MD5'], ['md4', 'MD4'], ['md2', 'MD2']]),
  ...g('SHA-1 / SHA-2', true, [
    ['sha1', 'SHA-1'], ['sha224', 'SHA-224'], ['sha256', 'SHA-256'], ['sha384', 'SHA-384'], ['sha512', 'SHA-512'],
    ['sha512-224', 'SHA-512/224'], ['sha512-256', 'SHA-512/256'],
  ]),
  ...g('SHA-3', true, [['sha3-224', 'SHA3-224'], ['sha3-256', 'SHA3-256'], ['sha3-384', 'SHA3-384'], ['sha3-512', 'SHA3-512']]),
  ...g('SHAKE', false, [['shake128', 'SHAKE128（256 位）'], ['shake256', 'SHAKE256（512 位）']]),
  ...g('Keccak', true, [['keccak-224', 'Keccak-224'], ['keccak-256', 'Keccak-256（以太坊）'], ['keccak-384', 'Keccak-384'], ['keccak-512', 'Keccak-512']]),
  ...g('其他', true, [['sm3', 'SM3（国密）'], ['ripemd160', 'RIPEMD-160'], ['blake2b-512', 'BLAKE2b-512'], ['blake2s-256', 'BLAKE2s-256'], ['blake3', 'BLAKE3']]),
  ...g('校验和', false, [['crc32', 'CRC32'], ['crc16-modbus', 'CRC16/MODBUS'], ['crc16-ccitt', 'CRC16/CCITT-FALSE'], ['crc16-xmodem', 'CRC16/XMODEM'], ['adler32', 'Adler-32']]),
];

/** 哈希计算默认显示的算法 */
export const COMMON_HASH = ['md5', 'sha1', 'sha256', 'sha512', 'sha3-256', 'sm3', 'crc32'];
/** 文件哈希默认计算的算法（大文件时少算几种更快） */
export const COMMON_FILE = ['md5', 'sha1', 'sha256', 'sha512', 'crc32'];
