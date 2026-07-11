import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { adaptManifestToMotionGraph } from "../src/graph-adapter.js";
import { validateCompiledManifestV01 } from "../src/manifest-schema.js";
import type { CompiledManifestV01 } from "../src/model.js";
import { validManifest } from "./manifest-fixture.js";

describe("adaptManifestToMotionGraph", () => {
  it("maps the complete manifest graph to the hand-written M3 golden", () => {
    const graph = adaptManifestToMotionGraph(
      validateCompiledManifestV01(validManifest())
    );

    expect(graph.definition).toEqual({
      initialState: "a-a",
      states: [
        {
          id: "a-a",
          staticFrameId: "static-a",
          body: {
            unitId: "body-a",
            kind: "loop",
            frameCount: 4,
            ports: [
              { id: "default", entryFrame: 0, portalFrames: [0, 2] }
            ]
          },
          initialUnit: { unitId: "intro-a", frameCount: 2 }
        },
        {
          id: "a-b",
          staticFrameId: "static-b",
          body: {
            unitId: "body-b",
            kind: "finite",
            frameCount: 3,
            ports: [{ id: "default", entryFrame: 0, portalFrames: [2] }]
          }
        },
        {
          id: "a-c",
          staticFrameId: "static-c",
          body: {
            unitId: "body-c",
            kind: "held",
            frameCount: 1,
            ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
          }
        }
      ],
      edges: [
        {
          id: "edge-ab",
          from: "a-a",
          to: "a-b",
          trigger: { type: "event", name: "go-b" },
          start: {
            type: "portal",
            sourcePort: "default",
            targetPort: "default",
            maxWaitFrames: 1
          },
          transition: {
            kind: "locked",
            unitId: "bridge-ab",
            frameCount: 2
          },
          continuity: "exact-authored"
        },
        {
          id: "edge-ac",
          from: "a-a",
          to: "a-c",
          trigger: { type: "event", name: "go-c" },
          start: { type: "cut", targetPort: "default", maxWaitFrames: 1 },
          continuity: "cut"
        },
        {
          id: "edge-ba",
          from: "a-b",
          to: "a-a",
          trigger: { type: "completion" },
          start: { type: "finish", targetPort: "default", maxWaitFrames: 2 },
          continuity: "exact-authored"
        },
        {
          id: "edge-bc",
          from: "a-b",
          to: "a-c",
          trigger: { type: "event", name: "go-c" },
          start: {
            type: "portal",
            sourcePort: "default",
            targetPort: "default",
            maxWaitFrames: 2
          },
          transition: {
            kind: "reversible",
            unitId: "rev-bc",
            frameCount: 6,
            direction: "forward"
          },
          continuity: "exact-authored"
        },
        {
          id: "edge-cb",
          from: "a-c",
          to: "a-b",
          trigger: { type: "event", name: "go-b" },
          start: {
            type: "portal",
            sourcePort: "default",
            targetPort: "default",
            maxWaitFrames: 0
          },
          transition: {
            kind: "reversible",
            unitId: "rev-bc",
            frameCount: 6,
            direction: "reverse",
            reverseOf: "edge-bc"
          },
          continuity: "exact-reverse"
        }
      ]
    });
  });

  it("returns a recursively immutable validated graph detached from the manifest", () => {
    const manifest = validateCompiledManifestV01(validManifest());
    const graph = adaptManifestToMotionGraph(manifest);

    expect(graph.definition.states).not.toBe(manifest.states);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.definition)).toBe(true);
    expect(Object.isFrozen(graph.definition.states[0]?.body.ports[0]?.portalFrames)).toBe(true);
    expect(Object.isFrozen(graph.definition.edges[4]?.transition)).toBe(true);
  });

  it("preserves one shared static descriptor across multiple states", () => {
    const source = structuredClone(validManifest()) as any;
    source.states[1].staticFrame = "static-a";
    source.states[2].staticFrame = "static-a";
    source.staticFrames = [source.staticFrames[0]];

    const graph = adaptManifestToMotionGraph(
      validateCompiledManifestV01(source)
    );
    expect(graph.definition.states.map((state) => state.staticFrameId)).toEqual([
      "static-a",
      "static-a",
      "static-a"
    ]);
  });

  it("wraps M3 geometry and ambiguity failures as GRAPH_INVALID", () => {
    const manifest = structuredClone(validManifest()) as any;
    manifest.edges[0].start.maxWaitFrames = 0;
    const schemaValid = validateCompiledManifestV01(manifest);

    expect(() => adaptManifestToMotionGraph(schemaValid)).toThrowError(
      expect.objectContaining({ name: "FormatError", code: "GRAPH_INVALID" })
    );
  });

  it("wraps malformed trusted input without leaking built-in errors", () => {
    const malformed = {
      ...validManifest(),
      units: []
    } as unknown as CompiledManifestV01;

    try {
      adaptManifestToMotionGraph(malformed);
      throw new Error("expected graph adaptation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FormatError);
      expect((error as FormatError).code).toBe("GRAPH_INVALID");
    }
  });
});
