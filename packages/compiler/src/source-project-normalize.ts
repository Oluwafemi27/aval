import {
  FormatError,
  parseStrictJson
} from "@rendered-motion/format";

import { CompilerError } from "./diagnostics.js";
import type {
  NormalizedSourceProject,
  SourceAlphaPolicy,
  SourceProjectV01,
  SourceProjectV02
} from "./model.js";
import { record } from "./schema-validation.js";
import { validateSourceProjectV01 } from "./source-project-v01-schema.js";
import { validateSourceProjectV02 } from "./source-project-v02-schema.js";

export type ParsedSourceProject = SourceProjectV01 | SourceProjectV02;

/** Parse strict JSON, dispatch one closed schema, then erase versioned shapes. */
export function parseNormalizedSourceProject(
  bytes: Uint8Array
): Readonly<NormalizedSourceProject> {
  let value: unknown;
  try {
    value = parseStrictJson(bytes);
  } catch (error) {
    if (error instanceof FormatError) {
      throw new CompilerError("INPUT_INVALID", error.message, { cause: error });
    }
    throw error;
  }
  return normalizeSourceProject(validateVersionedSourceProject(value));
}

/** Dispatches exclusively from an own exact version field. */
export function validateVersionedSourceProject(
  value: unknown
): Readonly<ParsedSourceProject> {
  const input = record(value, "project");
  if (!Object.prototype.hasOwnProperty.call(input, "projectVersion")) {
    throw new CompilerError(
      "INPUT_INVALID",
      "project.projectVersion is required",
      { field: "project.projectVersion" }
    );
  }
  if (input.projectVersion === "0.1") return validateSourceProjectV01(input);
  if (input.projectVersion === "0.2") return validateSourceProjectV02(input);
  throw new CompilerError(
    "INPUT_INVALID",
    "project.projectVersion must be 0.1 or 0.2",
    { field: "project.projectVersion" }
  );
}

/** Lower either authoring version into the sole compiler project model. */
export function normalizeSourceProject(
  project: Readonly<ParsedSourceProject>
): Readonly<NormalizedSourceProject> {
  if (project.projectVersion === "0.1") {
    return normalizedProject({
      sourceProjectVersion: project.projectVersion,
      alphaPolicy: "opaque",
      alphaPolicyRejectionCode: "OPAQUE_ONLY_M5",
      project,
      renditions: project.renditions.map((rendition) => Object.freeze({
        id: rendition.id,
        width: rendition.codedWidth,
        height: rendition.codedHeight,
        bitrate: rendition.bitrate
      }))
    });
  }
  return normalizedProject({
    sourceProjectVersion: project.projectVersion,
    alphaPolicy: profilePolicy(project.profile),
    alphaPolicyRejectionCode: "ALPHA_POLICY_REJECTED",
    project,
    renditions: project.renditions
  });
}

function profilePolicy(profile: SourceProjectV02["profile"]): SourceAlphaPolicy {
  switch (profile) {
    case "avc-annexb-auto-v0":
      return "auto";
    case "avc-annexb-opaque-v0":
      return "opaque";
    case "avc-annexb-packed-alpha-v0":
      return "packed";
  }
}

function normalizedProject(input: {
  readonly sourceProjectVersion: NormalizedSourceProject["sourceProjectVersion"];
  readonly alphaPolicy: SourceAlphaPolicy;
  readonly alphaPolicyRejectionCode:
    NormalizedSourceProject["alphaPolicyRejectionCode"];
  readonly project: Readonly<ParsedSourceProject>;
  readonly renditions: NormalizedSourceProject["renditions"];
}): Readonly<NormalizedSourceProject> {
  return Object.freeze({
    sourceProjectVersion: input.sourceProjectVersion,
    alphaPolicy: input.alphaPolicy,
    alphaPolicyRejectionCode: input.alphaPolicyRejectionCode,
    canvas: input.project.canvas,
    frameRate: input.project.frameRate,
    sources: input.project.sources,
    renditions: Object.freeze([...input.renditions]),
    units: input.project.units,
    initialState: input.project.initialState,
    states: input.project.states,
    edges: input.project.edges,
    bindings: input.project.bindings
  });
}
