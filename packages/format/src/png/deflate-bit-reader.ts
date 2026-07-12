import { FormatError } from "../errors.js";

export class DeflateBitReader {
  readonly #bytes: Uint8Array;
  readonly #workLimit: number;
  #bitOffset = 0;
  #work = 0;

  public constructor(bytes: Uint8Array, workLimit: number) {
    if (!(bytes instanceof Uint8Array)) {
      fail("DEFLATE input must be a Uint8Array");
    }
    if (!Number.isSafeInteger(workLimit) || workLimit < 1) {
      fail("DEFLATE work limit must be a positive safe integer");
    }
    this.#bytes = bytes;
    this.#workLimit = workLimit;
  }

  public get work(): number {
    return this.#work;
  }

  public readBits(count: number, label: string): number {
    if (!Number.isSafeInteger(count) || count < 0 || count > 24) {
      fail(`${label} bit count is invalid`);
    }
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      if (this.#bitOffset >= this.#bytes.byteLength * 8) {
        fail(`${label} is truncated`, this.#bytes.byteLength);
      }
      this.#charge(1);
      const byte = this.#bytes[Math.floor(this.#bitOffset / 8)]!;
      value |= ((byte >>> (this.#bitOffset & 7)) & 1) << bit;
      this.#bitOffset += 1;
    }
    return value;
  }

  public alignToByte(label: string): void {
    const remainder = this.#bitOffset & 7;
    if (remainder === 0) return;
    const padding = this.readBits(8 - remainder, `${label} padding`);
    if (padding !== 0) fail(`${label} padding bits must be zero`);
  }

  public finish(): void {
    this.alignToByte("terminal DEFLATE");
    if (this.#bitOffset !== this.#bytes.byteLength * 8) {
      fail("DEFLATE contains trailing bytes", Math.floor(this.#bitOffset / 8));
    }
  }

  public decodedSymbol(): void {
    this.#charge(1);
  }

  public copiedOutputByte(): void {
    this.#charge(1);
  }

  #charge(amount: number): void {
    if (this.#work > this.#workLimit - amount) {
      fail("DEFLATE work limit exceeded");
    }
    this.#work += amount;
  }
}

export function deflateInvalid(message: string, offset?: number): never {
  fail(message, offset);
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "PNG_DEFLATE_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}
