import {
  FuzzCandidateFactory,
  FuzzFallbackStore
} from "./integrated-player-fuzz-fixture.js";
import {
  fuzzInvariant,
  type FuzzRecorder
} from "./integrated-player-fuzz-oracle.js";
import type { IntegratedPlayer } from "./integrated-player.js";
import {
  computePresentationGeometry,
  PRESENTATION_FIT_MODES
} from "./presentation-geometry.js";
export async function exerciseFuzzMotionPolicyActions(options: {
  readonly player: IntegratedPlayer;
  readonly factory: FuzzCandidateFactory;
  readonly store: FuzzFallbackStore;
  readonly recorder: FuzzRecorder;
  readonly expectedRendition: string;
}): Promise<void> {
  const introDraws = countIntroDraws(options.recorder);
  const introPending = [...options.player.getTrace()].reverse().find(
    (record) => record.graph !== null
  )?.graph?.snapshot.initialUnitPending ?? false;

  await options.player.setHostReducedMotion(true);
  fuzzInvariant(
    options.player.motionSnapshot().actualMode === "static" &&
      options.player.motionSnapshot().staticOrigin === "reduced-motion" &&
      options.player.snapshot().readiness === "staticReady" &&
      options.factory.activeAttempts === 0 &&
      options.recorder.actualPlane === "static",
    options.recorder,
    "host reduction did not commit the fallback state"
  );
  options.recorder.push("action:host-reduce");

  await options.player.setMotionPolicy("full");
  assertAnimatedPolicyState(options, "explicit full re-entry");
  options.recorder.push("action:policy-full");

  await options.player.setMotionPolicy("auto");
  fuzzInvariant(
    options.player.motionSnapshot().actualMode === "static" &&
      options.recorder.actualPlane === "static",
    options.recorder,
    "auto policy did not honor the reduced host"
  );
  options.recorder.push("action:policy-auto-reduce");

  await options.player.setHostReducedMotion(false);
  assertAnimatedPolicyState(options, "host full re-entry");
  options.recorder.push("action:host-full");

  const reducing = options.player.setMotionPolicy("reduce");
  const restoring = options.player.setMotionPolicy("full");
  await Promise.all([reducing, restoring]);
  assertAnimatedPolicyState(options, "superseded reduction");
  const introStillPending = [...options.player.getTrace()].reverse().find(
    (record) => record.graph !== null
  )?.graph?.snapshot.initialUnitPending ?? false;
  if (!introPending) {
    fuzzInvariant(
      countIntroDraws(options.recorder) === introDraws,
      options.recorder,
      "motion re-entry replayed the completed authored intro"
    );
  } else if (introStillPending) {
    fuzzInvariant(
      countIntroDraws(options.recorder) > introDraws,
      options.recorder,
      "motion re-entry skipped the unfinished authored intro"
    );
  }
  fuzzInvariant(
    options.store.maximumActivePresentations === 1,
    options.recorder,
    "motion policy static staging overlapped"
  );
  options.recorder.push("action:rapid-policy-flip");
}

export function exerciseFuzzResizeAction(
  player: IntegratedPlayer,
  random: () => number,
  recorder: FuzzRecorder
): void {
  const before = player.snapshot();
  const canvas = player.catalog.manifest.canvas;
  const cssWidth = 31 + randomIndex(random, 770);
  const cssHeight = 29 + randomIndex(random, 570);
  const dprs = [1, 1.25, 2, 3] as const;
  const devicePixelRatio = dprs[randomIndex(random, dprs.length)]!;
  const fit = PRESENTATION_FIT_MODES[
    randomIndex(random, PRESENTATION_FIT_MODES.length)
  ]!;
  const maxBackingWidth = random() < 0.5 ? 257 : 2_048;
  const maxBackingHeight = random() < 0.5 ? 263 : 2_048;
  const maxBackingBytes = 8 * 1024 * 1024;
  const desiredWidth = Math.ceil(cssWidth * devicePixelRatio);
  const desiredHeight = Math.ceil(cssHeight * devicePixelRatio);
  const shouldReject = desiredWidth > maxBackingWidth ||
    desiredHeight > maxBackingHeight ||
    desiredWidth * desiredHeight * 4 > maxBackingBytes;
  let geometry: ReturnType<typeof computePresentationGeometry>;
  try {
    geometry = computePresentationGeometry({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      pixelAspectNumerator: canvas.pixelAspect[0],
      pixelAspectDenominator: canvas.pixelAspect[1],
      fit,
      cssWidth,
      cssHeight,
      devicePixelRatio,
      maxBackingWidth,
      maxBackingHeight,
      maxBackingBytes
    });
  } catch (error) {
    fuzzInvariant(
      shouldReject &&
        error instanceof RangeError &&
        sameSemanticSnapshot(before, player.snapshot()),
      recorder,
      "resize rejection changed semantic state or lacked an explicit range error"
    );
    recorder.push(
      `action:resize-rejected:${fit}:${String(cssWidth)}x${String(cssHeight)}@${String(devicePixelRatio)}`
    );
    return;
  }
  fuzzInvariant(
    !shouldReject &&
      geometry.desiredBacking.width === desiredWidth &&
      geometry.desiredBacking.height === desiredHeight &&
      geometry.backing.width === desiredWidth &&
      geometry.backing.height === desiredHeight &&
      geometry.byteTerms.totalBackingBytes ===
        geometry.backing.width * geometry.backing.height * 4 &&
      sameSemanticSnapshot(before, player.snapshot()),
    recorder,
    "resize/DPR arithmetic changed semantic graph or split plane geometry"
  );
  recorder.push(
    `action:resize:${fit}:${String(cssWidth)}x${String(cssHeight)}@${String(devicePixelRatio)}:${String(geometry.backing.width)}x${String(geometry.backing.height)}`
  );
}

function assertAnimatedPolicyState(
  options: {
    readonly player: IntegratedPlayer;
    readonly factory: FuzzCandidateFactory;
    readonly recorder: FuzzRecorder;
    readonly expectedRendition: string;
  },
  label: string
): void {
  fuzzInvariant(
    options.player.motionSnapshot().actualMode === "animated" &&
      options.player.snapshot().readiness === "interactiveReady" &&
      options.player.snapshot().selectedRendition === options.expectedRendition &&
      options.factory.activeAttempts === 1 &&
      options.recorder.actualPlane === "animated",
    options.recorder,
    `${label} did not restore one animated owner`
  );
}

function sameSemanticSnapshot(
  left: ReturnType<IntegratedPlayer["snapshot"]>,
  right: ReturnType<IntegratedPlayer["snapshot"]>
): boolean {
  return left.readiness === right.readiness &&
    left.requestedState === right.requestedState &&
    left.visualState === right.visualState &&
    left.isTransitioning === right.isTransitioning &&
    left.selectedRendition === right.selectedRendition &&
    left.preparing === right.preparing &&
    left.disposed === right.disposed;
}

function countIntroDraws(recorder: FuzzRecorder): number {
  return recorder.entries.filter((entry) =>
    entry.startsWith("draw:animated:intro:")
  ).length;
}

function randomIndex(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}
