import { createHash } from "node:crypto";
import { readVerifiedArtifactReferences, type VerifiedArtifact } from "./artifact-verifier.js";
import { canonicalJsonBytes, DEFAULT_CANONICAL_LIMITS } from "./canonical-json.js";
import type { DigestReference } from "./model.js";
import type { ReportBundlePolicy } from "./report-bundle-policy.js";
import { CertificationValidationError } from "./status.js";

const STRUCTURED_ATTACHMENT_LIMIT = 16 * 1024 * 1024;
const INSPECTION_WINDOW_BYTES = 1024 * 1024;

export async function verifyBundleAttachments(
  root: string,
  references: readonly DigestReference[],
  policy: ReportBundlePolicy
): Promise<ReadonlyMap<string, VerifiedArtifact>> {
  for (const reference of references) requireMediaSpecificBound(reference, policy);
  if (policy.readAttachment === undefined) {
    return readVerifiedArtifactReferences(root, references, {
      maximumBytes: policy.maximumAttachmentBytes,
      allowedMediaTypes: policy.allowedMediaTypes,
      inspectionBytes: INSPECTION_WINDOW_BYTES,
      retainBytes: (reference) => shouldRetainAttachment(reference.mediaType)
    });
  }
  const verified = new Map<string, VerifiedArtifact>();
  for (const reference of references) {
    if (!policy.allowedMediaTypes.has(reference.mediaType)) throw new CertificationValidationError("$attachments", `media type is not allowed: ${reference.mediaType}`);
    const bytes = await policy.readAttachment(root, reference.path);
    if (bytes.byteLength > policy.maximumAttachmentBytes || bytes.byteLength !== reference.byteLength) throw new CertificationValidationError("$attachments", `attachment byte length mismatch: ${reference.path}`);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new CertificationValidationError("$attachments", `attachment digest mismatch: ${reference.path}`);
    const inspectionLength = Math.min(bytes.byteLength, INSPECTION_WINDOW_BYTES);
    verified.set(reference.id, Object.freeze({
      reference,
      prefix: bytes.slice(0, inspectionLength),
      suffix: bytes.slice(bytes.byteLength - inspectionLength),
      bytes: shouldRetainAttachment(reference.mediaType) ? bytes.slice() : null
    }));
  }
  return verified;
}

export function requiredVerifiedAttachment(attachments: ReadonlyMap<string, VerifiedArtifact>, id: string): VerifiedArtifact {
  const artifact = attachments.get(id);
  if (artifact === undefined) throw new CertificationValidationError("$attachments", `verified attachment is missing: ${id}`);
  return artifact;
}

export function requiredVerifiedBytes(attachments: ReadonlyMap<string, VerifiedArtifact>, id: string): Uint8Array {
  const artifact = requiredVerifiedAttachment(attachments, id);
  if (artifact.bytes === null) throw new CertificationValidationError("$attachments", `attachment bytes were not retained: ${id}`);
  return artifact.bytes;
}

export function parseCanonicalBundleJson(bytes: Uint8Array, path: string, maximumBytes: number): unknown {
  const boundedMaximum = Math.min(maximumBytes, STRUCTURED_ATTACHMENT_LIMIT);
  if (bytes.byteLength > boundedMaximum) throw new CertificationValidationError(path, "structured attachment exceeds in-memory parsing limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new CertificationValidationError(path, "attachment is not strict UTF-8 JSON");
  }
  const canonical = canonicalJsonBytes(parsed, { ...DEFAULT_CANONICAL_LIMITS, maxNodes: 1_000_000, maxBytes: boundedMaximum });
  if (canonical.byteLength !== bytes.byteLength || !canonical.every((byte, index) => byte === bytes[index])) {
    throw new CertificationValidationError(path, "JSON attachment is not canonical");
  }
  return parsed;
}

function shouldRetainAttachment(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType === "application/jsonl" || mediaType === "application/vnd.aval.frame-ledger+json";
}

function requireMediaSpecificBound(reference: DigestReference, policy: ReportBundlePolicy): void {
  const structuredLimit = Math.min(policy.maximumAttachmentBytes, STRUCTURED_ATTACHMENT_LIMIT);
  if (shouldRetainAttachment(reference.mediaType) && reference.byteLength > structuredLimit) {
    throw new CertificationValidationError("$attachments", `structured attachment exceeds in-memory parsing limit: ${reference.path}`);
  }
}
