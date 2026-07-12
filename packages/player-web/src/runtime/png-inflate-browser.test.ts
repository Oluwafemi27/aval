import { validatePngProfile } from "@rendered-motion/format";
import { describe, expect, it } from "vitest";

import { strictTestPng } from "./asset-test-fixture.js";
import { createBrowserPngNativeInflater } from "./png-inflate-browser.js";

describe("browser PNG native inflate boundary", () => {
  it("reports constructor capability before any decode", () => {
    let probes = 0;
    const inflater = createBrowserPngNativeInflater(() => {
      probes += 1;
      throw new TypeError("unsupported");
    });

    expect(inflater.supported).toBe(false);
    expect(probes).toBe(1);
  });

  it("inflates a validated zlib member with an exact output cap when supported", async () => {
    const inflater = createBrowserPngNativeInflater();
    if (!inflater.supported) return;
    const plan = validatePngProfile({
      png: strictTestPng(4, 3),
      expectedWidth: 4,
      expectedHeight: 3
    });

    const filtered = await inflater.inflate(
      plan.copyZlibBytes(),
      plan.expectedFilteredBytes,
      new AbortController().signal
    );

    expect(filtered).toHaveLength(plan.expectedFilteredBytes);
    expect(filtered.filter((value) => value === 255)).toHaveLength(12);
  });

  it("writes the caller-owned zlib view without another JavaScript copy", async () => {
    let written: Uint8Array | null = null;
    const factory = () => {
      let readable!: ReadableStreamDefaultController<Uint8Array>;
      return {
        readable: new ReadableStream<Uint8Array>({
          start(controller) {
            readable = controller;
          }
        }),
        writable: new WritableStream<BufferSource>({
          write(chunk) {
            written = chunk as Uint8Array;
            readable.enqueue(new Uint8Array(5));
          },
          close() {
            readable.close();
          }
        })
      } as DecompressionStream;
    };
    const inflater = createBrowserPngNativeInflater(factory);
    const zlib = new Uint8Array(new ArrayBuffer(7));

    await expect(inflater.inflate(
      zlib,
      5,
      new AbortController().signal
    )).resolves.toHaveLength(5);
    expect(written).not.toBeNull();
    expect(written!.buffer).toBe(zlib.buffer);
    expect(written!.byteOffset).toBe(zlib.byteOffset);
    expect(written!.byteLength).toBe(zlib.byteLength);
  });

  it("cancels both stream directions after bounded output rejection", async () => {
    let readableCancelled = 0;
    let writableAborted = 0;
    const factory = () => {
      let readable!: ReadableStreamDefaultController<Uint8Array>;
      return {
        readable: new ReadableStream<Uint8Array>({
          start(controller) {
            readable = controller;
          },
          cancel() {
            readableCancelled += 1;
          }
        }),
        writable: new WritableStream<BufferSource>({
          write() {
            readable.enqueue(new Uint8Array(6));
          },
          abort() {
            writableAborted += 1;
          }
        })
      } as DecompressionStream;
    };
    const inflater = createBrowserPngNativeInflater(factory);

    await expect(inflater.inflate(
      new Uint8Array(7),
      5,
      new AbortController().signal
    )).rejects.toMatchObject({ code: "PNG_DEFLATE_INVALID" });
    expect(readableCancelled).toBe(1);
    expect(writableAborted).toBe(1);
  });
});
