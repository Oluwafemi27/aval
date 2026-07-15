import type { IncomingMessage, ServerResponse } from "node:http";

import type { DevServerBuild } from "./dev-server-model.js";
import { writeError } from "./dev-http-response.js";

const MAX_CLIENTS = 32;
const MAX_CLIENT_BUFFER = 65_536;
const MAX_SSE_EVENT_BYTES = 65_536;

export interface DevEventStreamHub {
  connect(request: IncomingMessage, response: ServerResponse, method: string, current: Readonly<DevServerBuild> | null): void;
  publish(build: Readonly<DevServerBuild>): void;
  close(): void;
}

export function createDevEventStreamHub(): DevEventStreamHub {
  const clients = new Map<ServerResponse, () => void>();
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;
  return Object.freeze({
    connect(request: IncomingMessage, response: ServerResponse, method: string, current: Readonly<DevServerBuild> | null): void {
      if (closed) return writeError(response, method, 503, "server-closed");
      if (method === "HEAD") {
        response.setHeader("Allow", "GET");
        return writeError(response, method, 405, "event-stream-get-only");
      }
      if (clients.size >= MAX_CLIENTS) return writeError(response, method, 429, "too-many-clients");
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Connection", "keep-alive");
      const remove = register(request, response);
      try {
        response.flushHeaders();
      } catch {
        remove();
        response.destroy();
        return;
      }
      startHeartbeat();
      if (current !== null && !writeBuildEvent(response, current)) drop(response);
    },
    publish(build: Readonly<DevServerBuild>): void {
      if (closed) return;
      for (const client of [...clients.keys()]) if (!writeBuildEvent(client, build)) drop(client);
      stopHeartbeatIfIdle();
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (heartbeat !== null) clearInterval(heartbeat);
      heartbeat = null;
      for (const client of [...clients.keys()]) end(client);
    }
  });

  function register(request: IncomingMessage, response: ServerResponse): () => void {
    let removed = false;
    const remove = (): void => {
      if (removed) return;
      removed = true;
      clients.delete(response);
      request.removeListener("aborted", remove);
      response.removeListener("close", remove);
      response.removeListener("error", remove);
      stopHeartbeatIfIdle();
    };
    clients.set(response, remove);
    request.once("aborted", remove);
    response.once("close", remove);
    response.once("error", remove);
    return remove;
  }

  function startHeartbeat(): void {
    if (heartbeat !== null) return;
    heartbeat = setInterval(() => {
      for (const client of [...clients.keys()]) if (!writeEventBytes(client, ": ping\n\n")) drop(client);
      stopHeartbeatIfIdle();
    }, 15_000);
    heartbeat.unref();
  }

  function stopHeartbeatIfIdle(): void {
    if (clients.size !== 0 || heartbeat === null) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }

  function end(response: ServerResponse): void {
    clients.get(response)?.();
    try {
      response.end();
    } catch {
      response.destroy();
    }
  }

  function drop(response: ServerResponse): void {
    clients.get(response)?.();
    response.destroy();
  }
}

export function writeBuildEvent(response: ServerResponse, build: Readonly<DevServerBuild>): boolean {
  const event = `event: build\ndata: ${JSON.stringify({
    generation: build.generation,
    src: `asset.avl#v=${String(build.generation)}`,
    bytes: build.bytes,
    sha256: build.sha256,
    warnings: build.warnings,
    report: build.report ?? null
  })}\n\n`;
  if (Buffer.byteLength(event) > MAX_SSE_EVENT_BYTES) return false;
  return writeEventBytes(response, event);
}

function writeEventBytes(response: ServerResponse, event: string): boolean {
  if (response.destroyed || response.writableEnded || response.writableLength + Buffer.byteLength(event) > MAX_CLIENT_BUFFER) return false;
  try {
    return response.write(event);
  } catch {
    return false;
  }
}
