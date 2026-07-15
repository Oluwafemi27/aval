import { isAvcCodec } from "@pixel-point/aval-format";

export interface CapabilityProbeRecord {
  readonly id: string;
  readonly supported: boolean;
  readonly exactConfiguration: string;
  readonly detail: string;
}

export const REQUIRED_ANIMATED_CAPABILITY_PROBES = Object.freeze([
  "secure-context",
  "module-worker",
  "webgl2",
  "video-decoder"
] as const);

const EXACT_AVC_CODEC_PROBE = /^avc1\.([0-9a-f]{6})-exact-config$/u;

export function capabilityOutcome(
  probes: readonly CapabilityProbeRecord[]
): "supported" | "unsupported" | "inconclusive" {
  const ids = new Set<string>();
  const required = new Set<string>(REQUIRED_ANIMATED_CAPABILITY_PROBES);
  let exactCodecProbe: string | null = null;
  for (const probe of probes) {
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(probe.id)) throw new TypeError("invalid capability probe ID");
    if (typeof probe.supported !== "boolean") throw new TypeError(`capability probe ${probe.id} has no boolean outcome`);
    if (typeof probe.exactConfiguration !== "string" || probe.exactConfiguration.length < 1 || probe.exactConfiguration.length > 1_024) throw new TypeError(`capability probe ${probe.id} has no exact configuration`);
    if (typeof probe.detail !== "string" || probe.detail.length < 1 || probe.detail.length > 2_000) throw new TypeError(`capability probe ${probe.id} has no bounded detail`);
    if (ids.has(probe.id)) throw new TypeError(`duplicate capability probe: ${probe.id}`);
    ids.add(probe.id);
    if (required.has(probe.id)) continue;
    if (!isSupportedExactCodecProbe(probe.id)) {
      throw new TypeError(`unknown animated capability probe: ${probe.id}`);
    }
    if (exactCodecProbe !== null) {
      throw new TypeError("multiple exact codec probes are not allowed");
    }
    exactCodecProbe = probe.id;
  }
  if (
    exactCodecProbe === null ||
    REQUIRED_ANIMATED_CAPABILITY_PROBES.some((id) => !ids.has(id))
  ) return "inconclusive";
  return probes.every((probe) => probe.supported) ? "supported" : "unsupported";
}

function isSupportedExactCodecProbe(id: string): boolean {
  const match = EXACT_AVC_CODEC_PROBE.exec(id);
  return match !== null && isAvcCodec(`avc1.${match[1]!.toUpperCase()}`);
}
