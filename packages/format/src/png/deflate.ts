import { checkedAdd, checkedMultiply } from "../checked-integer.js";
import { FormatError, isFormatError } from "../errors.js";
import {
  DeflateBitReader,
  deflateInvalid
} from "./deflate-bit-reader.js";
import { DeflateHuffmanTable } from "./deflate-huffman.js";

const MAX_DISTANCE = 32 * 1024;

const CODE_LENGTH_ORDER = Object.freeze([
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
] as const);
const LENGTH_BASE = Object.freeze([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
] as const);
const LENGTH_EXTRA = Object.freeze([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
] as const);
const DISTANCE_BASE = Object.freeze([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129,
  193, 257, 385, 513, 769, 1_025, 1_537, 2_049, 3_073, 4_097,
  6_145, 8_193, 12_289, 16_385, 24_577
] as const);
const DISTANCE_EXTRA = Object.freeze([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6,
  6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
] as const);

const FIXED_LITERAL_LENGTHS = createFixedLiteralLengths();
const FIXED_DISTANCE_LENGTHS = Object.freeze(Array.from({ length: 32 }, () => 5));
const FIXED_LITERAL_TABLE = DeflateHuffmanTable.build(
  FIXED_LITERAL_LENGTHS,
  "fixed literal/length"
);
const FIXED_DISTANCE_TABLE = DeflateHuffmanTable.build(
  FIXED_DISTANCE_LENGTHS,
  "fixed distance"
);

export interface DeflateInflateInput {
  readonly deflate: Uint8Array;
  readonly expectedOutputLength: number;
}

export function calculateDeflateWorkLimit(
  compressedBytes: number,
  expectedInflatedBytes: number
): number {
  if (
    !Number.isSafeInteger(compressedBytes) ||
    compressedBytes < 0 ||
    !Number.isSafeInteger(expectedInflatedBytes) ||
    expectedInflatedBytes < 0
  ) {
    deflateInvalid("DEFLATE work-limit inputs are outside the PNG profile");
  }
  try {
    const bytes = checkedAdd(
      compressedBytes,
      expectedInflatedBytes,
      Number.MAX_SAFE_INTEGER,
      "DEFLATE work bytes"
    );
    return checkedAdd(
      checkedMultiply(bytes, 32, Number.MAX_SAFE_INTEGER, "DEFLATE work"),
      4_096,
      Number.MAX_SAFE_INTEGER,
      "DEFLATE work limit"
    );
  } catch (error) {
    if (isFormatError(error)) deflateInvalid(error.message);
    deflateInvalid("DEFLATE work limit could not be calculated");
  }
}

export function inflateDeflate(input: DeflateInflateInput): Uint8Array {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !(input.deflate instanceof Uint8Array)
  ) {
    deflateInvalid("DEFLATE inflate input is invalid");
  }
  return inflateDeflateWithLimit(
    input,
    calculateDeflateWorkLimit(
      input.deflate.byteLength,
      input.expectedOutputLength
    )
  );
}

/** Package-internal deterministic lower-limit hook used by hostile tests. */
export function inflateDeflateWithLimit(
  input: DeflateInflateInput,
  workLimit: number
): Uint8Array {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      deflateInvalid("DEFLATE inflate input must be an object");
    }
    if (!(input.deflate instanceof Uint8Array)) {
      deflateInvalid("DEFLATE input must be a Uint8Array");
    }
    if (input.deflate.byteLength < 1) {
      deflateInvalid("DEFLATE byte length is outside the PNG profile");
    }
    if (
      !Number.isSafeInteger(input.expectedOutputLength) ||
      input.expectedOutputLength < 0
    ) {
      deflateInvalid("DEFLATE output length is outside the PNG profile");
    }
    const reader = new DeflateBitReader(input.deflate, workLimit);
    let output: Uint8Array;
    try {
      output = new Uint8Array(input.expectedOutputLength);
    } catch {
      throw new FormatError(
        "PNG_DEFLATE_INVALID",
        `DEFLATE output allocation failed for ${String(input.expectedOutputLength)} bytes`
      );
    }
    let outputOffset = 0;
    let finalBlock = false;
    while (!finalBlock) {
      finalBlock = reader.readBits(1, "BFINAL") === 1;
      const blockType = reader.readBits(2, "BTYPE");
      if (blockType === 0) {
        outputOffset = inflateStoredBlock(reader, output, outputOffset);
      } else if (blockType === 1) {
        outputOffset = inflateHuffmanBlock(
          reader,
          output,
          outputOffset,
          FIXED_LITERAL_TABLE,
          FIXED_DISTANCE_TABLE
        );
      } else if (blockType === 2) {
        const tables = readDynamicTables(reader);
        outputOffset = inflateHuffmanBlock(
          reader,
          output,
          outputOffset,
          tables.literal,
          tables.distance
        );
      } else {
        deflateInvalid("reserved DEFLATE block type is forbidden");
      }
    }
    reader.finish();
    if (outputOffset !== output.byteLength) {
      deflateInvalid("DEFLATE output length does not match the PNG profile");
    }
    return output;
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError(
      "PNG_DEFLATE_INVALID",
      "DEFLATE stream could not be decoded"
    );
  }
}

