import { resolveFormatBudgets } from "./constants.js";
import { FormatError } from "./errors.js";
import {
  cloneBindings,
  cloneEdges,
  cloneReadiness,
  cloneStates
} from "./manifest-graph-schema.js";
import { cloneDeclaredLimits } from "./manifest-limits-schema.js";
import {
  validateBlobCount,
  validateManifestRelations,
  validateRawBlobCount
} from "./manifest-relations.js";
import {
  cloneCanvas,
  cloneFrameRate,
  cloneRenditions
} from "./manifest-rendition-schema.js";
import {
  exactKeys,
  generatorString,
  identifier,
  literal,
  record
} from "./manifest-validation.js";
import { cloneUnits } from "./manifest-unit-schema.js";
import type {
  CompiledManifestV01,
  FormatOptions
} from "./model.js";

const TOP_LEVEL_KEYS = [
  "formatVersion", "generator", "canvas", "frameRate", "renditions", "units",
  "initialState", "states", "edges", "bindings", "readiness", "limits"
] as const;

/**
 * Validate, detach, and recursively freeze a version-0.1 manifest.
 *
 * This is the only runtime schema composition root for the 0.1 wire model. It
 * intentionally rejects unknown fields and noncanonical identity-array order.
 */
export function validateCompiledManifestV01(
  value: unknown,
  options?: FormatOptions
): CompiledManifestV01 {
  try {
    const budgets = resolveFormatBudgets(options);
    const input = record(value, "manifest");
    exactKeys(input, TOP_LEVEL_KEYS, "manifest");

    literal(input.formatVersion, "0.1", "formatVersion");
    const generator = generatorString(input.generator, "generator");
    const canvas = cloneCanvas(input.canvas, "canvas");
    const frameRate = cloneFrameRate(input.frameRate, "frameRate");
    const renditions = cloneRenditions(
      input.renditions,
      canvas,
      frameRate,
      budgets,
      "renditions"
    );
    validateRawBlobCount(input.units, renditions.length, budgets);
    const units = cloneUnits(input.units, renditions, budgets, "units");
    const initialState = identifier(input.initialState, "initialState");
    const states = cloneStates(input.states, budgets, "states");
    const edges = cloneEdges(input.edges, budgets, "edges");
    const bindings = cloneBindings(input.bindings, budgets, "bindings");
    const readiness = cloneReadiness(input.readiness, budgets, "readiness");
    const limits = cloneDeclaredLimits(
      input.limits,
      renditions,
      canvas,
      budgets,
      "limits"
    );

    validateBlobCount(units, renditions, budgets);
    validateManifestRelations({
      initialState,
      renditions,
      units,
      states,
      edges,
      bindings,
      readiness
    });

    return Object.freeze({
      formatVersion: "0.1",
      generator,
      canvas,
      frameRate,
      renditions,
      units,
      initialState,
      states,
      edges,
      bindings,
      readiness,
      limits
    });
  } catch (error) {
    if (error instanceof FormatError) {
      throw error;
    }
    throw new FormatError("MANIFEST_INVALID", "manifest validation failed");
  }
}
