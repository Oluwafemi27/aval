import {
  boundedArray,
  compareEndpoint,
  digest,
  exactKeys,
  identifier,
  integerInRange,
  invalid,
  literal,
  nonNegativeInteger,
  oneOf,
  positiveInteger,
  quote,
  record,
  requireIdOrder,
  requireNumberOrder,
  tuple
} from "./manifest-validation.js";
import {
  MAX_RUNWAY_FRAMES,
  MIN_RUNWAY_FRAMES
} from "./manifest-constraints.js";
import { FormatError } from "./errors.js";
import type {
  FormatBudgets,
  PortV01,
  RenditionV01,
  ResidencyEndpointV01,
  SampleSpanV01,
  UnitV01
} from "./model.js";
import {
  createCanonicalSamplePlan,
  type CanonicalSamplePlan,
  type CanonicalSampleSpan
} from "./sample-plan.js";

export function cloneUnits(
  value: unknown,
  renditions: readonly RenditionV01[],
  budgets: FormatBudgets,
  path: string
): readonly UnitV01[] {
  const inputs = boundedArray(value, path, 1, budgets.maxUnits);
  const planUnits: { readonly id: string; readonly frameCount: number }[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const unitInput = record(inputs[index], `${path}[${String(index)}]`);
    const frameCount = positiveInteger(
      unitInput.frameCount,
      `${path}[${String(index)}].frameCount`
    );
    planUnits.push({
      id: identifier(unitInput.id, `${path}[${String(index)}].id`),
      frameCount
    });
  }
  let samplePlan: Readonly<CanonicalSamplePlan>;
  try {
    samplePlan = createCanonicalSamplePlan(
      renditions,
      planUnits,
      budgets.maxSampleRecords,
      budgets.maxTotalUnitFrames
    );
  } catch (error) {
    if (error instanceof FormatError) invalid(path, error.message);
    invalid(path, "canonical sample plan could not be derived");
  }

  const units: UnitV01[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const unit = cloneUnit(
      inputs[index],
      budgets,
      samplePlan.unitSpans[index] ?? [],
      `${path}[${String(index)}]`
    );
    units.push(unit);
  }
  requireIdOrder(units, path);
  return Object.freeze(units);
}

function cloneUnit(
  value: unknown,
  budgets: FormatBudgets,
  expectedSpans: readonly CanonicalSampleSpan[],
  path: string
): UnitV01 {
  const input = record(value, path);
  const kind = input.kind;
  if (kind === "body") {
    exactKeys(
      input,
      ["id", "kind", "playback", "frameCount", "ports", "samples"],
      path
    );
    const id = identifier(input.id, `${path}.id`);
    const playback = oneOf(input.playback, ["loop", "finite"], `${path}.playback`);
    const frameCount = positiveInteger(input.frameCount, `${path}.frameCount`);
    if (playback === "loop" && frameCount < 2) {
      invalid(`${path}.frameCount`, "looping bodies require at least two frames");
    }
    const ports = clonePorts(
      input.ports,
      frameCount,
      budgets.maxPortsPerBody,
      `${path}.ports`
    );
    const samples = cloneSampleSpans(
      input.samples,
      expectedSpans,
      frameCount,
      `${path}.samples`
    );
    return Object.freeze({ id, kind, playback, frameCount, ports, samples });
  }

  if (kind === "bridge" || kind === "one-shot") {
    exactKeys(input, ["id", "kind", "frameCount", "samples"], path);
    const id = identifier(input.id, `${path}.id`);
    const frameCount = positiveInteger(input.frameCount, `${path}.frameCount`);
    const samples = cloneSampleSpans(
      input.samples,
      expectedSpans,
      frameCount,
      `${path}.samples`
    );
    return Object.freeze({ id, kind, frameCount, samples });
  }

  if (kind === "reversible") {
    exactKeys(
      input,
      ["id", "kind", "frameCount", "residency", "samples"],
      path
    );
    const id = identifier(input.id, `${path}.id`);
    const frameCount = positiveInteger(
      input.frameCount,
      `${path}.frameCount`,
      budgets.maxReversibleFrames
    );
    const residencyInput = record(input.residency, `${path}.residency`);
    exactKeys(residencyInput, ["endpoints"], `${path}.residency`);
    const endpointsInput = tuple(
      residencyInput.endpoints,
      2,
      `${path}.residency.endpoints`
    );
    const first = cloneResidencyEndpoint(
      endpointsInput[0],
      `${path}.residency.endpoints[0]`
    );
    const second = cloneResidencyEndpoint(
      endpointsInput[1],
      `${path}.residency.endpoints[1]`
    );
    if (compareEndpoint(first, second) >= 0) {
      invalid(
        `${path}.residency.endpoints`,
        "must be distinct and sorted by state then port"
      );
    }
    const residency = Object.freeze({
      endpoints: Object.freeze([first, second]) as readonly [
        ResidencyEndpointV01,
        ResidencyEndpointV01
      ]
    });
    const samples = cloneSampleSpans(
      input.samples,
      expectedSpans,
      frameCount,
      `${path}.samples`
    );
    return Object.freeze({ id, kind, frameCount, residency, samples });
  }

  invalid(`${path}.kind`, "must be body, bridge, reversible, or one-shot");
}

