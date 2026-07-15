import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";

import { readBoundedFile, type BoundedReadAdmission } from "./dev-file-reader.js";
import { writeError } from "./dev-http-response.js";
import { MAX_ASSET_BYTES, type DevServerBuild } from "./dev-server-model.js";

export async function servePublishedAsset(input: Readonly<{
  response: ServerResponse;
  method: string;
  rangeHeader: string | undefined;
  ifRangeHeader: string | string[] | undefined;
  assetPath: string;
  published: Readonly<DevServerBuild>;
  current: () => Readonly<DevServerBuild> | null;
  admission: BoundedReadAdmission;
}>): Promise<void> {
  const read = await readBoundedFile(input.assetPath, MAX_ASSET_BYTES, input.admission);
  if (read.status === "busy") return writeError(input.response, input.method, 503, "server-busy");
  if (read.status !== "ok") return writeError(input.response, input.method, 503, "build-changing");
  if (
    input.current() !== input.published ||
    read.bytes.byteLength !== input.published.bytes ||
    createHash("sha256").update(read.bytes).digest("hex") !== input.published.sha256
  ) return writeError(input.response, input.method, 503, "build-changing");
  serveAssetRange(input.response, input.method, input.rangeHeader, input.ifRangeHeader, read.bytes, input.published.sha256);
}

export function serveAssetRange(
  response: ServerResponse,
  method: string,
  rangeHeader: string | undefined,
  ifRangeHeader: string | string[] | undefined,
  bytes: Buffer,
  sha256: string
): void {
  const etag = `"aval-${sha256}"`;
  const honorRange = rangeHeader !== undefined && (ifRangeHeader === undefined || ifRangeHeader === etag);
  const range = !honorRange ? null : parseRange(rangeHeader, bytes.byteLength);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("ETag", etag);
  if (honorRange && range === null) {
    response.setHeader("Content-Range", `bytes */${String(bytes.byteLength)}`);
    writeError(response, method, 416, "invalid-range");
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? bytes.byteLength - 1;
  const body = bytes.subarray(start, end + 1);
  response.statusCode = range === null ? 200 : 206;
  response.setHeader("Content-Type", "application/vnd.aval");
  response.setHeader("Content-Encoding", "identity");
  response.setHeader("Content-Length", body.byteLength);
  if (range !== null) response.setHeader("Content-Range", `bytes ${String(start)}-${String(end)}/${String(bytes.byteLength)}`);
  if (method === "HEAD") response.end();
  else response.end(body);
}

export function parseAssetRange(value: string, length: number): Readonly<{ start: number; end: number }> | null {
  const match = /^bytes=([0-9]+)-([0-9]+)$/u.exec(value);
  if (match === null) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end < length
    ? Object.freeze({ start, end })
    : null;
}

function parseRange(value: string, length: number): Readonly<{ start: number; end: number }> | null {
  return parseAssetRange(value, length);
}
