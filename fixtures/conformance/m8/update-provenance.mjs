import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProjectFile } from "../../../packages/compiler/dist/index.js";
import {
  parseFrontIndex,
  serializeCanonicalJson,
  validateCompleteAsset
} from "../../../packages/format/dist/index.js";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const generatorPath = fileURLToPath(import.meta.url);
const provenancePath = resolve(directory, "provenance.json");
const check = process.argv.includes("--check");
const sourceProjects = {
  loop: resolve(repository, "fixtures/compiler/m6/source/packed-loop.json"),
  routes: resolve(repository, "fixtures/compiler/m6/source/packed-all-routes.json")
};
const sourceFrames = resolve(
  repository,
  "fixtures/compiler/m6/source/packed-frames"
);
const outputs = {
  loop: resolve(directory, "one-state-partial-loop.avl"),
  routes: resolve(directory, "user-states-all-routes-alpha.avl")
};
const ALL_BINDINGS = Object.freeze([
  { source: "activate", event: "activate-loading" },
  { source: "engagement.off", event: "reset" },
  { source: "engagement.on", event: "hover-on" },
  { source: "focus.in", event: "hover-on" },
  { source: "focus.out", event: "cancel-loading" },
  { source: "hidden", event: "hover-off" },
  { source: "pointer.enter", event: "hover-on" },
  { source: "pointer.leave", event: "hover-off" },
  { source: "visible", event: "hover-on" }
]);

