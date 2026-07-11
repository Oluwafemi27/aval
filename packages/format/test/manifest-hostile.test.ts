import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { validateCompiledManifestV01 } from "../src/manifest-schema.js";
import { validManifest } from "./manifest-fixture.js";

describe("hostile compiled manifests", () => {
  it("rejects unknown and union-inapplicable fields with stable paths", () => {
    const cases: readonly [string, (manifest: any) => void][] = [
      ["manifest", (m) => { m.unknown = true; }],
      ["canvas", (m) => { m.canvas.unknown = true; }],
      ["renditions[0]", (m) => { m.renditions[0].bitrate = { average: 1, peak: 1 }; }],
      ["renditions[0].alphaLayout", (m) => { m.renditions[0].alphaLayout.colorRect = [0, 0, 1, 1]; }],
      ["units[0]", (m) => { m.units[0].residency = { endpoints: [] }; }],
      ["units[3]", (m) => { m.units[3].ports = []; }],
      ["states[1]", (m) => { m.states[1].mystery = "x"; }],
      ["edges[0].trigger", (m) => { m.edges[0].trigger.extra = true; }],
      ["edges[0].start", (m) => { m.edges[0].start.targetRunwayFrames = 6; }],
      ["edges[0].transition", (m) => { m.edges[0].transition.reverseOf = "x"; }],
      ["edges[1]", (m) => { m.edges[1].transition = { kind: "locked", unit: "bridge-ab" }; }],
      ["bindings[0]", (m) => { m.bindings[0].extra = 1; }],
      ["readiness", (m) => { m.readiness.extra = []; }],
      ["fallback", (m) => { m.fallback.extra = true; }],
      ["limits", (m) => { m.limits.extra = 0; }]
    ];

    for (const [path, mutate] of cases) {
      const manifest = mutableManifest();
      mutate(manifest);
      expectInvalid(manifest, path);
    }
  });

  it("rejects nulls, sparse arrays, unsafe integers, and malformed tuples", () => {
    const cases: readonly [string, (manifest: any) => void][] = [
      ["canvas", (m) => { m.canvas = null; }],
      ["generator", (m) => { m.generator = null; }],
      ["generator", (m) => { m.generator = "\u0000"; }],
      ["generator", (m) => { m.generator = "\ud800"; }],
      ["canvas.pixelAspect", (m) => { m.canvas.pixelAspect = [1]; }],
      ["canvas.width", (m) => { m.canvas.width = Number.MAX_SAFE_INTEGER + 1; }],
      ["frameRate.numerator", (m) => { m.frameRate.numerator = 61; }],
      ["renditions[0].capabilities", (m) => { m.renditions[0].capabilities = ["webgl2"]; }],
      ["units[0].ports[0].portalFrames[0]", (m) => { m.units[0].ports[0].portalFrames[0] = -1; }],
      ["units[0].samples[0].sampleStart", (m) => { m.units[0].samples[0].sampleStart = 0.5; }],
      ["staticFrames[0].length", (m) => { m.staticFrames[0].length = 0; }],
      ["states[0]", (m) => { m.states = Array(1); }],
      ["edges[0].start.maxWaitFrames", (m) => { m.edges[0].start.maxWaitFrames = -1; }],
      ["readiness.bootstrapUnits", (m) => { m.readiness.bootstrapUnits = ["body-a", "body-a"]; }]
    ];
    for (const [path, mutate] of cases) {
      const manifest = mutableManifest();
      mutate(manifest);
      expectInvalid(manifest, path);
    }
  });

  it("never leaks built-in errors from hostile records", () => {
    const manifest = mutableManifest();
    Object.defineProperty(manifest.canvas, "width", {
      enumerable: true,
      get() {
        throw new RangeError("hostile getter");
      }
    });

    expect(() => validateCompiledManifestV01(manifest)).toThrowError(
      expect.objectContaining({ name: "FormatError", code: "MANIFEST_INVALID" })
    );
  });

  it("rejects oversized bounded arrays and tuples before sparse traversal", () => {
    let boundedIndexProbes = 0;
    const bounded = mutableManifest();
    bounded.states = new Proxy(Array(1_000_000), {
      getOwnPropertyDescriptor(target, key) {
        if (key !== "length") boundedIndexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    expectInvalid(bounded, "states");
    expect(boundedIndexProbes).toBe(0);

    let tupleIndexProbes = 0;
    const tuple = mutableManifest();
    tuple.canvas.pixelAspect = new Proxy(Array(1_000_000), {
      getOwnPropertyDescriptor(target, key) {
        if (key !== "length") tupleIndexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    expectInvalid(tuple, "canvas.pixelAspect");
    expect(tupleIndexProbes).toBe(0);

    for (const field of ["bootstrapUnits", "immediateEdges"] as const) {
      let readinessIndexProbes = 0;
      const readiness = mutableManifest();
      readiness.readiness[field] = new Proxy(Array(1_000_000), {
        getOwnPropertyDescriptor(target, key) {
          if (key !== "length") readinessIndexProbes += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
      });
      expectInvalid(readiness, `readiness.${field}`);
      expect(readinessIndexProbes, field).toBe(0);
    }
  });

  it("rejects symbol fields and malformed lower-only options", () => {
    const manifest = mutableManifest();
    manifest.canvas[Symbol("hidden")] = 1;
    expectInvalid(manifest, "canvas");

    expect(() =>
      validateCompiledManifestV01(validManifest(), {
        budgets: { maxStates: 33 }
      })
    ).toThrowError(expect.objectContaining({ code: "INPUT_INVALID" }));
    expect(() =>
      validateCompiledManifestV01(validManifest(), {
        budgets: { maxStates: -1 }
      })
    ).toThrowError(expect.objectContaining({ code: "INPUT_INVALID" }));
  });
});

function mutableManifest(): any {
  return structuredClone(validManifest());
}

function expectInvalid(value: unknown, path: string): void {
  try {
    validateCompiledManifestV01(value);
    throw new Error(`expected manifest validation to fail at ${path}`);
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe("MANIFEST_INVALID");
    expect((error as FormatError).path).toBe(path);
  }
}
