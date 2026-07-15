import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { CompilerError } from "../diagnostics.js";
import { createDevEventStreamHub } from "./dev-event-stream.js";
import { createBoundedReadAdmission } from "./dev-file-reader.js";
import { createPackageModuleStore } from "./dev-package-modules.js";
import type { DevRequestAuthority } from "./dev-request-security.js";
import { createDevServerRequestHandler } from "./dev-server-router.js";
import { normalizePublishedBuild, type DevServerBuild } from "./dev-server-model.js";

export type { DevServerBuild, DevServerReport } from "./dev-server-model.js";
export { openDevServer, launchDevServerOpener } from "./dev-browser-opener.js";
export { createBoundedReadAdmission, isResolvedPathWithinRoot, readOpenedFile, resolveRealPathWithinRoot } from "./dev-file-reader.js";
export { createPackageModuleStore, findOwningPackageRoot, resolveCompilerPackageEntry } from "./dev-package-modules.js";
export type { BoundedReadAdmission } from "./dev-file-reader.js";
export type { PackageEntryResolution, PackageEntryResolver, PackageModuleStore } from "./dev-package-modules.js";

export interface DevServer {
  /** Complete opaque, copyable browser URL. All routes are relative to it. */
  readonly url: string;
  /** Resolves on an intentional close and rejects if the bound server dies. */
  readonly closed: Promise<void>;
  publish(build: Readonly<DevServerBuild>): void;
  close(): Promise<void>;
}

const MAX_CONCURRENT_MODULE_READS = 8;

export async function startDevServer(options: Readonly<{
  assetPath: string;
  port?: number;
  host?: "127.0.0.1" | "::1";
  createHttpServer?: typeof createServer;
}>): Promise<DevServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4174;
  validateOptions(options.assetPath, host, port);
  const modules = await createPackageModuleStore();
  const eventStreams = createDevEventStreamHub();
  const assetReads = createBoundedReadAdmission(1);
  const moduleReads = createBoundedReadAdmission(MAX_CONCURRENT_MODULE_READS);
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionPath = `/${sessionToken}/`;
  let authority: DevRequestAuthority | null = null;
  let current: Readonly<DevServerBuild> | null = null;
  let isClosed = false;
  let resolveClosed!: () => void;
  let rejectClosed!: (error: unknown) => void;
  let completionSettled = false;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  void closed.catch(() => undefined);
  let closeOperation: Promise<void> | null = null;
  const server = (options.createHttpServer ?? createServer)(createDevServerRequestHandler({
    sessionPath,
    assetPath: options.assetPath,
    authority: () => authority,
    current: () => current,
    eventStreams,
    modules,
    assetReads,
    moduleReads
  }));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    else socket.destroy();
  });
  await bind(server, port, host);
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new CompilerError("IO_FAILED", "Dev server did not expose a TCP address");
  }
  const hostHeader = `${host === "::1" ? "[::1]" : host}:${String(address.port)}`;
  const origin = `http://${hostHeader}`;
  authority = Object.freeze({ hostHeader, origin });
  server.on("error", containRuntimeServerError);
  const url = `${origin}${sessionPath}`;
  return Object.freeze({
    url,
    closed,
    publish(build: Readonly<DevServerBuild>): void {
      if (isClosed) throw new TypeError("dev server is closed");
      current = normalizePublishedBuild(build, current?.generation ?? null);
      eventStreams.publish(current);
    },
    close(): Promise<void> {
      if (closeOperation !== null) return closeOperation;
      isClosed = true;
      eventStreams.close();
      closeOperation = new Promise<void>((resolveClose) => {
        if (!server.listening) {
          settleClosed();
          resolveClose();
          return;
        }
        server.close(() => {
          settleClosed();
          resolveClose();
        });
      });
      return closeOperation;
    }
  });

  function containRuntimeServerError(cause: Error): void {
    if (isClosed) return;
    isClosed = true;
    eventStreams.close();
    server.close(() => undefined);
    if (!completionSettled) {
      completionSettled = true;
      rejectClosed(new CompilerError("IO_FAILED", "Dev server stopped unexpectedly", {
        cause,
        hint: "Restart avl dev after checking the local network and port."
      }));
    }
  }

  function settleClosed(): void {
    if (completionSettled) return;
    completionSettled = true;
    resolveClosed();
  }
}

function validateOptions(assetPath: string, host: string, port: number): void {
  if (host !== "127.0.0.1" && host !== "::1") throw new CompilerError("CLI_USAGE", "Dev server host must be a loopback address");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new CompilerError("CLI_USAGE", "Dev server port must be from 0 through 65535");
  if (typeof assetPath !== "string" || assetPath.trim().length === 0 || assetPath.includes("\0")) throw new CompilerError("CLI_USAGE", "Dev server asset path must be a non-empty file path");
}

async function bind(server: ReturnType<typeof createServer>, port: number, host: "127.0.0.1" | "::1"): Promise<void> {
  await new Promise<void>((resolveBind, reject) => {
    const error = (cause: Error): void => reject(new CompilerError("IO_FAILED", "Could not bind the loopback dev server", {
      cause,
      hint: "Choose another --port or stop the process using it."
    }));
    server.once("error", error);
    server.listen(port, host, () => {
      server.removeListener("error", error);
      resolveBind();
    });
  });
}
