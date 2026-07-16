import { describe, expect, it } from "vitest";

import {
  parseAvalSourceType,
  readElementSourceCandidates
} from "../src/element-source-candidates.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const INTEGRITY = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("element source candidates", () => {
  it("captures only direct HTML source children in DOM order and preserves duplicates", () => {
    const first = source({
      src: "/motion.av1.avl",
      type: 'application/vnd.aval; codecs="av01.0.08M.10"',
      integrity: INTEGRITY
    });
    const duplicate = source({
      src: "/motion.av1.avl",
      type: 'application/vnd.aval; codecs="av01.0.08M.10"',
      integrity: INTEGRITY
    });
    const nested = source({
      src: "/ignored.avl",
      type: 'application/vnd.aval; codecs="avc1.640028"',
      integrity: INTEGRITY
    });
    const host = children([
      first,
      element("img"),
      duplicate,
      element("div", {}, [nested])
    ]);

    const read = readElementSourceCandidates(host as unknown as HTMLElement);

    expect(read.failures).toEqual([]);
    expect(read.candidates.map(({ src, codec }) => ({ src, codec }))).toEqual([
      { src: "/motion.av1.avl", codec: "av01.0.08M.10" },
      { src: "/motion.av1.avl", codec: "av01.0.08M.10" }
    ]);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.candidates)).toBe(true);
    expect(read.candidates.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ['application/vnd.aval; codecs="avc1.640028"', "avc1.640028"],
    ['application/vnd.aval; codecs="hvc1.1.6.L93.B0"', "hvc1.1.6.L93.B0"],
    ['application/vnd.aval; codecs="vp09.00.10.08"', "vp09.00.10.08"],
    [
      'application/vnd.aval; codecs="vp09.00.10.08.01.01.01.01.00"',
      "vp09.00.10.08.01.01.01.01.00"
    ],
    ['application/vnd.aval; codecs="av01.0.08M.10"', "av01.0.08M.10"],
    [
      'application/vnd.aval; codecs="av01.0.08M.10.0.110.01.01.01.0"',
      "av01.0.08M.10.0.110.01.01.01.0"
    ]
  ])("parses exact canonical AVAL source type %s", (type, codec) => {
    expect(parseAvalSourceType(type)).toEqual({ type, codec });
  });

  it.each([
    "application/vnd.aval",
    'application/vnd.aval;codecs="avc1.640028"',
    "application/vnd.aval; codecs=avc1.640028",
    'Application/vnd.aval; codecs="avc1.640028"',
    'application/vnd.aval; codecs="avc1.640028, vp09.00.10.08"',
    'application/vnd.aval; codecs="avc1.640028"; extra=x',
    'application/vnd.aval; codecs="avc1.640028 "',
    'application/vnd.aval; codecs="vp09.00.99.08"',
    'application/vnd.aval; codecs="vp09.99.99.08"',
    'application/vnd.aval; codecs="vp09.00.10.12"',
    'application/vnd.aval; codecs="av01.0.32M.10"',
    'application/vnd.aval; codecs="av01.2.00M.08.0.110.01.01.01.0"',
    'application/vnd.aval; codecs="hvc1.1.6.L93.B0.00"',
    'application/vnd.aval; codecs="hvc1.2.4.L93.B0"',
    'application/vnd.aval; codecs="avc1.000000"',
    'application/vnd.aval; codecs="avc1.640028'.padEnd(257, "x") + '"',
    'application/vnd.aval; codecs="avc1.640028" '
  ])("rejects noncanonical source type without echoing its value", (type) => {
    let failure: unknown;
    try { parseAvalSourceType(type); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(type);
  });

  it("requires bounded nonempty src/type and validates integrity when present", () => {
    const secret = "https://user:pass@example.test/private.avl?token=SECRET";
    const read = readElementSourceCandidates(children([
      source({ src: secret, type: "", integrity: "" }),
      source({
        src: "x".repeat(4_097),
        type: 'application/vnd.aval; codecs="avc1.640028"',
        integrity: INTEGRITY
      }),
      source({
        src: "/bad-integrity.avl",
        type: 'application/vnd.aval; codecs="avc1.640028"',
        integrity: "sha256-secret"
      }),
      source({
        src: "/control\u0000.avl",
        type: 'application/vnd.aval; codecs="avc1.640028"',
        integrity: INTEGRITY
      }),
      source({
        src: "/optional-integrity.avl",
        type: 'application/vnd.aval; codecs="vp09.00.10.08"'
      })
    ]) as unknown as HTMLElement);

    expect(read.candidates).toEqual([{
      src: "/optional-integrity.avl",
      type: 'application/vnd.aval; codecs="vp09.00.10.08"',
      codec: "vp09.00.10.08",
      integrity: ""
    }]);
    expect(read.failures).toEqual([
      { sourceIndex: 0, attribute: "type", code: "invalid-configuration" },
      { sourceIndex: 0, attribute: "integrity", code: "invalid-configuration" },
      { sourceIndex: 1, attribute: "src", code: "invalid-configuration" },
      { sourceIndex: 2, attribute: "integrity", code: "invalid-configuration" },
      { sourceIndex: 3, attribute: "src", code: "invalid-configuration" }
    ]);
    expect(JSON.stringify(read.failures)).not.toContain("SECRET");
    expect(JSON.stringify(read.failures)).not.toContain("pass");
  });

  it("ignores source-looking elements outside the HTML namespace", () => {
    const foreign = element("source", {
      src: "/foreign.avl",
      type: 'application/vnd.aval; codecs="avc1.640028"',
      integrity: INTEGRITY
    }, [], "http://www.w3.org/2000/svg");
    expect(readElementSourceCandidates(children([foreign]) as unknown as HTMLElement))
      .toEqual({ candidates: [], failures: [] });
  });
});

function source(attributes: Readonly<Record<string, string>>): Element {
  return element("source", attributes);
}

function element(
  localName: string,
  attributes: Readonly<Record<string, string>> = {},
  descendants: readonly Element[] = [],
  namespaceURI = HTML_NAMESPACE
): Element {
  const value = {
    nodeType: 1,
    localName,
    namespaceURI,
    getAttribute(name: string) { return attributes[name] ?? null; },
    descendants
  };
  return value as unknown as Element;
}

function children(values: readonly Element[]): Pick<HTMLElement, "children"> {
  return {
    children: {
      length: values.length,
      item(index: number) { return values[index] ?? null; }
    } as unknown as HTMLCollection
  };
}
