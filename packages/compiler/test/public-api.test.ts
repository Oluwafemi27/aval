import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";

describe("compiler public API", () => {
  it("exposes the supported compile, CLI, validation, and dev boundaries", () => {
    expect(Object.keys(api).sort()).toEqual([
      "AVC_ENCODER_PRESETS",
      "COMPILER_PROJECT_VERSION",
      "CompilerError",
      "DEFAULT_MEDIA_TIMEOUT_MS",
      "DEFAULT_PROBE_TIMEOUT_MS",
      "DEFAULT_PROCESS_TIMEOUT_MS",
      "HELP_TEXT",
      "MAX_PROCESS_OUTPUT_BYTES",
      "MAX_PROCESS_STDERR_BYTES",
      "bt709LimitedAlphaLuma",
      "bt709LimitedChroma2x2",
      "bt709LimitedLuma",
      "compileDirectInput",
      "compileProjectFile",
      "createCompileAdoptionSummary",
      "diagnosticFromError",
      "dilateTransparentRgba",
      "formatCompileAdoptionSummary",
      "formatDiagnostic",
      "inspectAssetFile",
      "packRgbaToPlanarYuv420",
      "parseCliArguments",
      "roundSignedRatio",
      "runCli",
      "startDevCommand",
      "unpackAssetFile",
      "validateAssetFile",
      "validateAssetReport"
    ].sort());
  });
});