function inflateStoredBlock(
  reader: DeflateBitReader,
  output: Uint8Array,
  outputOffset: number
): number {
  reader.alignToByte("stored block");
  const length = reader.readBits(16, "stored LEN");
  const complement = reader.readBits(16, "stored NLEN");
  if (((length ^ 0xffff) & 0xffff) !== complement) {
    deflateInvalid("stored DEFLATE LEN/NLEN mismatch");
  }
  if (length > output.byteLength - outputOffset) {
    deflateInvalid("stored DEFLATE block exceeds expected output");
  }
  for (let index = 0; index < length; index += 1) {
    output[outputOffset] = reader.readBits(8, "stored byte");
    outputOffset += 1;
    reader.copiedOutputByte();
  }
  return outputOffset;
}

function inflateHuffmanBlock(
  reader: DeflateBitReader,
  output: Uint8Array,
  initialOutputOffset: number,
  literalTable: DeflateHuffmanTable,
  distanceTable: DeflateHuffmanTable | null
): number {
  let outputOffset = initialOutputOffset;
  while (true) {
    const symbol = literalTable.decode(reader, "literal/length symbol");
    if (symbol < 256) {
      if (outputOffset >= output.byteLength) {
        deflateInvalid("literal exceeds expected DEFLATE output");
      }
      output[outputOffset] = symbol;
      outputOffset += 1;
      reader.copiedOutputByte();
      continue;
    }
    if (symbol === 256) return outputOffset;
    if (symbol < 257 || symbol > 285) {
      deflateInvalid("reserved literal/length symbol is forbidden");
    }
    if (distanceTable === null) {
      deflateInvalid(
        "DEFLATE length symbol requires a nonempty distance tree"
      );
    }
    const lengthIndex = symbol - 257;
    const length = LENGTH_BASE[lengthIndex]! + reader.readBits(
      LENGTH_EXTRA[lengthIndex]!,
      "length extra bits"
    );
    const distanceSymbol = distanceTable.decode(reader, "distance symbol");
    if (distanceSymbol > 29) {
      deflateInvalid("reserved distance symbol is forbidden");
    }
    const distance = DISTANCE_BASE[distanceSymbol]! + reader.readBits(
      DISTANCE_EXTRA[distanceSymbol]!,
      "distance extra bits"
    );
    if (
      distance < 1 ||
      distance > MAX_DISTANCE ||
      distance > outputOffset
    ) {
      deflateInvalid("DEFLATE distance exceeds produced history");
    }
    if (length > output.byteLength - outputOffset) {
      deflateInvalid("length/distance copy exceeds expected DEFLATE output");
    }
    for (let index = 0; index < length; index += 1) {
      output[outputOffset] = output[outputOffset - distance]!;
      outputOffset += 1;
      reader.copiedOutputByte();
    }
  }
}

function readDynamicTables(reader: DeflateBitReader): {
  readonly literal: DeflateHuffmanTable;
  readonly distance: DeflateHuffmanTable | null;
} {
  const literalCount = reader.readBits(5, "HLIT") + 257;
  const distanceCount = reader.readBits(5, "HDIST") + 1;
  const codeLengthCount = reader.readBits(4, "HCLEN") + 4;
  const codeLengthLengths = new Array<number>(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index]!] = reader.readBits(
      3,
      "code-length code length"
    );
  }
  const codeLengthTable = DeflateHuffmanTable.build(
    codeLengthLengths,
    "code-length"
  );
  const total = literalCount + distanceCount;
  const lengths: number[] = [];
  while (lengths.length < total) {
    const symbol = codeLengthTable.decode(reader, "code-length symbol");
    if (symbol <= 15) {
      lengths.push(symbol);
      continue;
    }
    let repeated: number;
    let count: number;
    if (symbol === 16) {
      if (lengths.length === 0) {
        deflateInvalid("code-length repeat 16 has no previous value");
      }
      repeated = lengths[lengths.length - 1]!;
      count = reader.readBits(2, "repeat-16 count") + 3;
    } else if (symbol === 17) {
      repeated = 0;
      count = reader.readBits(3, "repeat-17 count") + 3;
    } else if (symbol === 18) {
      repeated = 0;
      count = reader.readBits(7, "repeat-18 count") + 11;
    } else {
      deflateInvalid("reserved code-length symbol is forbidden");
    }
    if (count > total - lengths.length) {
      deflateInvalid("code-length repeat exceeds the declared tables");
    }
    for (let index = 0; index < count; index += 1) lengths.push(repeated);
  }
  const literalLengths = lengths.slice(0, literalCount);
  const distanceLengths = lengths.slice(literalCount);
  if (literalLengths[256] === 0) {
    deflateInvalid("literal/length tree must contain end-of-block symbol 256");
  }
  if ((distanceLengths[30] ?? 0) !== 0 || (distanceLengths[31] ?? 0) !== 0) {
    deflateInvalid("dynamic tree declares a reserved distance symbol");
  }
  const distance = distanceLengths.every((length) => length === 0)
    ? null
    : DeflateHuffmanTable.build(distanceLengths, "distance");
  return Object.freeze({
    literal: DeflateHuffmanTable.build(literalLengths, "literal/length"),
    distance
  });
}

function createFixedLiteralLengths(): readonly number[] {
  return Object.freeze(Array.from({ length: 288 }, (_, symbol) =>
    symbol <= 143 ? 8 : symbol <= 255 ? 9 : symbol <= 279 ? 7 : 8
  ));
}
