import {
  FuzzCandidateFactory,
  FuzzStaticStore
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
import { BrowserStaticSurfaceDecoder } from "./strict-static-decoder.js";

export interface FuzzStrictStaticActionResult {
  readonly selected: "native" | "pure";
  readonly abortObserved: boolean;
}

export async function runFuzzStrictStaticAction(
  player: IntegratedPlayer,
  path: "native" | "pure"
): Promise<Readonly<FuzzStrictStaticActionResult>> {
  const descriptor = player.catalog.manifest.staticFrames[0];
  if (descriptor === undefined) {
    throw new Error("fuzz asset has no strict static descriptor");
  }
  const bitmapCloses = { value: 0 };
  const decoder = new BrowserStaticSurfaceDecoder({
    ...(path === "pure" ? { nativeInflater: null } : {}),
    createBitmap: async (_rgba, width, height) => ({
      width,
      height,
      close() {
        bitmapCloses.value += 1;
      }
    } as ImageBitmap)
  });
  const aborted = new AbortController();
  aborted.abort(new DOMException("seeded static abort", "AbortError"));
  let abortObserved = false;
  try {
    await decoder.decode(
      player.catalog.copyStaticPng(descriptor.id),
      {
        signal: aborted.signal,
        expectedWidth: descriptor.width,
        expectedHeight: descriptor.height
      }
    );
  } catch (error) {
    abortObserved = error instanceof DOMException && error.name === "AbortError";
  }
  const surface = await decoder.decode(
    player.catalog.copyStaticPng(descriptor.id),
    {
      signal: new AbortController().signal,
      expectedWidth: descriptor.width,
      expectedHeight: descriptor.height
    }
  );
  const selected = surface.inflatePath;
  surface.close();
  const snapshot = decoder.snapshot();
  if (
    snapshot.errors !== 0 ||
    snapshot.bitmapCloses !== 1 ||
    bitmapCloses.value !== 1 ||
    snapshot.peakPngCopyBytes <= 0 ||
    snapshot.peakZlibBytes <= 0 ||
    snapshot.peakFilteredBytes <= 0 ||
    snapshot.peakRgbaBytes <= 0
  ) {
    throw new Error("strict static fuzz probe did not clean up exactly");
  }
  return Object.freeze({ selected, abortObserved });
}

export async function exerciseFuzzMotionPolicyActions(options: {
  readonly player: IntegratedPlayer;
  readonly factory: FuzzCandidateFactory;
  readonly store: FuzzStaticStore;
  readonly recorder: FuzzRecorder;
  readonly expectedRendition: string;
}): Promise<void> {
  const introDraws = countIntroDraws(options.recorder);

  await options.player.setHostReducedMotion(true);
  fuzzInvariant(
    options.player.motionSnapshot().actualMode === "static" &&
      options.player.motionSnapshot().staticOrigin === "reduced-motion" &&
      options.player.snapshot().readiness === "staticReady" &&
      options.factory.activeAttempts === 0 &&
      options.recorder.actualPlane === "static",
    options.recorder,
    "host reduction did not commit the strict static plane"
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
  fuzzInvariant(
    countIntroDraws(options.recorder) === introDraws,
    options.recorder,
    "motion re-entry replayed the authored intro"
  );
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
  const geometry = computePresentationGeometry({
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
    maxBackingBytes: 8 * 1024 * 1024
  });
  fuzzInvariant(
    geometry.desiredBacking.width === Math.ceil(cssWidth * devicePixelRatio) &&
      geometry.desiredBacking.height === Math.ceil(cssHeight * devicePixelRatio) &&
      geometry.backing.width <= maxBackingWidth &&
      geometry.backing.height <= maxBackingHeight &&
      geometry.byteTerms.totalBackingBytes ===
        geometry.backing.width * geometry.backing.height * 4 * 2 &&
      geometry.planes.animated === geometry.planes.static &&
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
