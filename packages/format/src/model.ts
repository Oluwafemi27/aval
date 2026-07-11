import type { ValidatedMotionGraph } from "@rendered-motion/graph";

export type Id = string;
export type Sha256Hex = string;
export type Rect = readonly [
  x: number,
  y: number,
  width: number,
  height: number
];

export interface FormatBudgets {
  readonly maxFileBytes: number;
  readonly maxManifestBytes: number;
  readonly maxIndexBytes: number;
  readonly maxSampleBytes: number;
  readonly maxStaticPngBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonNodes: number;
  readonly maxJsonStringBytes: number;
  readonly maxStates: number;
  readonly maxEdges: number;
  readonly maxUnits: number;
  readonly maxRenditions: number;
  readonly maxStaticFrames: number;
  readonly maxBindings: number;
  readonly maxBlobRanges: number;
  readonly maxTotalUnitFrames: number;
  readonly maxSampleRecords: number;
  readonly maxPortsPerBody: number;
  readonly maxReversibleFrames: number;
}

export interface FormatOptions {
  readonly budgets?: Partial<FormatBudgets>;
}

export interface RationalV01 {
  readonly numerator: number;
  readonly denominator: number;
}

export interface CanvasV01 {
  readonly width: number;
  readonly height: number;
  readonly fit: "contain" | "cover" | "fill" | "none";
  readonly pixelAspect: readonly [numerator: number, denominator: number];
  readonly colorSpace: "srgb";
}

export interface BitrateV01 {
  readonly average: number;
  readonly peak: number;
}

export type RenditionV01 =
  | {
      readonly id: Id;
      readonly profile: "reference-rgba-v0";
      readonly codec: "rma.reference-rgba";
      readonly codedWidth: number;
      readonly codedHeight: number;
      readonly alphaLayout: { readonly type: "straight-rgba-v0" };
      readonly capabilities: readonly [];
    }
  | {
      readonly id: Id;
      readonly profile: "avc-annexb-opaque-v0";
      readonly codec: "avc1.42E020";
      readonly codedWidth: number;
      readonly codedHeight: number;
      readonly alphaLayout: {
        readonly type: "opaque-v0";
        readonly colorRect: Rect;
      };
      readonly bitrate: BitrateV01;
      readonly capabilities: readonly ["webcodecs", "webgl2"];
    }
  | {
      readonly id: Id;
      readonly profile: "avc-annexb-packed-alpha-v0";
      readonly codec: "avc1.42E020";
      readonly codedWidth: number;
      readonly codedHeight: number;
      readonly alphaLayout: {
        readonly type: "stacked-v0";
        readonly colorRect: Rect;
        readonly alphaRect: Rect;
      };
      readonly bitrate: BitrateV01;
      readonly capabilities: readonly ["webcodecs", "webgl2"];
    };

export interface SampleSpanV01 {
  readonly rendition: Id;
  readonly sampleStart: number;
  readonly sampleCount: number;
  readonly sha256: Sha256Hex;
}

export interface PortV01 {
  readonly id: Id;
  readonly entryFrame: 0;
  readonly portalFrames: readonly number[];
}

export interface ResidencyEndpointV01 {
  readonly state: Id;
  readonly port: Id;
  readonly frames: number;
}

interface UnitBaseV01 {
  readonly id: Id;
  readonly frameCount: number;
  readonly samples: readonly SampleSpanV01[];
}

export type UnitV01 =
  | (UnitBaseV01 & {
      readonly kind: "body";
      readonly playback: "loop" | "finite";
      readonly ports: readonly PortV01[];
    })
  | (UnitBaseV01 & { readonly kind: "bridge" })
  | (UnitBaseV01 & {
      readonly kind: "reversible";
      readonly residency: {
        readonly endpoints: readonly [
          ResidencyEndpointV01,
          ResidencyEndpointV01
        ];
      };
    })
  | (UnitBaseV01 & { readonly kind: "one-shot" });

export interface StaticFrameV01 {
  readonly id: Id;
  readonly offset: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: Sha256Hex;
}

export interface StateV01 {
  readonly id: Id;
  readonly bodyUnit: Id;
  readonly staticFrame: Id;
  readonly initialUnit?: Id;
}

export type TriggerV01 =
  | { readonly type: "event"; readonly name: Id }
  | { readonly type: "completion" };

export type StartV01 =
  | {
      readonly type: "portal";
      readonly sourcePort: Id;
      readonly targetPort: Id;
      readonly maxWaitFrames: number;
    }
  | {
      readonly type: "finish";
      readonly targetPort: Id;
      readonly maxWaitFrames: number;
    }
  | {
      readonly type: "cut";
      readonly targetPort: Id;
      readonly maxWaitFrames: 1;
    };

export type TransitionV01 =
  | { readonly kind: "locked"; readonly unit: Id }
  | {
      readonly kind: "reversible";
      readonly unit: Id;
      readonly direction: "forward" | "reverse";
      readonly reverseOf?: Id;
    };

interface NonCutEdgeV01 {
  readonly id: Id;
  readonly from: Id;
  readonly to: Id;
  readonly trigger?: TriggerV01;
  readonly start: Exclude<StartV01, { readonly type: "cut" }>;
  readonly transition?: TransitionV01;
  readonly continuity: "exact-authored" | "exact-reverse";
  readonly targetRunwayFrames?: never;
}

