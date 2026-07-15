import {
  validateCompleteAsset,
  type ValidatedAssetLayout
} from "@pixel-point/aval-format";

import { CompilerError } from "../diagnostics.js";
import { sha256Hex } from "./hash.js";

export function validateCompiledOutput(
  bytes: Uint8Array
): Readonly<ValidatedAssetLayout> {
  const layout = validateCompleteAsset({ bytes });
  for (const blob of layout.frontIndex.unitBlobs) {
    const digest = sha256Hex(
      bytes.subarray(blob.offset, blob.offset + blob.length)
    );
    if (digest !== blob.sha256) {
      throw new CompilerError(
        "ASSET_INVALID",
        `Compiler output digest mismatch for ${blob.unit}`
      );
    }
  }
  return layout;
}
