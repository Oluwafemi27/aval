/** @deprecated Import the profile-neutral frame renderer validators instead. */
export {
  checkedFrameRgbaBytes as checkedOpaqueRgbaBytes,
  freezeLegacyOpaqueFrameLayout as freezeOpaqueFrameLayout,
  validateFrameDimension as validateOpaqueDimension,
  validateFrameGeneration as validateOpaqueGeneration,
  validateFrameIndex as validateOpaqueIndex,
  validateFrameNonNegativeDimension as validateOpaqueNonNegativeDimension,
  validateFrameObject as validateOpaqueObject,
  validateFrameStreamingSlots as validateOpaqueStreamingSlots,
  validateLegacyOpaqueBackendLimits as validateOpaqueBackendLimits
} from "./frame-renderer-validation.js";
