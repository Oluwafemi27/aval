import { constants, deflateSync } from "node:zlib";

import { adler32, crc32 } from "../../../../packages/format/dist/index.js";

export const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
);

export function conformancePixels(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba.set([
        (x * 37 + y * 11) & 0xff,
        (x * 13 + y * 47) & 0xff,
        (x * 71 + y * 19) & 0xff,
        (x * 29 + y * 31) & 0xff
      ], offset);
    }
  }
  return rgba;
}

export function strictPng({ width, height, rgba, filter, compression }) {
  return strictPngFromFiltered(
    width,
    height,
    filterRgba(rgba, width, height, filter),
    compression
  );
}

export function strictPngFromFiltered(
  width,
  height,
  filtered,
  compression,
  enforceBlockType = true
) {
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const options = compression === "stored"
    ? { level: 0 }
    : compression === "fixed"
      ? { level: 9, strategy: constants.Z_FIXED }
      : { level: 9, strategy: constants.Z_HUFFMAN_ONLY };
  const zlib = new Uint8Array(deflateSync(filtered, options));
  const blockType = (zlib[2] >> 1) & 0x03;
  const expectedType = compression === "stored" ? 0 : compression === "fixed" ? 1 : 2;
  if (enforceBlockType && blockType !== expectedType) {
    throw new Error(`${compression} PNG produced DEFLATE block type ${String(blockType)}`);
  }
  return concatenate([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("sRGB", Uint8Array.of(0)),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array())
  ]);
}

export function strictPngFromZlib(width, height, zlib) {
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return strictPngFromChunks([
    chunk("IHDR", ihdr),
    chunk("sRGB", Uint8Array.of(0)),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array())
  ]);
}

export function strictPngFromRawDeflate(width, height, raw, filtered) {
  const zlib = new Uint8Array(2 + raw.byteLength + 4);
  zlib.set([0x78, 0x01]);
  zlib.set(raw, 2);
  writeUint32BE(zlib, zlib.byteLength - 4, adler32(filtered));
  return strictPngFromZlib(width, height, zlib);
}

export function strictPngFromChunks(chunks) {
  return concatenate([PNG_SIGNATURE, ...chunks]);
}

export function declaredChunkHeader(type, length) {
  const header = new Uint8Array(8);
  writeUint32BE(header, 0, length);
  header.set(new TextEncoder().encode(type), 4);
  return header;
}

export function rawChunk(typeBytes, data) {
  const result = new Uint8Array(12 + data.byteLength);
  writeUint32BE(result, 0, data.byteLength);
  result.set(typeBytes, 4);
  result.set(data, 8);
  writeUint32BE(
    result,
    8 + data.byteLength,
    crc32(result.subarray(4, 8 + data.byteLength))
  );
  return result;
}

export function chunkData(png, type) {
  const found = findChunk(png, type);
  return png.slice(found.dataOffset, found.dataOffset + found.length);
}

export function mutateIhdr(png, mutate) {
  const output = png.slice();
  const found = findChunk(output, "IHDR");
  const data = output.subarray(found.dataOffset, found.dataOffset + found.length);
  mutate(data);
  writeUint32BE(
    output,
    found.dataOffset + found.length,
    crc32(output.subarray(found.offset + 4, found.dataOffset + found.length))
  );
  return output;
}

export function replaceZlibHeader(zlib, cmf, flg) {
  const output = zlib.slice();
  output[0] = cmf;
  output[1] = flg;
  return output;
}

export function validZlibFlag(cmf, dictionary) {
  for (let flg = 0; flg <= 0xff; flg += 1) {
    if (((flg & 0x20) !== 0) !== dictionary) continue;
    if (((cmf << 8) | flg) % 31 === 0) return flg;
  }
  throw new Error("could not derive a valid zlib FLG byte");
}

export function storedBlockHeader(length) {
  const result = new Uint8Array(5);
  result[0] = 1;
  result[1] = length & 0xff;
  result[2] = (length >>> 8) & 0xff;
  const complement = (~length) & 0xffff;
  result[3] = complement & 0xff;
  result[4] = (complement >>> 8) & 0xff;
  return result;
}

export function dynamicHeader(codeLengths) {
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(2, 2);
  writer.bits(0, 5).bits(0, 5).bits(0, 4);
  for (const length of codeLengths) writer.bits(length, 3);
  return writer.finish();
}

export function dynamicLeadingRepeat16() {
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(2, 2);
  writer.bits(0, 5).bits(0, 5).bits(0, 4);
  writer.bits(1, 3).bits(0, 3).bits(0, 3).bits(1, 3);
  writer.bits(1, 1);
  return writer.finish();
}

export function dynamicRepeatOverflow() {
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(2, 2);
  writer.bits(0, 5).bits(0, 5).bits(0, 4);
  writer.bits(0, 3).bits(0, 3).bits(1, 3).bits(1, 3);
  writer.bits(1, 1).bits(127, 7);
  writer.bits(1, 1).bits(110, 7);
  return writer.finish();
}

export function dynamicLengthsBlock({ literal, distance, body = [] }) {
  if (literal.length < 257 || literal.length > 286) {
    throw new Error("dynamic literal table size is outside RFC 1951");
  }
  if (distance.length < 1 || distance.length > 32) {
    throw new Error("dynamic distance table size is outside RFC 1951");
  }
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(2, 2);
  writer.bits(literal.length - 257, 5);
  writer.bits(distance.length - 1, 5);
  writer.bits(14, 4);
  const codeLengthLengths = new Array(19).fill(0);
  codeLengthLengths[0] = 1;
  codeLengthLengths[1] = 2;
  codeLengthLengths[2] = 3;
  codeLengthLengths[3] = 3;
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1];
  for (const symbol of order) writer.bits(codeLengthLengths[symbol], 3);
  const codes = canonicalCodes(codeLengthLengths);
  for (const value of [...literal, ...distance]) {
    writeCanonicalSymbol(writer, codes, value);
  }
  for (const [value, count] of body) writer.bits(value, count);
  return writer.finish();
}

