export interface UnicodeScalar {
  readonly codePoint: number;
  /** Bytes for UTF-8 input, UTF-16 code units for JavaScript strings. */
  readonly width: number;
}

export type UnicodeFailure = (message: string, offset?: number) => never;

export function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

export function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function decodeSurrogatePair(high: number, low: number): number {
  return 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
}

/** Return the number of bytes in the shortest UTF-8 encoding of a scalar. */
export function utf8ScalarWidth(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** Decode one strictly well-formed Unicode scalar from UTF-8 bytes. */
export function readUtf8Scalar(
  bytes: Uint8Array,
  offset: number,
  fail: UnicodeFailure
): UnicodeScalar {
  const first = bytes[offset];
  if (first === undefined) {
    return fail("Truncated UTF-8 sequence", offset);
  }

  if (first <= 0x7f) return { codePoint: first, width: 1 };

  let width: number;
  let minimum: number;
  let codePoint: number;

  if (first >= 0xc2 && first <= 0xdf) {
    width = 2;
    minimum = 0x80;
    codePoint = first & 0x1f;
  } else if (first >= 0xe0 && first <= 0xef) {
    width = 3;
    minimum = 0x800;
    codePoint = first & 0x0f;
  } else if (first >= 0xf0 && first <= 0xf4) {
    width = 4;
    minimum = 0x10000;
    codePoint = first & 0x07;
  } else {
    return fail("Invalid UTF-8 leading byte", offset);
  }

  if (offset + width > bytes.byteLength) {
    return fail("Truncated UTF-8 sequence", offset);
  }

  for (let index = 1; index < width; index += 1) {
    const continuation = bytes[offset + index];
    if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
      return fail("Invalid UTF-8 continuation byte", offset + index);
    }
    codePoint = (codePoint << 6) | (continuation & 0x3f);
  }

  if (
    codePoint < minimum ||
    codePoint > 0x10ffff ||
    isHighSurrogate(codePoint) ||
    isLowSurrogate(codePoint)
  ) {
    return fail("Invalid UTF-8 scalar value", offset);
  }

  return { codePoint, width };
}

/** Read one Unicode scalar from a JavaScript UTF-16 string. */
export function readStringScalar(
  value: string,
  offset: number,
  fail: UnicodeFailure
): UnicodeScalar {
  const first = value.charCodeAt(offset);
  if (Number.isNaN(first)) {
    return fail("Unexpected end of string", offset);
  }
  if (!isHighSurrogate(first) && !isLowSurrogate(first)) {
    return { codePoint: first, width: 1 };
  }
  if (isLowSurrogate(first)) {
    return fail("String contains a lone low surrogate", offset);
  }

  const second = value.charCodeAt(offset + 1);
  if (Number.isNaN(second) || !isLowSurrogate(second)) {
    return fail("String contains a lone high surrogate", offset);
  }
  return {
    codePoint: decodeSurrogatePair(first, second),
    width: 2
  };
}

/** Append the shortest UTF-8 encoding of a Unicode scalar. */
export function pushUtf8Scalar(target: number[], codePoint: number): void {
  if (codePoint <= 0x7f) {
    target.push(codePoint);
  } else if (codePoint <= 0x7ff) {
    target.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
  } else if (codePoint <= 0xffff) {
    target.push(
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f)
    );
  } else {
    target.push(
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f)
    );
  }
}

/** Count UTF-8 bytes while rejecting unpaired UTF-16 surrogates. */
export function utf8ByteLength(value: string, fail: UnicodeFailure): number {
  let length = 0;
  for (let offset = 0; offset < value.length; ) {
    const scalar = readStringScalar(value, offset, fail);
    length += utf8ScalarWidth(scalar.codePoint);
    offset += scalar.width;
  }
  return length;
}

/** Encode a JavaScript string as strict UTF-8. */
export function encodeUtf8String(
  value: string,
  fail: UnicodeFailure
): Uint8Array {
  const bytes: number[] = [];
  for (let offset = 0; offset < value.length; ) {
    const scalar = readStringScalar(value, offset, fail);
    pushUtf8Scalar(bytes, scalar.codePoint);
    offset += scalar.width;
  }
  return Uint8Array.from(bytes);
}

/** Compare byte strings using unsigned lexicographic order. */
export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const leftByte = left[index] ?? 0;
    const rightByte = right[index] ?? 0;
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return left.byteLength - right.byteLength;
}