interface CutEdgeV01 {
  readonly id: Id;
  readonly from: Id;
  readonly to: Id;
  readonly trigger?: TriggerV01;
  readonly start: Extract<StartV01, { readonly type: "cut" }>;
  readonly transition?: never;
  readonly continuity: "cut";
  readonly targetRunwayFrames: number;
}

export type EdgeV01 = NonCutEdgeV01 | CutEdgeV01;

export type BindingSourceV01 =
  | "activate"
  | "engagement.off"
  | "engagement.on"
  | "focus.in"
  | "focus.out"
  | "hidden"
  | "pointer.enter"
  | "pointer.leave"
  | "visible";

export interface BindingV01 {
  readonly source: BindingSourceV01;
  readonly event: Id;
}

export interface ReadinessV01 {
  readonly policy: "all-routes";
  readonly bootstrapUnits: readonly Id[];
  readonly immediateEdges: readonly Id[];
}

export interface FallbackV01 {
  readonly unsupported: "per-state-static";
  readonly reducedMotion: "per-state-static";
}

export interface DeclaredLimitsV01 {
  readonly maxCompiledBytes: number;
  readonly maxRuntimeBytes: number;
  readonly decodedPixelBytes: number;
  readonly persistentCacheBytes: number;
  readonly runtimeWorkingSetBytes: number;
}

export interface CompiledManifestV01 {
  readonly formatVersion: "0.1";
  readonly generator: string;
  readonly canvas: CanvasV01;
  readonly frameRate: RationalV01;
  readonly renditions: readonly RenditionV01[];
  readonly units: readonly UnitV01[];
  readonly staticFrames: readonly StaticFrameV01[];
  readonly initialState: Id;
  readonly states: readonly StateV01[];
  readonly edges: readonly EdgeV01[];
  readonly bindings: readonly BindingV01[];
  readonly readiness: ReadinessV01;
  readonly fallback: FallbackV01;
  readonly limits: DeclaredLimitsV01;
}

export interface FormatHeader {
  readonly major: 0;
  readonly minor: 1;
  readonly headerLength: 64;
  readonly requiredFeatureFlags: 0;
  readonly declaredFileLength: number;
  readonly manifestOffset: 64;
  readonly manifestLength: number;
  readonly indexOffset: number;
  readonly indexLength: number;
}

export interface AccessUnitRecord {
  readonly payloadOffset: number;
  readonly payloadLength: number;
  readonly unitIndex: number;
  readonly renditionIndex: number;
  readonly key: boolean;
  readonly frameIndex: number;
}

export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

export interface UnitBlobRange extends ByteRange {
  readonly rendition: Id;
  readonly unit: Id;
  readonly sampleStart: number;
  readonly sampleCount: number;
  readonly sha256: Sha256Hex;
}

export interface StaticBlobRange extends ByteRange {
  readonly staticFrame: Id;
  readonly sha256: Sha256Hex;
}

export interface ParsedFrontIndex {
  readonly header: FormatHeader;
  readonly manifest: CompiledManifestV01;
  readonly graph: ValidatedMotionGraph;
  readonly records: readonly AccessUnitRecord[];
  readonly frontIndexRange: ByteRange;
  readonly unitBlobs: readonly UnitBlobRange[];
  readonly staticBlobs: readonly StaticBlobRange[];
}

export interface ValidatedAssetLayout {
  readonly frontIndex: ParsedFrontIndex;
  readonly fileRange: ByteRange;
}

export interface ReferenceFrameHeader {
  readonly width: number;
  readonly height: number;
  readonly frameIndex: number;
  readonly rgbaLength: number;
}

export interface ReferenceFrameDescriptor extends ReferenceFrameHeader {
  readonly rgbaRange: ByteRange;
}

export interface SampleDigestInputV01 {
  readonly rendition: Id;
  readonly sha256: Sha256Hex;
}

type UnitInputOf<TKind extends UnitV01["kind"]> = Omit<
  Extract<UnitV01, { readonly kind: TKind }>,
  "samples"
> & {
  readonly samples: readonly SampleDigestInputV01[];
};

export type UnitInputV01 =
  | UnitInputOf<"body">
  | UnitInputOf<"bridge">
  | UnitInputOf<"reversible">
  | UnitInputOf<"one-shot">;

export interface StaticFrameInputV01 {
  readonly id: Id;
  readonly width: number;
  readonly height: number;
  readonly sha256: Sha256Hex;
}

export type CompiledManifestInputV01 = Omit<
  CompiledManifestV01,
  "units" | "staticFrames"
> & {
  readonly units: readonly UnitInputV01[];
  readonly staticFrames: readonly StaticFrameInputV01[];
};

export interface AccessUnitInputV01 {
  readonly rendition: Id;
  readonly unit: Id;
  readonly frameIndex: number;
  readonly key: boolean;
  readonly bytes: Uint8Array;
}

export interface StaticPayloadInputV01 {
  readonly staticFrame: Id;
  readonly bytes: Uint8Array;
}

export interface CanonicalAssetInputV01 {
  readonly manifest: CompiledManifestInputV01;
  readonly accessUnits: readonly AccessUnitInputV01[];
  readonly staticPayloads: readonly StaticPayloadInputV01[];
}
