// crypto.subtle 是安全上下文专属 API：纯 HTTP（裸 IP、非标端口）部署的浏览器
// 里不存在，而回放加载必须校验 finalStateHash。此实现是标准 SHA-256 兜底，
// 测试中与 WebCrypto 的摘要逐字节对照，保证哈希链跨 Node、HTTPS 与 HTTP 一致。
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

export function sha256Hex(input: Uint8Array): string {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  // 填充到含 0x80 与 8 字节位长字段的最小 64 字节倍数（len+9 覆盖两者）。
  const buffer = new ArrayBuffer(Math.ceil((input.length + 9) / 64) * 64);
  const padded = new Uint8Array(buffer);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(buffer);
  view.setUint32(padded.length - 8, Math.floor(input.length / 2 ** 29));
  view.setUint32(padded.length - 4, input.length << 3);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) schedule[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const value = schedule[index - 15]!;
      const previous = schedule[index - 2]!;
      const sum0 = rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
      const sum1 = rotateRight(previous, 17) ^ rotateRight(previous, 19) ^ (previous >>> 10);
      schedule[index] = (schedule[index - 16]! + sum0 + schedule[index - 7]! + sum1) >>> 0;
    }
    let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = state;
    for (let index = 0; index < 64; index++) {
      const major = (a & b) ^ (a & c) ^ (b & c);
      const choice = (e & f) ^ (~e & g);
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const temp1 = (h + sum1 + choice + ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const temp2 = (sum0 + major) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
}
