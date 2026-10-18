import { BLOCKS, DATA_CODEWORDS, EC_CODEWORDS_PER_BLOCK } from './local-qr-constants.js';

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

for (let index = 0, value = 1; index < 255; index += 1) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < EXP.length; index += 1) EXP[index] = EXP[index - 255];

export function interleave(data: Uint8Array): Uint8Array {
  const blockLength = DATA_CODEWORDS / BLOCKS;
  const blocks = Array.from({ length: BLOCKS }, (_, index) =>
    data.slice(index * blockLength, (index + 1) * blockLength),
  );
  const ecc = blocks.map(reedSolomon);
  const result: number[] = [];
  for (let index = 0; index < blockLength; index += 1)
    for (const block of blocks) result.push(block[index]);
  for (let index = 0; index < EC_CODEWORDS_PER_BLOCK; index += 1)
    for (const block of ecc) result.push(block[index]);
  return Uint8Array.from(result);
}

function reedSolomon(data: Uint8Array): Uint8Array {
  const generator = polynomial(EC_CODEWORDS_PER_BLOCK);
  const remainder = new Uint8Array(EC_CODEWORDS_PER_BLOCK);
  for (const value of data) {
    const factor = value ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[EC_CODEWORDS_PER_BLOCK - 1] = 0;
    for (let index = 0; index < EC_CODEWORDS_PER_BLOCK; index += 1)
      remainder[index] ^= multiply(generator[index], factor);
  }
  return remainder;
}

function polynomial(degree: number): Uint8Array {
  let values = Uint8Array.of(1);
  for (let power = 0; power < degree; power += 1) {
    const next = new Uint8Array(values.length + 1);
    for (let index = 0; index < values.length; index += 1) {
      next[index] ^= values[index];
      next[index + 1] ^= multiply(values[index], EXP[power]);
    }
    values = next;
  }
  return values.slice(1);
}

function multiply(left: number, right: number): number {
  return left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]];
}
