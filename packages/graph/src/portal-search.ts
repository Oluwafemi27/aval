import { MotionGraphValidationError } from "./errors.js";
import type {
  GraphBodyDefinition,
  GraphPortDefinition
} from "./model.js";

export interface BodyFrameStep {
  /** The local body frame to present on the next content tick. */
  readonly frameIndex: number;
  /** True when the next tick advances content, including a loop wrap. */
  readonly didAdvance: boolean;
  /** True only when a looping body crosses its last-to-first seam. */
  readonly wrapped: boolean;
  /** True when a finite or held body must keep its final frame displayed. */
  readonly isHeld: boolean;
}

export interface BodyBoundarySearch {
  readonly boundaryFrame: number;
  /** Number of body-frame advances between the displayed frame and boundary. */
  readonly waitFrames: number;
  /** True when the currently displayed frame is already the boundary. */
  readonly eligibleNow: boolean;
  /** True when a looping body must cross its last-to-first seam. */
  readonly wraps: boolean;
}

/**
 * Return the next local frame for a body without introducing a wall clock.
 * Finite bodies stop on their final authored frame; held bodies never advance.
 */
export function nextBodyFrame(
  body: GraphBodyDefinition,
  currentFrame: number
): Readonly<BodyFrameStep> {
  assertBody(body);
  assertCurrentFrame(body, currentFrame);

  if (body.kind === "loop") {
    const wrapped = currentFrame === body.frameCount - 1;
    return Object.freeze({
      frameIndex: wrapped ? 0 : currentFrame + 1,
      didAdvance: true,
      wrapped,
      isHeld: false
    });
  }

  const isHeld = currentFrame === body.frameCount - 1;
  return Object.freeze({
    frameIndex: isHeld ? currentFrame : currentFrame + 1,
    didAdvance: !isHeld,
    wrapped: false,
    isHeld
  });
}

/**
 * Find the next eligible portal at or after the currently displayed body
 * frame. Looping bodies search circularly. Finite bodies never wrap and are
 * valid for portal departure only when their final held frame is a portal.
 */
export function findNextPortalBoundary(
  body: GraphBodyDefinition,
  portId: string,
  currentFrame: number
): Readonly<BodyBoundarySearch> {
  const port = resolveDeparturePort(body, portId);
  assertCurrentFrame(body, currentFrame);

  const directBoundary = port.portalFrames.find(
    (portalFrame) => portalFrame >= currentFrame
  );

  if (directBoundary !== undefined) {
    const waitFrames = directBoundary - currentFrame;
    return freezeBoundary(directBoundary, waitFrames, false);
  }

  // resolveDeparturePort guarantees that finite and held bodies end on a
  // portal, so only a loop can reach this circular-search branch.
  const boundaryFrame = port.portalFrames[0]!;
  const waitFrames = body.frameCount - currentFrame + boundaryFrame;
  return freezeBoundary(boundaryFrame, waitFrames, true);
}

/**
 * Compute the worst authored-frame wait to this port from any body phase.
 * This is O(portal count), not O(frame count), so hostile large frame counts
 * cannot turn validation into an unbounded scan.
 */
export function greatestPortalWaitFrames(
  body: GraphBodyDefinition,
  portId: string
): number {
  const port = resolveDeparturePort(body, portId);
  const portals = port.portalFrames;

  if (body.kind === "loop") {
    let greatestWait = 0;
    for (let index = 0; index < portals.length; index += 1) {
      const previous = portals[index]!;
      const next = portals[(index + 1) % portals.length]!;
      const circularDistance =
        index === portals.length - 1
          ? body.frameCount - previous + next
          : next - previous;
      greatestWait = Math.max(greatestWait, circularDistance - 1);
    }
    return greatestWait;
  }

  let greatestWait = portals[0]!;
  for (let index = 1; index < portals.length; index += 1) {
    greatestWait = Math.max(
      greatestWait,
      portals[index]! - portals[index - 1]! - 1
    );
  }
  return greatestWait;
}

