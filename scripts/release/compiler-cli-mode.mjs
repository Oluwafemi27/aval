#!/usr/bin/env node
import { chmod, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NODE_SHEBANG = "#!/usr/bin/env node\n";

export async function ensureCompilerCliExecutable(path) {
  const cli = resolve(path);
  const source = await readFile(cli, "utf8");
  if (!source.startsWith(NODE_SHEBANG)) {
    throw new Error(`refusing to make a non-Node compiler entry point executable: ${cli}`);
  }
  await chmod(cli, 0o755);
  return Object.freeze({ path: cli, mode: 0o755 });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3) {
    throw new Error("usage: compiler-cli-mode.mjs <compiled-cli.js>");
  }
  await ensureCompilerCliExecutable(process.argv[2]);
}
