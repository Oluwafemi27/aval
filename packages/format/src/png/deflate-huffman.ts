import {
  DeflateBitReader,
  deflateInvalid
} from "./deflate-bit-reader.js";

const MAX_CODE_BITS = 15;

export class DeflateHuffmanTable {
  readonly #codes: readonly ReadonlyMap<number, number>[];
  readonly #maximumBits: number;

  private constructor(
    codes: readonly ReadonlyMap<number, number>[],
    maximumBits: number
  ) {
    this.#codes = codes;
    this.#maximumBits = maximumBits;
  }

  public static build(
    lengths: readonly number[],
    label: string
  ): DeflateHuffmanTable {
    if (!Array.isArray(lengths) && !(lengths instanceof Uint8Array)) {
      deflateInvalid(`${label} code lengths must be an array`);
    }
    const counts = new Uint16Array(MAX_CODE_BITS + 1);
    let symbols = 0;
    let maximumBits = 0;
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
      const length = lengths[symbol];
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_CODE_BITS
      ) {
        deflateInvalid(`${label} contains an invalid code length`);
      }
      if (length !== 0) {
        counts[length] = counts[length]! + 1;
        symbols += 1;
        maximumBits = Math.max(maximumBits, length);
      }
    }
    if (symbols === 0) deflateInvalid(`${label} Huffman tree is empty`);

    let remaining = 1;
    for (let bits = 1; bits <= MAX_CODE_BITS; bits += 1) {
      remaining = remaining * 2 - counts[bits]!;
      if (remaining < 0) deflateInvalid(`${label} Huffman tree is oversubscribed`);
    }
    const permittedSingle = symbols === 1 && counts[1] === 1;
    if (remaining !== 0 && !permittedSingle) {
      deflateInvalid(`${label} Huffman tree is incomplete`);
    }

    const nextCodes = new Uint16Array(MAX_CODE_BITS + 1);
    let code = 0;
    for (let bits = 1; bits <= MAX_CODE_BITS; bits += 1) {
      code = (code + counts[bits - 1]!) << 1;
      nextCodes[bits] = code;
    }
    const mutable = Array.from(
      { length: maximumBits + 1 },
      () => new Map<number, number>()
    );
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
      const length = lengths[symbol]!;
      if (length === 0) continue;
      const canonical = nextCodes[length]!;
      nextCodes[length] = canonical + 1;
      mutable[length]!.set(reverseBits(canonical, length), symbol);
    }
    return new DeflateHuffmanTable(
      Object.freeze(mutable),
      maximumBits
    );
  }

  public decode(reader: DeflateBitReader, label: string): number {
    let code = 0;
    for (let length = 1; length <= this.#maximumBits; length += 1) {
      code |= reader.readBits(1, label) << (length - 1);
      const symbol = this.#codes[length]?.get(code);
      if (symbol !== undefined) {
        reader.decodedSymbol();
        return symbol;
      }
    }
    deflateInvalid(`${label} does not match the Huffman tree`);
  }
}

function reverseBits(value: number, width: number): number {
  let result = 0;
  for (let index = 0; index < width; index += 1) {
    result = (result << 1) | ((value >>> index) & 1);
  }
  return result;
}
