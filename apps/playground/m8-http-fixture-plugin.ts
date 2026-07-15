import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

const SESSION = /^[A-Za-z0-9_-]{1,64}$/u;
const FIXTURES = new Set(["one-state", "user-states"]);
const MAX_SESSIONS = 128;
const MAX_REQUESTS = 128;

/** Exact local M8 success transport; hostile transport cases remain the M7 fixture authority. */
export function m8HttpFixturePlugin(): Plugin {
  const paths = {
    "one-state": fileURLToPath(new URL(
      "../../fixtures/conformance/m8/one-state-partial-loop.avl",
      import.meta.url
    )),
    "user-states": fileURLToPath(new URL(
      "../../fixtures/conformance/m8/user-states-all-routes-alpha.avl",
      import.meta.url
    ))
  } as const;
  const assets = new Map<string, Readonly<{
    bytes: Buffer;
    digest: string;
    etag: string;
  }>>();
  const sessions = new Map<string, Array<Readonly<{
    fixture: string;
    range: string | null;
    status: number;
    credentialPresent?: boolean;
  }>>>();
  let loadPromise: Promise<void> | null = null;

  function loadAssets(): Promise<void> {
    return loadPromise ??= (async () => {
      for (const [id, path] of Object.entries(paths)) {
        const bytes = await readFile(path);
        const digest = createHash("sha256").update(bytes).digest("hex");
        assets.set(id, Object.freeze({
          bytes,
          digest,
          etag: `"m8-${digest}"`
        }));
      }
    })();
  }

  function installServer(server: ViteDevServer | PreviewServer, production: boolean): void {
      const handleRequest = (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void
      ): void => {
        try {
          const url = new URL(request.url ?? "/", "http://m8.invalid");
          if (url.pathname === "/__m8__/bfcache") {
            if (request.method !== "GET") return methodNotAllowed(response);
            if (production) {
              response.statusCode = 302;
              response.setHeader("Location", "/m8-bfcache.html");
              response.setHeader("Cache-Control", "no-store");
              response.end();
              return;
            }
            return writeHtml(response, [
              "<!doctype html><html lang='en'><head><meta charset='UTF-8'>",
              "<title>M8 BFCache proof</title></head><body>",
              "<script type='module' src='/src/m8-bfcache-client.ts'></script>",
              "</body></html>"
            ].join(""));
          }
          if (url.pathname === "/__m8__/bfcache-away") {
            if (request.method !== "GET") return methodNotAllowed(response);
            return writeHtml(response, "<!doctype html><title>Away</title><p>away</p>");
          }
          if (url.pathname === "/__m8__/metrics") {
            if (request.method !== "GET") return methodNotAllowed(response);
            const session = requireParameter(url, "session", SESSION);
            return writeJson(response, { requests: sessions.get(session) ?? [] });
          }
          if (url.pathname !== "/__m8__/asset") {
            next();
            return;
          }
          const cors = url.searchParams.get("cors");
          if (cors !== null && cors !== "anonymous" && cors !== "credentials") {
            throw new RangeError("unknown M8 CORS mode");
          }
          if (request.method === "OPTIONS" && cors !== null) {
            applyCors(request, response, cors);
            response.statusCode = 204;
            response.setHeader("Access-Control-Allow-Methods", "GET");
            response.setHeader("Access-Control-Allow-Headers", "Range, If-Range");
            response.setHeader("Access-Control-Max-Age", "60");
            response.end();
            return;
          }
          if (request.method !== "GET") return methodNotAllowed(response);
          if (cors !== null) applyCors(request, response, cors);
          const session = requireParameter(url, "session", SESSION);
          const fixture = requireParameter(url, "fixture", null);
          if (!FIXTURES.has(fixture)) throw new RangeError("unknown M8 fixture");
          const asset = assets.get(fixture);
          if (asset === undefined) throw new Error("M8 fixture is not loaded");
          let records = sessions.get(session);
          if (records === undefined) {
            if (sessions.size >= MAX_SESSIONS) return writeError(response, 429, "too-many-sessions");
            records = [];
            sessions.set(session, records);
          }
          if (records.length >= MAX_REQUESTS) return writeError(response, 429, "too-many-requests");
          const requireCredential = url.searchParams.get("requireCredential") === "1";
          if (
            url.searchParams.has("requireCredential") &&
            !requireCredential
          ) throw new RangeError("invalid credential proof mode");
          const credentialPresent = hasCredentialSentinel(request);
          if (requireCredential && !credentialPresent) {
            records.push(Object.freeze({
              fixture,
              range: header(request, "range"),
              status: 403,
              credentialPresent: false
            }));
            return writeError(response, 403, "credential-required");
          }
          const rangeHeader = header(request, "range");
          const range = rangeHeader === null
            ? null
            : parseRange(rangeHeader, asset.bytes.byteLength);
          if (rangeHeader !== null && range === null) {
            records.push(Object.freeze({ fixture, range: rangeHeader, status: 416 }));
            response.setHeader("Content-Range", `bytes */${String(asset.bytes.byteLength)}`);
            return writeError(response, 416, "invalid-range");
          }
          const start = range?.start ?? 0;
          const end = range?.end ?? asset.bytes.byteLength - 1;
          const body = asset.bytes.subarray(start, end + 1);
          const status = range === null ? 200 : 206;
          records.push(Object.freeze({
            fixture,
            range: rangeHeader,
            status,
            ...(requireCredential ? { credentialPresent: true } : {})
          }));
          response.statusCode = status;
          response.setHeader("Content-Type", "application/vnd.aval");
          response.setHeader("Content-Encoding", "identity");
          response.setHeader("Accept-Ranges", "bytes");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("ETag", asset.etag);
          response.setHeader("Content-Length", body.byteLength);
          if (range !== null) {
            response.setHeader(
              "Content-Range",
              `bytes ${String(start)}-${String(end)}/${String(asset.bytes.byteLength)}`
            );
          }
          response.end(body);
        } catch {
          writeError(response, 400, "invalid-request");
        }
      };
      const crossOriginFixture = createHttpServer((request, response) => {
        handleRequest(request, response, () => {
          writeError(response, 404, "fixture-not-found");
        });
      });
      crossOriginFixture.on("clientError", (_error, socket) => {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      });
      server.httpServer?.once("listening", () => {
        crossOriginFixture.listen(crossOriginPort(server), "127.0.0.1");
      });
      server.httpServer?.once("close", () => { crossOriginFixture.close(); });
      server.middlewares.use(handleRequest);
  }

  return {
    name: "aval-m8-http-fixture",
    enforce: "pre",
    async buildStart() {
      await loadAssets();
    },
    configureServer(server) {
      installServer(server, false);
    },
    async configurePreviewServer(server) {
      await loadAssets();
      installServer(server, true);
    }
  };
}

