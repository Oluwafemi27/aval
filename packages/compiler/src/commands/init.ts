import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { serializeCanonicalJson } from "@pixel-point/aval-format";
import type { InitCliArguments } from "../cli-args.js";
import { sha256Hex } from "../compile/hash.js";
import { encodeCanonicalRgbaPng } from "../compile/png.js";
import { CompilerError } from "../diagnostics.js";
import { validateSourceProject } from "../source-project-schema.js";
import { syncDirectory } from "../compile/output.js";
import { publishStagedDirectoryNoReplace } from "./init-publication.js";

export interface InitCommandResult {
  readonly command: "init";
  readonly directory: string;
  readonly project: string;
  readonly files: readonly string[];
}

const PROJECT_FILE = "motion.json";
const FRAME_COUNT = 22;

export interface InitCommandDependencies {
  readonly beforePublish?: (
    targetDirectory: string,
    stagedDirectory: string
  ) => void | Promise<void>;
  readonly platform?: NodeJS.Platform;
  readonly publicationSyncDirectory?: (path: string) => Promise<void>;
}

/** Create the deterministic, transparent idle/hover M8 starter atomically. */
export async function runInitCommand(
  arguments_: InitCliArguments,
  cwd: string,
  dependencies: Readonly<InitCommandDependencies> = {}
): Promise<Readonly<InitCommandResult>> {
  const directory = resolve(cwd, arguments_.directory);
  const parent = dirname(directory);
  await assertAbsent(directory);
  await mkdir(parent, { recursive: true, mode: 0o755 });
  let temporary = "";
  try {
    temporary = await mkdtemp(join(parent, `.${basename(directory)}.avl-init-`));
    const project = starterProject();
    validateSourceProject(project);
    const projectBytes = serializeCanonicalJson(project);
    const frames = Array.from({ length: FRAME_COUNT }, (_, index) =>
      starterFrame(index)
    );
    const frameFiles = frames.map((_, index) =>
      `frames/frame-${String(index).padStart(4, "0")}.png`
    );
    const files = Object.freeze([
      PROJECT_FILE,
      "README.md",
      "ASSET-LICENSE.md",
      "provenance.json",
      "package.json",
      "index.html",
      "main.js",
      ...frameFiles
    ]);
    const provenance = Object.freeze({
      provenanceVersion: "0.1",
      generator: "@pixel-point/aval-compiler init idle-hover-v2",
      license: "CC0-1.0",
      project: Object.freeze({
        path: PROJECT_FILE,
        bytes: projectBytes.byteLength,
        sha256: sha256Hex(projectBytes)
      }),
      frames: Object.freeze(frames.map((bytes, index) => Object.freeze({
        path: frameFiles[index]!,
        bytes: bytes.byteLength,
        sha256: sha256Hex(bytes)
      })))
    });
    const outputs = new Map<string, Uint8Array>([
      [PROJECT_FILE, projectBytes],
      ["README.md", text(README)],
      ["ASSET-LICENSE.md", text(ASSET_LICENSE)],
      ["provenance.json", serializeCanonicalJson(provenance)],
      ["package.json", serializeCanonicalJson(STARTER_PACKAGE)],
      ["index.html", text(HTML_EXAMPLE)],
      ["main.js", text(STARTER_SCRIPT)]
    ]);
    for (let index = 0; index < frames.length; index += 1) {
      outputs.set(frameFiles[index]!, frames[index]!);
    }
    await mkdir(join(temporary, "frames"), { mode: 0o755 });
    for (const relative of files) {
      await writeSyncedFile(join(temporary, relative), outputs.get(relative)!);
    }
    await syncDirectory(join(temporary, "frames"));
    await syncDirectory(temporary);
    await dependencies.beforePublish?.(directory, temporary);
    await publishStagedDirectoryNoReplace(
      temporary,
      directory,
      dependencies.platform,
      dependencies.publicationSyncDirectory
    );
    temporary = "";
    return Object.freeze({
      command: "init" as const,
      directory,
      project: resolve(directory, PROJECT_FILE),
      files
    });
  } catch (error) {
    if (temporary !== "") {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof CompilerError) throw error;
    throw new CompilerError("IO_FAILED", "Could not create init project", {
      path: directory,
      cause: error,
      hint: "Choose a new path; init never overwrites an existing directory."
    });
  }
}

async function writeSyncedFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "wx", 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== bytes.byteLength) {
      throw new Error(`incomplete init file: ${path}`);
    }
  } finally {
    await handle.close();
  }
}