function clonePorts(
  value: unknown,
  frameCount: number,
  maximum: number,
  path: string
): readonly PortV01[] {
  const inputs = boundedArray(value, path, 0, maximum);
  const ports = inputs.map((entry, index) => {
    const portPath = `${path}[${String(index)}]`;
    const input = record(entry, portPath);
    exactKeys(input, ["id", "entryFrame", "portalFrames"], portPath);
    const id = identifier(input.id, `${portPath}.id`);
    literal(input.entryFrame, 0, `${portPath}.entryFrame`);
    const frameInputs = boundedArray(
      input.portalFrames,
      `${portPath}.portalFrames`,
      1,
      frameCount
    );
    const portalFrames = frameInputs.map((frame, frameIndex) =>
      integerInRange(
        frame,
        `${portPath}.portalFrames[${String(frameIndex)}]`,
        0,
        frameCount - 1
      )
    );
    requireNumberOrder(portalFrames, `${portPath}.portalFrames`);
    return Object.freeze({
      id,
      entryFrame: 0,
      portalFrames: Object.freeze(portalFrames)
    });
  });
  requireIdOrder(ports, path);
  return Object.freeze(ports);
}

function cloneResidencyEndpoint(
  value: unknown,
  path: string
): ResidencyEndpointV01 {
  const input = record(value, path);
  exactKeys(input, ["state", "port", "frames"], path);
  return Object.freeze({
    state: identifier(input.state, `${path}.state`),
    port: identifier(input.port, `${path}.port`),
    frames: integerInRange(
      input.frames,
      `${path}.frames`,
      MIN_RUNWAY_FRAMES,
      MAX_RUNWAY_FRAMES
    )
  });
}

function cloneSampleSpans(
  value: unknown,
  expectedSpans: readonly CanonicalSampleSpan[],
  frameCount: number,
  path: string
): readonly SampleSpanV01[] {
  const inputs = tuple(value, expectedSpans.length, path);
  const spans = inputs.map((entry, renditionIndex) => {
    const spanPath = `${path}[${String(renditionIndex)}]`;
    const input = record(entry, spanPath);
    exactKeys(input, ["rendition", "sampleStart", "sampleCount", "sha256"], spanPath);
    const rendition = identifier(input.rendition, `${spanPath}.rendition`);
    const expected = expectedSpans[renditionIndex];
    const expectedRendition = expected?.renditionId;
    if (rendition !== expectedRendition) {
      invalid(`${spanPath}.rendition`, `must be ${quote(expectedRendition ?? "")}`);
    }
    const sampleStart = nonNegativeInteger(input.sampleStart, `${spanPath}.sampleStart`);
    const sampleCount = positiveInteger(input.sampleCount, `${spanPath}.sampleCount`);
    if (sampleCount !== frameCount) {
      invalid(`${spanPath}.sampleCount`, "must equal the unit frameCount");
    }
    if (expected === undefined || sampleStart !== expected.sampleStart) {
      invalid(
        `${spanPath}.sampleStart`,
        `must be ${String(expected?.sampleStart ?? 0)}`
      );
    }
    return Object.freeze({
      rendition,
      sampleStart,
      sampleCount,
      sha256: digest(input.sha256, `${spanPath}.sha256`)
    });
  });
  return Object.freeze(spans);
}
