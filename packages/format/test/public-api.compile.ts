import type {
  AccessUnitInputV01,
  AccessUnitRecord,
  AvcAccessUnitInput,
  AvcAccessUnitSummary,
  AvcColorSummary,
  AvcConstrainedBaselineProfile,
  AvcCropSummary,
  AvcEncoderRenditionPreparation,
  AvcEncoderRenditionPreparationInput,
  AvcEncoderUnitStreamInput,
  AvcFrameRate,
  AvcIncrementalAccessUnitInput,
  AvcIncrementalAccessUnitInspection,
  AvcIncrementalInspector,
  AvcParameterSetSummary,
  AvcProductionRenditionProfileV01,
  AvcRenditionGeometry,
  AvcRenditionGeometryInput,
  AvcVisibleRenditionGeometryInput,
  AvcRenditionInspection,
  AvcRenditionInspectionInput,
  AvcUnitInput,
  AvcUnitInspection,
  BindingSourceV01,
  BindingV01,
  BitrateV01,
  ByteRange,
  CanvasV01,
  CanonicalAssetInputV01,
  CanonicalJsonObject,
  CanonicalJsonWriteLimits,
  CanonicalJsonValue,
  CompiledManifestInputV01,
  CompiledManifestV01,
  DeclaredLimitsV01,
  EdgeV01,
  FormatBudgets,
  FormatErrorCode,
  FormatErrorDetails,
  FormatHeader,
  FormatOptions,
  Id,
  ParsedFrontIndex,
  PngDecodePlan,
  PngProfileValidationInput,
  PngRgbaDecodeResult,
  PortV01,
  RationalV01,
  ReadinessV01,
  Rect,
  ReferenceFrameDescriptor,
  ReferenceFrameHeader,
  ReferenceFrameInput,
  ReferenceFrameValidationInput,
  RenditionV01,
  ResidencyEndpointV01,
  SampleDigestInputV01,
  SampleSpanV01,
  Sha256Hex,
  StartV01,
  StateV01,
  TransitionV01,
  TriggerV01,
  UnitBlobRange,
  UnitInputV01,
  UnitV01,
  ValidatedAssetLayout
} from "@aval/format";

// This tuple is never emitted. It makes every approved public type cross the
// package export boundary during the test TypeScript project build.
export type PublicFormatTypes = readonly [
  AccessUnitInputV01,
  AccessUnitRecord,
  AvcAccessUnitInput,
  AvcAccessUnitSummary,
  AvcColorSummary,
  AvcConstrainedBaselineProfile,
  AvcCropSummary,
  AvcEncoderRenditionPreparation,
  AvcEncoderRenditionPreparationInput,
  AvcEncoderUnitStreamInput,
  AvcFrameRate,
  AvcIncrementalAccessUnitInput,
  AvcIncrementalAccessUnitInspection,
  AvcIncrementalInspector,
  AvcParameterSetSummary,
  AvcProductionRenditionProfileV01,
  AvcRenditionGeometry,
  AvcRenditionGeometryInput,
  AvcVisibleRenditionGeometryInput,
  AvcRenditionInspection,
  AvcRenditionInspectionInput,
  AvcUnitInput,
  AvcUnitInspection,
  BindingSourceV01,
  BindingV01,
  BitrateV01,
  ByteRange,
  CanvasV01,
  CanonicalAssetInputV01,
  CanonicalJsonObject,
  CanonicalJsonWriteLimits,
  CanonicalJsonValue,
  CompiledManifestInputV01,
  CompiledManifestV01,
  DeclaredLimitsV01,
  EdgeV01,
  FormatBudgets,
  FormatErrorCode,
  FormatErrorDetails,
  FormatHeader,
  FormatOptions,
  Id,
  ParsedFrontIndex,
  PngDecodePlan,
  PngProfileValidationInput,
  PngRgbaDecodeResult,
  PortV01,
  RationalV01,
  ReadinessV01,
  Rect,
  ReferenceFrameDescriptor,
  ReferenceFrameHeader,
  ReferenceFrameInput,
  ReferenceFrameValidationInput,
  RenditionV01,
  ResidencyEndpointV01,
  SampleDigestInputV01,
  SampleSpanV01,
  Sha256Hex,
  StartV01,
  StateV01,
  TransitionV01,
  TriggerV01,
  UnitBlobRange,
  UnitInputV01,
  UnitV01,
  ValidatedAssetLayout
];

// Internal implementation contracts deliberately do not cross the package
// root even though their defining modules use named exports internally.
// @ts-expect-error encoder constraint rewriting is private
export { canonicalizeAvcConstraintSet2 } from "@aval/format";
// @ts-expect-error canonical layout is private
export type { CanonicalAssetLayout } from "@aval/format";
// @ts-expect-error PNG validation inputs are private
export type { PngEnvelopeValidationInput } from "@aval/format";
// @ts-expect-error writer normalization is private
export type { NormalizedWriterInput } from "@aval/format";

declare const publicAvcProfile: AvcConstrainedBaselineProfile;
// @ts-expect-error compatibility policy is selected by the entry point
publicAvcProfile.requireConstraintSet2;

const pngDeflateCode: FormatErrorCode = "PNG_DEFLATE_INVALID";
const pngScanlineCode: FormatErrorCode = "PNG_SCANLINE_INVALID";
void pngDeflateCode;
void pngScanlineCode;

declare const publicGeometry: AvcRenditionGeometry;
// @ts-expect-error public geometry is immutable
publicGeometry.codedWidth = 16;
// @ts-expect-error public geometry rectangles are immutable
publicGeometry.decodedStorageRect[0] = 1;

declare const pngPlan: PngDecodePlan;
// @ts-expect-error PNG decode plans are immutable
pngPlan.expectedFilteredBytes = 0;
// @ts-expect-error plan ranges are immutable
pngPlan.deflateRange.offset = 0;