/** Return the finite/held final-frame boundary from the displayed frame. */
export function findFinishBoundary(
  body: GraphBodyDefinition,
  currentFrame: number
): Readonly<BodyBoundarySearch> {
  assertFinishBody(body);
  assertCurrentFrame(body, currentFrame);
  const boundaryFrame = body.frameCount - 1;
  return freezeBoundary(boundaryFrame, boundaryFrame - currentFrame, false);
}

/** Return the greatest possible authored-frame wait for a finish policy. */
export function greatestFinishWaitFrames(body: GraphBodyDefinition): number {
  assertFinishBody(body);
  return body.frameCount - 1;
}

function resolveDeparturePort(
  body: GraphBodyDefinition,
  portId: string
): GraphPortDefinition {
  assertBody(body);
  const matchingPorts = body.ports.filter((port) => port.id === portId);
  if (matchingPorts.length !== 1) {
    throw new MotionGraphValidationError(
      matchingPorts.length === 0
        ? `body ${body.unitId} has no port ${portId}`
        : `body ${body.unitId} has duplicate port ${portId}`
    );
  }

  const port = matchingPorts[0]!;
  if (port.entryFrame !== 0) {
    throw new MotionGraphValidationError(
      `port ${portId} on body ${body.unitId} must enter at frame zero`
    );
  }
  if (port.portalFrames.length === 0) {
    throw new MotionGraphValidationError(
      `port ${portId} on body ${body.unitId} must declare a portal frame`
    );
  }

  let previous = -1;
  for (const portalFrame of port.portalFrames) {
    if (
      !Number.isSafeInteger(portalFrame) ||
      portalFrame < 0 ||
      portalFrame >= body.frameCount
    ) {
      throw new MotionGraphValidationError(
        `port ${portId} on body ${body.unitId} has an out-of-range portal frame`
      );
    }
    if (portalFrame <= previous) {
      throw new MotionGraphValidationError(
        `port ${portId} on body ${body.unitId} portal frames must be sorted and unique`
      );
    }
    previous = portalFrame;
  }

  if (
    body.kind !== "loop" &&
    port.portalFrames.at(-1) !== body.frameCount - 1
  ) {
    throw new MotionGraphValidationError(
      `finite port ${portId} on body ${body.unitId} must include the final frame`
    );
  }

  return port;
}

function assertBody(body: GraphBodyDefinition): void {
  if (!Number.isSafeInteger(body.frameCount) || body.frameCount <= 0) {
    throw new MotionGraphValidationError(
      `body ${body.unitId} frameCount must be a positive safe integer`
    );
  }
  if (body.kind !== "loop" && body.kind !== "finite" && body.kind !== "held") {
    throw new MotionGraphValidationError(
      `body ${body.unitId} has an unknown body kind`
    );
  }
  if (body.kind === "held" && body.frameCount !== 1) {
    throw new MotionGraphValidationError(
      `held body ${body.unitId} must contain exactly one frame`
    );
  }
}

function assertFinishBody(body: GraphBodyDefinition): void {
  assertBody(body);
  if (body.kind === "loop") {
    throw new MotionGraphValidationError(
      `looping body ${body.unitId} cannot use a finish boundary`
    );
  }
}

function assertCurrentFrame(
  body: GraphBodyDefinition,
  currentFrame: number
): void {
  if (
    !Number.isSafeInteger(currentFrame) ||
    currentFrame < 0 ||
    currentFrame >= body.frameCount
  ) {
    throw new MotionGraphValidationError(
      `current frame for body ${body.unitId} is out of range`
    );
  }
}

function freezeBoundary(
  boundaryFrame: number,
  waitFrames: number,
  wraps: boolean
): Readonly<BodyBoundarySearch> {
  return Object.freeze({
    boundaryFrame,
    waitFrames,
    eligibleNow: waitFrames === 0,
    wraps
  });
}
