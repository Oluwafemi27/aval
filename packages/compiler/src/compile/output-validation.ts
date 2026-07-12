import {
  decodePngRgba,
  validateCompleteAsset,
  validatePngProfile,
  type ValidatedAssetLayout
} from "@rendered-motion/format";

import { CompilerError } from "../diagnostics.js";
import { sha256Hex } from "./hash.js";

export function validateCompiledOutput(
  bytes: Uint8Array
): Readonly<ValidatedAssetLayout> {
  const layout = validateCompleteAsset({ bytes });
  for (const blob of [
    ...layout.frontIndex.unitBlobs,
    ...layout.frontIndex.staticBlobs
  ]) {
    const digest = sha256Hex(
      bytes.subarray(blob.offset, blob.offset + blob.length)
    );
    if (digest !== blob.sha256) {
      throw new CompilerError(
        "ASSET_INVALID",
        `Compiler output digest mismatch for ${"unit" in blob ? blob.unit : blob.staticFrame}`
      );
    }
  }
  for (let index = 0; index < layout.frontIndex.staticBlobs.length; index += 1) {
    const blob = layout.frontIndex.staticBlobs[index];
    const descriptor = layout.frontIndex.manifest.staticFrames[index];
    if (blob === undefined || descriptor === undefined) {
      throw new CompilerError(
        "ASSET_INVALID",
        "Compiler output static descriptors are incomplete"
      );
    }
    decodePngRgba(validatePngProfile({
      png: bytes.subarray(blob.offset, blob.offset + blob.length),
      expectedWidth: descriptor.width,
      expectedHeight: descriptor.height
    }));
  }
  return layout;
}
