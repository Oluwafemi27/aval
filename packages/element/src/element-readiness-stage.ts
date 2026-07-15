import type { RuntimeReadiness, StaticReason } from "@pixel-point/aval-player-web";

import type { ElementDesiredState } from "./element-desired-state.js";
import type { ElementPublicState } from "./element-public-state.js";
import { DEFAULT_CONFIGURATION } from "./element-reconciler-diagnostics.js";

export function stageElementReadiness(
  state: ElementPublicState,
  desiredState: ElementDesiredState,
  value: RuntimeReadiness,
  reason: StaticReason | null
): void {
  const desired = desiredState.snapshot();
  const configuration = desired.configuration ?? DEFAULT_CONFIGURATION;
  state.stageReadiness({
    value,
    reason,
    motion: configuration.motion,
    hostReduced: desired.hostReducedMotion,
    effectivelyVisible: desired.effectivelyVisible
  });
}
