import type { NormalizedSourceProject } from "./model.js";
import {
  normalizeSourceProject,
  parseNormalizedSourceProject,
  validateVersionedSourceProject
} from "./source-project-normalize.js";

/** Compatibility name for callers that consume compiler-normalized projects. */
export const parseSourceProject = parseNormalizedSourceProject;

/** Validate either closed authoring version and return the normalized model. */
export function validateSourceProject(
  value: unknown
): Readonly<NormalizedSourceProject> {
  return normalizeSourceProject(validateVersionedSourceProject(value));
}