function crossOriginPort(server: ViteDevServer | PreviewServer): number {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("M8 fixture requires a bound TCP playground server");
  }
  const port = address.port + 1;
  if (!Number.isSafeInteger(port) || port > 65_535) throw new RangeError("M8 cross-origin fixture port is unavailable");
  return port;
}

function hasCredentialSentinel(request: IncomingMessage): boolean {
  const cookie = header(request, "cookie");
  return cookie !== null && cookie.split(";").some((part) =>
    part.trim() === "aval_m8_credential=present"
  );
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  mode: "anonymous" | "credentials"
): void {
  const origin = header(request, "origin");
  if (origin === null || !/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+$/u.test(origin)) {
    throw new RangeError("invalid M8 CORS origin");
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag");
  response.setHeader("Vary", "Origin");
  if (mode === "credentials") {
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

function parseRange(value: string, length: number): Readonly<{
  start: number;
  end: number;
}> | null {
  const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/u.exec(value);
  if (match === null) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
    start >= 0 && end >= start && end < length
    ? Object.freeze({ start, end })
    : null;
}

function requireParameter(url: URL, name: string, pattern: RegExp | null): string {
  const value = url.searchParams.get(name);
  if (value === null || value === "" || (pattern !== null && !pattern.test(value))) {
    throw new RangeError(`invalid M8 ${name}`);
  }
  return value;
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function methodNotAllowed(response: ServerResponse): void {
  response.setHeader("Allow", "GET");
  writeError(response, 405, "method-not-allowed");
}

function writeJson(response: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function writeHtml(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function writeError(response: ServerResponse, status: number, code: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: code }));
}
