import { execFileSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseFrontIndex,
  validateCompleteAsset
} from "@rendered-motion/format";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateAssetReport } from "../src/commands/asset.js";
import { compileProjectFile } from "../src/compile/project-compiler.js";
import { discoverFfmpeg } from "../src/ffmpeg/discovery.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const SOURCE_ROOT = join(REPOSITORY_ROOT, "fixtures/compiler/m5/source");
const CONFORMANCE_ROOT = join(REPOSITORY_ROOT, "fixtures/conformance/m5");

const HAS_FFMPEG = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

interface FixtureProvenance {
  readonly toolchain: {
    readonly ffmpeg: { readonly executableSha256: string };
    readonly ffprobe: { readonly executableSha256: string };
  };
}

interface FixtureCase {
  readonly id: "loop" | "path" | "reversible";
  readonly project: string;
  readonly golden: string;
}

const FIXTURES = Object.freeze([
  { id: "loop", project: "loop.json", golden: "opaque-loop.rma" },
  { id: "path", project: "path.json", golden: "opaque-path.rma" },
  {
    id: "reversible",
    project: "reversible.json",
    golden: "opaque-reversible.rma"
  }
] as const satisfies readonly FixtureCase[]);

const ORDER_INSENSITIVE_COLLECTIONS = new Set([
  "bindings",
  "edges",
  "endpoints",
  "portalFrames",
  "ports",
  "renditions",
  "sources",
  "states",
  "units"
]);

type DiscoveredFfmpeg = Awaited<ReturnType<typeof discoverFfmpeg>>;

describe.skipIf(!HAS_FFMPEG)("reviewed FFmpeg conformance fixtures", () => {
  let temporaryRoot = "";
  let tools: DiscoveredFfmpeg;
  let exactReviewedToolPair = false;

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "rma-m5-tool-backed-"));
    const provenance = JSON.parse(
      await readFile(join(CONFORMANCE_ROOT, "provenance.json"), "utf8")
    ) as FixtureProvenance;
    tools = await discoverFfmpeg();
    exactReviewedToolPair =
      tools.executableSha256 === provenance.toolchain.ffmpeg.executableSha256 &&
      tools.ffprobeExecutableSha256 ===
        provenance.toolchain.ffprobe.executableSha256;
  });

  afterAll(async () => {
    if (temporaryRoot !== "") {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each(FIXTURES)(
    "deterministically rebuilds the checked $id fixture across ordering, relocation, and deletion",
    async (fixture) => {
      const originalOutput = join(temporaryRoot, `${fixture.id}-original.rma`);
      const original = await compileAndValidate(
        join(SOURCE_ROOT, fixture.project),
        originalOutput,
        tools
      );

      const reorderedProject = await createRelocatedReorderedProject(
        fixture,
        join(temporaryRoot, `${fixture.id}-relocated-a`)
      );
      const rebuildOutput = join(temporaryRoot, `${fixture.id}-rebuilt.rma`);
      const reordered = await compileAndValidate(
        reorderedProject,
        rebuildOutput,
        tools
      );

      expect(reordered.sha256).toBe(original.sha256);
      expect(reordered.byteLength).toBe(original.byteLength);
      expect(reordered.assetBytes).toEqual(original.assetBytes);

      await rm(rebuildOutput);
      const freshReorderedProject = await createRelocatedReorderedProject(
        fixture,
        join(temporaryRoot, `${fixture.id}-fresh-relocated-b`)
      );
      const rebuilt = await compileAndValidate(
        freshReorderedProject,
        rebuildOutput,
        tools
      );

      expect(rebuilt.sha256).toBe(original.sha256);
      expect(rebuilt.byteLength).toBe(original.byteLength);
      expect(rebuilt.assetBytes).toEqual(original.assetBytes);
      expect(rebuilt.assetBytes).toEqual(reordered.assetBytes);

      if (exactReviewedToolPair) {
        const golden = new Uint8Array(
          await readFile(join(CONFORMANCE_ROOT, fixture.golden))
        );
        expect(original.assetBytes).toEqual(golden);
        expect(reordered.assetBytes).toEqual(golden);
        expect(rebuilt.assetBytes).toEqual(golden);
      }

      if (fixture.id === "path") {
        assertPathPayloadDigests(original.assetBytes, exactReviewedToolPair);
      }
    },
    120_000
  );
});

async function compileAndValidate(
  projectPath: string,
  outputPath: string,
  tools: DiscoveredFfmpeg
): Promise<{
  readonly assetBytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
}> {
  const result = await compileProjectFile({
    projectPath,
    outputPath,
    ffmpegPath: tools.executable,
    ffprobePath: tools.ffprobeExecutable
  });
  const assetBytes = new Uint8Array(await readFile(outputPath));
  expect(result.bytes).toBe(assetBytes.byteLength);
  expect(() => validateCompleteAsset({ bytes: assetBytes })).not.toThrow();
  await expect(validateAssetReport(outputPath)).resolves.toMatchObject({
    command: "validate",
    bytes: result.bytes,
    sha256: result.sha256,
    avcClaim: "syntax-and-dependency-inspected"
  });
  return Object.freeze({
    assetBytes,
    byteLength: result.bytes,
    sha256: result.sha256
  });
}

async function createRelocatedReorderedProject(
  fixture: FixtureCase,
  relocatedRoot: string
): Promise<string> {
  await cp(SOURCE_ROOT, relocatedRoot, { recursive: true });
  const projectPath = join(relocatedRoot, fixture.project);
  const project = JSON.parse(await readFile(projectPath, "utf8")) as unknown;
  await writeFile(
    projectPath,
    `${JSON.stringify(reorderProjectValue(project), null, 2)}\n`
  );
  return projectPath;
}

function reorderProjectValue(value: unknown, collection = ""): unknown {
  if (Array.isArray(value)) {
    const reordered = value.map((child) => reorderProjectValue(child));
    return ORDER_INSENSITIVE_COLLECTIONS.has(collection)
      ? reordered.reverse()
      : reordered;
  }
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .reverse()
    .map(([key, child]) => [key, reorderProjectValue(child, key)] as const);
  return Object.fromEntries(entries);
}

function assertPathPayloadDigests(
  assetBytes: Uint8Array,
  exactReviewedToolPair: boolean
): void {
  if (!exactReviewedToolPair) return;
  const front = parseFrontIndex(assetBytes);
  expect(front.unitBlobs.map(({ unit, sha256 }) => ({ unit, sha256 }))).toEqual([
    { unit: "active-body", sha256: "b5d0e3b4b7e58bee05219132c10f2b6f943077756b9dd3957df56a6bac715d00" },
    { unit: "bridge", sha256: "6c3818115385f4f3564e86f1ecce673ab70caab83271a3c3ae8b17003378b698" },
    { unit: "idle-body", sha256: "0ef19b31deb6d0414f51a0889ad1f4682aaa13a82123f26f9b3b4766fd9d6401" },
    { unit: "intro", sha256: "939dccd46c88c96b1c5aa094d53e6f8b30fa3837ddd2b380a08c387d2e26e775" }
  ]);
  expect(front.staticBlobs.map(({ staticFrame, sha256 }) => ({
    staticFrame,
    sha256
  }))).toEqual([
    { staticFrame: "static.00", sha256: "8162c8df6950f1f7855d02a06938e17c4936f6d9f01f034b99f61f919eb2d0c1" },
    { staticFrame: "static.01", sha256: "75c75688e4ed6bd78f4fd593de44e1dc6789b79a1169c34c72b2fafd7af7e71e" }
  ]);
}
