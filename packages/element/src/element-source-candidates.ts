import { parseVideoCodecString } from "@pixel-point/aval-player-web";

import { normalizeIntegrity, normalizeSource } from "./element-configuration.js";
import type { AvalSourceCandidate } from "./public-types.js";

export const AVAL_SOURCE_MEDIA_TYPE = "application/vnd.aval" as const;
export const MAX_AVAL_SOURCE_TYPE_CODE_UNITS = 256;
export const MAX_AVAL_SOURCE_CODEC_CODE_UNITS = 128;

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const TYPE_PREFIX = `${AVAL_SOURCE_MEDIA_TYPE}; codecs="`;
const TYPE_SUFFIX = "\"";
export type AvalSourceAttribute = "src" | "type" | "integrity";

export interface ElementSourceCandidateFailure {
  readonly sourceIndex: number;
  readonly attribute: AvalSourceAttribute;
  readonly code: "invalid-configuration";
}

export interface ElementSourceCandidatesRead {
  readonly candidates: readonly Readonly<AvalSourceCandidate>[];
  readonly failures: readonly Readonly<ElementSourceCandidateFailure>[];
}

/**
 * Captures literal direct-child HTML source elements in authored DOM order.
 * Invalid children are omitted and reported without copying authored values.
 */
export function readElementSourceCandidates(
  host: Pick<HTMLElement, "children">
): Readonly<ElementSourceCandidatesRead> {
  const candidates: Readonly<AvalSourceCandidate>[] = [];
  const failures: Readonly<ElementSourceCandidateFailure>[] = [];
  const children = host.children;
  let sourceIndex = 0;
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index);
    if (!isLiteralHtmlSource(child)) continue;
    const read = readCandidate(child, sourceIndex);
    if (read.candidate !== null) candidates.push(read.candidate);
    failures.push(...read.failures);
    sourceIndex += 1;
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    failures: Object.freeze(failures)
  });
}

export function parseAvalSourceType(value: unknown): Readonly<{
  readonly type: AvalSourceCandidate["type"];
  readonly codec: string;
}> {
  if (typeof value !== "string") {
    throw new TypeError("source type must be a string");
  }
  if (value.length > MAX_AVAL_SOURCE_TYPE_CODE_UNITS) {
    throw new RangeError("source type exceeds 256 UTF-16 code units");
  }
  if (!value.startsWith(TYPE_PREFIX) || !value.endsWith(TYPE_SUFFIX)) {
    throw new TypeError("source type must use the exact AVAL media type syntax");
  }
  const codec = value.slice(TYPE_PREFIX.length, -TYPE_SUFFIX.length);
  if (
    codec.length === 0 ||
    codec.length > MAX_AVAL_SOURCE_CODEC_CODE_UNITS ||
    parseVideoCodecString(codec) === undefined
  ) {
    throw new TypeError("source type contains an unsupported codec identifier");
  }
  return Object.freeze({
    type: value as AvalSourceCandidate["type"],
    codec
  });
}

export function isLiteralHtmlSource(value: Node | null): value is Element {
  return value !== null && value.nodeType === 1 &&
    (value as Element).localName === "source" &&
    (value as Element).namespaceURI === HTML_NAMESPACE;
}

function readCandidate(
  element: Element,
  sourceIndex: number
): Readonly<{
  readonly candidate: Readonly<AvalSourceCandidate> | null;
  readonly failures: readonly Readonly<ElementSourceCandidateFailure>[];
}> {
  const failures: Readonly<ElementSourceCandidateFailure>[] = [];
  const read = <T>(
    attribute: AvalSourceAttribute,
    normalize: (value: string | null) => T
  ): T | null => {
    try {
      return normalize(element.getAttribute(attribute));
    } catch {
      failures.push(Object.freeze({
        sourceIndex,
        attribute,
        code: "invalid-configuration" as const
      }));
      return null;
    }
  };
  const src = read("src", (value) => normalizeSource(value ?? ""));
  const parsedType = read("type", parseAvalSourceType);
  const integrity = read("integrity", (value) =>
    value === null ? "" : normalizeIntegrity(value)
  );
  return Object.freeze({
    candidate: src === null || parsedType === null || integrity === null
      ? null
      : Object.freeze({
          src,
          type: parsedType.type,
          codec: parsedType.codec,
          integrity
        }),
    failures: Object.freeze(failures)
  });
}
