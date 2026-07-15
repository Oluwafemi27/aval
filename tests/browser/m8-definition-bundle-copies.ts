import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { build } from "vite";

export interface IndependentElementBundle {
  readonly id: "copy-a" | "copy-b";
  readonly code: string;
  readonly bytes: number;
  readonly sha256: string;
}

const ELEMENT_ENTRY = fileURLToPath(new URL("../../packages/element/src/index.ts", import.meta.url));
const SOURCE_ALIASES = Object.freeze([
  alias("@aval/player-web", "../../packages/player-web/src/index.ts"),
  alias("@aval/format", "../../packages/format/src/index.ts"),
  alias("@aval/graph", "../../packages/graph/src/index.ts")
]);

/** Build two isolated single-file ESM copies without writing artifacts to disk. */
export async function buildIndependentElementBundles(): Promise<readonly [IndependentElementBundle, IndependentElementBundle]> {
  const copyA = await buildCopy("copy-a");
  const copyB = await buildCopy("copy-b");
  return Object.freeze([copyA, copyB] as const);
}

async function buildCopy(id: IndependentElementBundle["id"]): Promise<IndependentElementBundle> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    mode: "production",
    resolve: { alias: SOURCE_ALIASES },
    build: {
      write: false,
      target: "esnext",
      minify: "oxc",
      sourcemap: false,
      lib: { entry: ELEMENT_ENTRY, formats: ["es"], fileName: id },
      rollupOptions: { output: { codeSplitting: false } }
    }
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((output) => {
    if (!("output" in output)) return [];
    return output.output.flatMap((item) => item.type === "chunk" && item.isEntry ? [item] : []);
  });
  if (chunks.length !== 1) throw new Error(`${id} did not produce exactly one entry chunk`);
  const chunk = chunks[0]!;
  if (chunk.imports.length !== 0 || chunk.dynamicImports.some((fileName) => fileName !== chunk.fileName)) throw new Error(`${id} retained external module dependencies`);
  const bytes = Buffer.byteLength(chunk.code);
  if (bytes < 1 || bytes > 4 * 1024 * 1024) throw new Error(`${id} bundle size is outside test bounds`);
  return Object.freeze({ id, code: chunk.code, bytes, sha256: createHash("sha256").update(chunk.code).digest("hex") });
}

function alias(find: string, relativePath: string): Readonly<{ find: string; replacement: string }> {
  return Object.freeze({ find, replacement: fileURLToPath(new URL(relativePath, import.meta.url)) });
}