function starterProject(): Record<string, unknown> {
  return {
    projectVersion: "0.3",
    profile: "avc-annexb-auto-v1",
    canvas: {
      width: 48,
      height: 48,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    sources: [{
      id: "generated",
      type: "png-sequence",
      directory: "frames",
      prefix: "frame-",
      digits: 4,
      suffix: ".png",
      firstNumber: 0,
      frameCount: FRAME_COUNT
    }],
    renditions: [{
      id: "avc.1x",
      width: 48,
      height: 48,
      encoding: {
        codec: "h264",
        preset: "slow",
        rateControl: { mode: "crf", crf: 1, maxBitrate: 800_000 }
      }
    }],
    units: [
      {
        id: "idle.body",
        kind: "body",
        source: "generated",
        range: [0, 8],
        playback: "loop",
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      },
      {
        id: "engage.shift",
        kind: "reversible",
        source: "generated",
        range: [8, 14],
        residency: {
          endpoints: [
            { state: "idle", port: "default", frames: 6 },
            { state: "engaged", port: "default", frames: 6 }
          ]
        }
      },
      {
        id: "engaged.body",
        kind: "body",
        source: "generated",
        range: [14, 22],
        playback: "loop",
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      }
    ],
    initialState: "idle",
    states: [
      { id: "idle", bodyUnit: "idle.body" },
      { id: "engaged", bodyUnit: "engaged.body" }
    ],
    edges: [
      {
        id: "idle.engaged",
        from: "idle",
        to: "engaged",
        trigger: { type: "event", name: "control.engage" },
        start: {
          type: "portal",
          sourcePort: "default",
          targetPort: "default",
          maxWaitFrames: 12
        },
        transition: {
          kind: "reversible",
          unit: "engage.shift",
          direction: "forward"
        },
        continuity: "exact-authored"
      },
      {
        id: "engaged.idle",
        from: "engaged",
        to: "idle",
        trigger: { type: "event", name: "control.release" },
        start: {
          type: "portal",
          sourcePort: "default",
          targetPort: "default",
          maxWaitFrames: 12
        },
        transition: {
          kind: "reversible",
          unit: "engage.shift",
          direction: "reverse",
          reverseOf: "idle.engaged"
        },
        continuity: "exact-reverse"
      }
    ],
    bindings: [
      { source: "engagement.off", event: "control.release" },
      { source: "engagement.on", event: "control.engage" }
    ]
  };
}

function starterFrame(index: number): Uint8Array {
  const width = 48;
  const height = 48;
  const rgba = new Uint8Array(width * height * 4);
  // The reversible unit contains only in-between poses. Repeating either
  // resident endpoint inside the bridge would create a visible stop when the
  // direction flips, and the compiler correctly rejects that duplicate.
  const resident = index < 8 || index >= 14;
  const residentFrame = index < 8 ? index : index - 14;
  const progress = index < 8 ? 0 : index < 14 ? (index - 7) / 7 : 1;
  const centerX = Math.round(15 + progress * 18);
  // Sample a complete eight-frame period without duplicating either endpoint.
  // Frame zero remains the exact authored bridge pose; the final-to-first loop
  // boundary is the next ordinary one-pixel motion step, not a seek or pause.
  const centerY = 24 + (resident
    ? Math.round(Math.sin((residentFrame * Math.PI * 2) / 8))
    : 0);
  const radius = Math.round(7 + progress * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
      const inside = distance <= radius ** 2;
      const halo = !inside && distance <= (radius + 3) ** 2;
      rgba[offset] = inside ? 104 : halo ? 92 : 0;
      rgba[offset + 1] = inside ? Math.round(126 + 80 * progress) : halo ? 108 : 0;
      rgba[offset + 2] = inside ? 255 : halo ? 246 : 0;
      rgba[offset + 3] = inside ? 255 : halo ? 96 : 0;
    }
  }
  return encodeCanonicalRgbaPng({ width, height, rgba });
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new CompilerError("IO_FAILED", "Init directory already exists", {
    path,
    hint: "Choose a new path; init never overwrites files."
  });
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const STARTER_PACKAGE = Object.freeze({
  name: "aval-idle-hover-starter",
  private: true,
  type: "module",
  scripts: {
    build: "avl compile motion.json --out starter.avl",
    validate: "avl validate starter.avl",
    dev: "avl dev motion.json --out starter.avl --force"
  },
  dependencies: {
    "@pixel-point/aval-compiler": "1.0.0",
    "@pixel-point/aval-element": "1.0.0"
  }
});

const README = `# AVAL idle/hover starter

The state names (\`idle\` and \`engaged\`) and event names
(\`control.engage\` and \`control.release\`) are ordinary author data. The
runtime does not contain a special hover state.

Build and validate locally:

\`\`\`sh
npm install
npm run build
npm run validate
npm run dev
\`\`\`

\`npm run dev\` is the zero-config compiler/watch/browser workflow. The included
\`index.html\` is the equivalent bundler entry: its npm package import is resolved
by Vite, Parcel, Webpack, and other package-aware web tooling. It demonstrates
a native button as the semantic interaction target and a light-DOM fallback.

The generated RGBA frames are CC0-1.0 and their exact provenance is recorded
in \`provenance.json\`. No upload, account, framework, or remote asset is
required.
`;

const HTML_EXAMPLE = `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><title>Idle/hover AVAL</title></head>
<body>
  <button id="favorite" type="button">
    <aval-player src="./starter.avl" interaction-for="favorite" aria-hidden="true">
      <img slot="fallback" src="./frames/frame-0000.png" alt="" width="48" height="48">
    </aval-player>
    <span>Favorite</span>
  </button>
  <script type="module" src="./main.js"></script>
</body>
</html>
`;

const STARTER_SCRIPT = `import "@pixel-point/aval-element/auto";
`;

const ASSET_LICENSE = `# Generated starter asset license

The RGBA PNG frames in this directory are generated procedurally by the
AVAL compiler and contain no third-party artwork. To the extent
possible under law, the generator's authors waive copyright and related rights
in those generated example frames under CC0 1.0 Universal.

https://creativecommons.org/publicdomain/zero/1.0/
`;