const temporary = await mkdtemp(join(tmpdir(), "aval-m8-fixtures-"));
try {
  const [loopBaseBytes, routesBaseBytes] = await Promise.all([
    readFile(sourceProjects.loop),
    readFile(sourceProjects.routes)
  ]);
  const loopProject = JSON.parse(loopBaseBytes.toString("utf8"));
  loopProject.sources[0].directory = "packed-frames";
  loopProject.units = [
    { id: "intro", kind: "one-shot", source: "frames", range: [0, 3] },
    ...loopProject.units
  ];
  loopProject.states = [{ id: "default", bodyUnit: "body", initialUnit: "intro" }];
  const loopProjectBytes = serializeCanonicalJson(loopProject);
  const loopProjectPath = resolve(temporary, "one-state-partial-loop.json");
  const routesProject = JSON.parse(routesBaseBytes.toString("utf8"));
  routesProject.sources[0].directory = "packed-frames";
  routesProject.bindings = ALL_BINDINGS;
  const routesProjectBytes = serializeCanonicalJson(routesProject);
  const routesProjectPath = resolve(temporary, "user-states-all-routes-alpha.json");
  await cp(sourceFrames, resolve(temporary, "packed-frames"), { recursive: true });
  await Promise.all([
    writeFile(loopProjectPath, loopProjectBytes),
    writeFile(routesProjectPath, routesProjectBytes)
  ]);

  const temporaryOutputs = {
    loop: resolve(temporary, "one-state-partial-loop.avl"),
    routes: resolve(temporary, "user-states-all-routes-alpha.avl")
  };
  const [loopResult, routesResult] = await Promise.all([
    compileProjectFile({
      projectPath: loopProjectPath,
      outputPath: temporaryOutputs.loop
    }),
    compileProjectFile({
      projectPath: routesProjectPath,
      outputPath: temporaryOutputs.routes
    })
  ]);
  requireValue(
    loopResult.provenance.versionOutputSha256 === routesResult.provenance.versionOutputSha256 &&
      loopResult.provenance.executableSha256 === routesResult.provenance.executableSha256,
    "M8 fixtures were not built by one FFmpeg toolchain"
  );

  const provenance = {
    provenanceVersion: "0.1",
    formatVersion: "0.1",
    generatedAt: "2026-07-14",
    license: "CC0-1.0 generated fixture sources",
    generatedBy: await digestFile(generatorPath, "fixtures/conformance/m8/update-provenance.mjs"),
    regeneration: {
      build: "npm run build -w @aval/compiler",
      check: "node fixtures/conformance/m8/update-provenance.mjs --check"
    },
    sourceFrames: await frameProvenance(),
    sourceProjects: {
      oneStateBase: await digestFile(
        sourceProjects.loop,
        "fixtures/compiler/m6/source/packed-loop.json"
      ),
      oneStateDerived: {
        generator: "add visible intro frames 0:3 before the partial body loop 3:11",
        bytes: loopProjectBytes.byteLength,
        sha256: sha256(loopProjectBytes)
      },
      userStatesBase: await digestFile(
        sourceProjects.routes,
        "fixtures/compiler/m6/source/packed-all-routes.json"
      ),
      userStatesDerived: {
        generator: "replace only the binding table with all fixed 0.1 browser sources",
        bytes: routesProjectBytes.byteLength,
        sha256: sha256(routesProjectBytes),
        bindings: ALL_BINDINGS
      }
    },
    toolchain: safeToolchain(loopResult.provenance),
    fixtures: [
      await fixtureProvenance(
        "one-state-partial-loop",
        "fixtures/conformance/m8/one-state-partial-loop.avl",
        temporaryOutputs.loop,
        loopResult
      ),
      await fixtureProvenance(
        "user-states-all-routes-alpha",
        "fixtures/conformance/m8/user-states-all-routes-alpha.avl",
        temporaryOutputs.routes,
        routesResult
      )
    ]
  };
  assertNoAbsolutePaths(provenance);
  const serialized = `${JSON.stringify(provenance, null, 2)}\n`;
  if (check) {
    const [recorded, loop, routes] = await Promise.all([
      readFile(provenancePath, "utf8"),
      readFile(outputs.loop),
      readFile(outputs.routes)
    ]);
    requireValue(recorded === serialized, "M8 provenance is stale");
    requireValue(
      Buffer.compare(loop, await readFile(temporaryOutputs.loop)) === 0,
      "M8 one-state fixture is stale"
    );
    requireValue(
      Buffer.compare(routes, await readFile(temporaryOutputs.routes)) === 0,
      "M8 user-state fixture is stale"
    );
  } else {
    await Promise.all([
      copyFile(temporaryOutputs.loop, outputs.loop),
      copyFile(temporaryOutputs.routes, outputs.routes),
      writeFile(provenancePath, serialized)
    ]);
    await Promise.all([
      chmod(outputs.loop, 0o644),
      chmod(outputs.routes, 0o644)
    ]);
  }
  process.stdout.write("M8 fixture provenance verified\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function fixtureProvenance(role, path, assetPath, result) {
  const bytes = new Uint8Array(await readFile(assetPath));
  const validated = validateCompleteAsset({ bytes });
  const frontIndex = parseFrontIndex(bytes);
  requireValue(result.bytes === bytes.byteLength, `${role} compile byte count drifted`);
  requireValue(result.sha256 === sha256(bytes), `${role} compile digest drifted`);
  requireValue(
    serializeCanonicalJson(validated.frontIndex.manifest).byteLength ===
      serializeCanonicalJson(frontIndex.manifest).byteLength,
    `${role} manifest validation drifted`
  );
  const header = frontIndex.header;
  const manifestBytes = bytes.subarray(
    header.manifestOffset,
    header.manifestOffset + header.manifestLength
  );
  const indexBytes = bytes.subarray(
    header.indexOffset,
    header.indexOffset + header.indexLength
  );
  return {
    role,
    path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    externalIntegrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
    manifestSha256: sha256(manifestBytes),
    indexSha256: sha256(indexBytes),
    states: frontIndex.manifest.states.map(({ id }) => id),
    events: [...new Set(frontIndex.manifest.edges.flatMap(({ trigger }) =>
      trigger.type === "event" ? [trigger.name] : []
    ))],
    bindings: frontIndex.manifest.bindings,
    canvas: frontIndex.manifest.canvas,
    alphaProfiles: [...new Set(frontIndex.manifest.renditions.map(({ profile }) => profile))]
  };
}

async function frameProvenance() {
  const names = (await readdir(sourceFrames))
    .filter((name) => /^frame-[0-9]{4}\.png$/u.test(name))
    .sort();
  const frames = await Promise.all(names.map((name) => digestFile(
    resolve(sourceFrames, name),
    `fixtures/compiler/m6/source/packed-frames/${name}`
  )));
  return {
    count: frames.length,
    aggregateSha256: sha256(new TextEncoder().encode(
      frames.map(({ path, bytes, sha256: digest }) =>
        `${path}\u0000${String(bytes)}\u0000${digest}`
      ).join("\n")
    )),
    frames
  };
}

async function digestFile(path, publicPath) {
  const bytes = await readFile(path);
  return { path: publicPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function safeToolchain(provenance) {
  return {
    ffmpegVersion: provenance.versionLine,
    ffmpegExecutableSha256: provenance.executableSha256,
    ffmpegVersionOutputSha256: provenance.versionOutputSha256,
    ffmpegConfigurationSha256: sha256(
      new TextEncoder().encode(provenance.configurationLine)
    ),
    ffmpegEncodersOutputSha256: provenance.encodersOutputSha256,
    ffmpegCalibrationSha256: provenance.calibrationSha256,
    ffprobeVersion: provenance.ffprobeVersionLine,
    ffprobeExecutableSha256: provenance.ffprobeExecutableSha256,
    ffprobeVersionOutputSha256: provenance.ffprobeVersionOutputSha256
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
}

function assertNoAbsolutePaths(value, path = "provenance") {
  if (typeof value === "string") {
    requireValue(!value.startsWith("/"), `${path} contains an absolute path`);
    requireValue(!value.includes("../"), `${path} contains parent traversal`);
    requireValue(!/(?:^|[\s=])\/[A-Za-z0-9]/u.test(value), `${path} embeds an absolute path`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAbsolutePaths(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoAbsolutePaths(entry, `${path}.${key}`);
    }
  }
}