export function sparseLengths(length, entries) {
  const result = new Array(length).fill(0);
  for (const [index, value] of entries) result[index] = value;
  return result;
}

export function fixedBlock(symbols, includeEob = true) {
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(1, 2);
  for (const symbol of symbols) writeFixedLiteral(writer, symbol);
  if (includeEob && symbols.at(-1) !== 256) writeFixedLiteral(writer, 256);
  return writer.finish();
}

export function fixedLengthDistanceBlock(lengthSymbol, distanceSymbol) {
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(1, 2);
  writeFixedLiteral(writer, lengthSymbol);
  writer.bits(reverseBits(distanceSymbol, 5), 5);
  writeFixedLiteral(writer, 256);
  return writer.finish();
}

export function fixedLiteralThenLengthBlock(literalCount, lengthSymbol, distanceSymbol) {
  const writer = createLsbBitWriter();
  writer.bits(1, 1).bits(1, 2);
  for (let index = 0; index < literalCount; index += 1) {
    writeFixedLiteral(writer, 65);
  }
  writeFixedLiteral(writer, lengthSymbol);
  writer.bits(reverseBits(distanceSymbol, 5), 5);
  writeFixedLiteral(writer, 256);
  return writer.finish();
}

function writeFixedLiteral(writer, symbol) {
  let code;
  let length;
  if (symbol <= 143) {
    code = 0x30 + symbol;
    length = 8;
  } else if (symbol <= 255) {
    code = 0x190 + symbol - 144;
    length = 9;
  } else if (symbol <= 279) {
    code = symbol - 256;
    length = 7;
  } else {
    code = 0xc0 + symbol - 280;
    length = 8;
  }
  writer.bits(reverseBits(code, length), length);
}

function canonicalCodes(lengths) {
  const counts = new Array(16).fill(0);
  for (const length of lengths) if (length > 0) counts[length] += 1;
  const next = new Array(16).fill(0);
  let code = 0;
  for (let bits = 1; bits <= 15; bits += 1) {
    code = (code + counts[bits - 1]) << 1;
    next[bits] = code;
  }
  return lengths.map((length) => {
    if (length === 0) return undefined;
    const canonical = next[length];
    next[length] += 1;
    return [reverseBits(canonical, length), length];
  });
}

function writeCanonicalSymbol(writer, codes, symbol) {
  const entry = codes[symbol];
  if (entry === undefined) throw new Error(`no Huffman code for symbol ${symbol}`);
  writer.bits(entry[0], entry[1]);
}

function reverseBits(value, width) {
  let result = 0;
  for (let index = 0; index < width; index += 1) {
    result = (result << 1) | ((value >>> index) & 1);
  }
  return result;
}

function createLsbBitWriter() {
  const bits = [];
  return {
    bits(value, count) {
      for (let bit = 0; bit < count; bit += 1) {
        bits.push((value >>> bit) & 1);
      }
      return this;
    },
    finish() {
      const bytes = new Uint8Array(Math.ceil(bits.length / 8));
      for (let index = 0; index < bits.length; index += 1) {
        bytes[Math.floor(index / 8)] |= bits[index] << (index & 7);
      }
      return bytes;
    }
  };
}

export function filterRgba(rgba, width, height, filter) {
  const stride = width * 4;
  const output = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const target = y * (stride + 1);
    output[target] = filter;
    for (let x = 0; x < stride; x += 1) {
      const raw = rgba[row + x];
      const left = x < 4 ? 0 : rgba[row + x - 4];
      const up = y === 0 ? 0 : rgba[row - stride + x];
      const upperLeft = y === 0 || x < 4 ? 0 : rgba[row - stride + x - 4];
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      output[target + 1 + x] = (raw - predictor) & 0xff;
    }
  }
  return output;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance ? up : upperLeft;
}

export function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  writeUint32BE(result, 0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  writeUint32BE(
    result,
    8 + data.length,
    crc32(result.subarray(4, 8 + data.length))
  );
  return result;
}

export function mutateIdat(png, mutate) {
  const output = png.slice();
  const idat = findChunk(output, "IDAT");
  const zlib = output.slice(idat.dataOffset, idat.dataOffset + idat.length);
  mutate(zlib);
  output.set(zlib, idat.dataOffset);
  writeUint32BE(
    output,
    idat.dataOffset + idat.length,
    crc32(output.subarray(idat.offset + 4, idat.dataOffset + idat.length))
  );
  return output;
}

export function findChunk(png, expected) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = readUint32BE(png, offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (type === expected) {
      return { offset, dataOffset: offset + 8, length };
    }
    offset += 12 + length;
  }
  throw new Error(`PNG has no ${expected} chunk`);
}

export function parseChunks(png) {
  const result = new Map();
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = readUint32BE(png, offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    result.set(type, png.slice(offset, offset + 12 + length));
    offset += 12 + length;
  }
  return result;
}

export function concatenate(parts) {
  const filtered = parts.filter((part) => part !== undefined);
  const output = new Uint8Array(
    filtered.reduce((total, part) => total + part.length, 0)
  );
  let offset = 0;
  for (const part of filtered) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function readUint32BE(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

export function writeUint32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
