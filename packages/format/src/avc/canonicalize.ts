import {
  AVC_NAL_TYPE_SPS,
  splitAnnexBAccessUnit
} from "./annex-b.js";
import { FORMAT_DEFAULT_BUDGETS } from "../constants.js";
import { FormatError } from "../errors.js";
import { requireAvc } from "./failure.js";
import { parseSps } from "./parameter-sets.js";

const CONSTRAINED_BASELINE_C0 = 0xc0;
const CONSTRAINED_BASELINE_LEVEL_1B_D0 = 0xd0;
const CONSTRAINED_BASELINE_E0 = 0xe0;

/**
 * Canonicalizes libx264's valid `42 C0 xx` and Level-1b `42 D0 0B` SPS
 * declarations to the format's `42 E0 xx` Constrained Baseline declaration.
 * The authored level byte is preserved; Level 1b is promoted to Level 1.1.
 * Each SPS is fully parsed both before and after the rewrite.
 */
export function canonicalizeAvcConstraintSet2(
  accessUnitBytes: Uint8Array
): Uint8Array {
  const path = "accessUnit";
  requireAvc(
    accessUnitBytes instanceof Uint8Array,
    path,
    "access unit must be bytes"
  );
  requireAvc(
    accessUnitBytes.length <= FORMAT_DEFAULT_BUDGETS.maxSampleBytes,
    path,
    "access unit exceeds the sample budget"
  );
  const nals = splitAnnexBAccessUnit(accessUnitBytes, path);
  let output: Uint8Array;
  try {
    output = accessUnitBytes.slice();
  } catch {
    throw new FormatError(
      "PROFILE_INVALID",
      `AVC canonicalization allocation of ${String(accessUnitBytes.byteLength)} bytes failed`,
      { path }
    );
  }
  for (let index = 0; index < nals.length; index += 1) {
    const nal = nals[index];
    if (nal?.type !== AVC_NAL_TYPE_SPS) {
      continue;
    }
    const nalPath = `${path}.nals[${String(index)}]`;
    parseSps(nal, nalPath, "encoder-candidate");
    const compatibilityOffset = nal.offset + 2;
    const compatibility = output[compatibilityOffset];
    requireAvc(
      compatibility === CONSTRAINED_BASELINE_C0 ||
        compatibility === CONSTRAINED_BASELINE_LEVEL_1B_D0 ||
        compatibility === CONSTRAINED_BASELINE_E0,
      nalPath,
      "only an SPS C0/D0 to E0 constraint canonicalization is permitted",
      compatibilityOffset
    );
    output[compatibilityOffset] = CONSTRAINED_BASELINE_E0;
  }

  // Re-tokenize and parse rewritten SPS bytes so the helper cannot emit syntax
  // that the strict final-profile inspector would reject.
  const rewrittenNals = splitAnnexBAccessUnit(output, path);
  for (let index = 0; index < rewrittenNals.length; index += 1) {
    const nal = rewrittenNals[index];
    if (nal?.type === AVC_NAL_TYPE_SPS) {
      const parsed = parseSps(nal, `${path}.nals[${String(index)}]`);
      requireAvc(
        parsed.constraintSet2,
        `${path}.nals[${String(index)}]`,
        "rewritten SPS does not assert constraint_set2"
      );
    }
  }
  return output;
}
