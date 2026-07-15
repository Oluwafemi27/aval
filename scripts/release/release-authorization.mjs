import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, open, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { reconstructReportIndex } from "../certification/report-index-reconstruction.mjs";
import { readVerifiedRegularFile } from "./candidate-artifacts.mjs";
import { verifyCandidateRoot } from "./candidate-root.mjs";
import { collectSelfContainedReportSet } from "./release-report-set.mjs";

export async function loadReleaseAuthorization({ releaseRoot, expectedCandidateDigest, expectedReleaseDigest, expectedCommit, certification } = {}) {
  const root = await realpath(resolve(releaseRoot));
  const candidatePath = join(root, "candidate", "candidate-manifest.json");
  const releasePath = join(root, "release-manifest.json");
  const verifiedCandidate = await verifyCandidateRoot({ manifestPath: candidatePath, expectedDigest: expectedCandidateDigest, certification });
  if (expectedCommit !== undefined && verifiedCandidate.candidate.commit !== expectedCommit) throw new Error("release authorization candidate commit does not match protected source intent");
  const releaseBytes = await readVerifiedRegularFile("release-manifest.json", root, verifiedCandidate.policy.limits.maximumReportBytes);
  const releaseDigest = sha256(releaseBytes);
  if (releaseDigest !== expectedReleaseDigest) throw new Error("release authorization manifest digest mismatch");
  let release;
  try { release = certification.validateReleaseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(releaseBytes)), verifiedCandidate.digest); }
  catch (error) { throw new Error("release authorization manifest is invalid", { cause: error }); }
  if (Buffer.compare(releaseBytes, certification.canonicalJsonBytes(release)) !== 0) throw new Error("release authorization manifest is not canonical JSON");
  if (release.releaseSetDigest !== verifiedCandidate.releaseSet.releaseSetDigest) throw new Error("release authorization package-set digest mismatch");
  if (release.previousKnownGood !== verifiedCandidate.policy.rollback.previousKnownGood || release.rollbackTag !== verifiedCandidate.policy.rollback.releaseDistTag) throw new Error("release authorization rollback policy mismatch");
  const indexReference = release.artifacts.find(({ id }) => id === "certification-report-index");
  if (indexReference === undefined || indexReference.path !== "reports/index.json") throw new Error("release authorization is missing the self-contained report index");
  const indexPath = join(root, "reports", "index.json");
  const reportIndex = await reconstructReportIndex({
    indexPath,
    candidatePath,
    certification,
    policy: verifiedCandidate.policy,
    referenceRoot: join(root, "reports")
  });
  if (sha256(reportIndex.indexBytes) !== indexReference.sha256 || reportIndex.indexBytes.byteLength !== indexReference.byteLength) throw new Error("release authorization report-index reference mismatch");
  if (reportIndex.index.releaseStatus !== "passed" || reportIndex.index.runtimeScheduling !== "passed") throw new Error("release authorization report index has not passed");
  if (reportIndex.latestEvidenceAt === null || Date.parse(release.createdAt) < Date.parse(reportIndex.latestEvidenceAt)) throw new Error("release authorization timestamp precedes candidate, report, or review evidence");
  const reportSet = await collectSelfContainedReportSet({
    index: reportIndex.index,
    indexBytes: reportIndex.indexBytes,
    indexPath,
    referenceRoot: join(root, "reports"),
    releaseRoot: root
  });
  const candidateReference = {
    id: "candidate-manifest",
    path: "candidate/candidate-manifest.json",
    sha256: verifiedCandidate.digest,
    byteLength: verifiedCandidate.bytes.byteLength,
    mediaType: "application/json"
  };
  requireSame(release.reports, reportSet.reports, certification, "release authorization report references");
  requireSame(release.artifacts, [...reportSet.artifacts, candidateReference], certification, "release authorization artifact references");
  requireSame(release.reviews, certification.assertApprovedReviews(reportIndex.index.reviews), certification, "release authorization review decisions");
  await assertClosedReleaseRoot(root);
  return Object.freeze({ ...verifiedCandidate, root, candidatePath, releasePath, releaseBytes, releaseDigest, release, reportIndex, reportSet });
}

/** Copy the already-verified in-memory archive bytes into one private immutable staging directory. */
export async function stageAuthorizedReleaseSet(authorization) {
  const root = await mkdtemp(join(tmpdir(), "aval-publish-"));
  await chmod(root, 0o700);
  const packages = [];
  try {
    for (const entry of authorization.releaseSet.packages) {
      const path = join(root, entry.filename);
      const handle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o400);
      try { await handle.writeFile(entry.bytes); await handle.sync(); }
      finally { await handle.close(); }
      const staged = await readVerifiedRegularFile(entry.filename, root, entry.byteLength);
      if (staged.byteLength !== entry.byteLength || sha256(staged) !== entry.tarballSha256 || Buffer.compare(staged, entry.bytes) !== 0) throw new Error(`private publication staging changed ${entry.name}`);
      const { bytes: _authorizedBytes, ...identity } = entry;
      packages.push(Object.freeze({ ...identity, path }));
    }
    return Object.freeze({ root, packages: Object.freeze(packages), dispose: () => rm(root, { recursive: true, force: true }) });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyStagedArchive(entry) {
  const bytes = await readVerifiedRegularFile(basename(entry.path), dirname(entry.path), entry.byteLength);
  if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.tarballSha256) throw new Error(`staged archive identity changed: ${entry.name}`);
}

async function assertClosedReleaseRoot(root) {
  const entries = (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const actual = entries.map(({ name }) => name);
  if (JSON.stringify(actual) !== JSON.stringify(["candidate", "release-manifest.json", "reports"])) throw new Error(`release authorization root has unexpected entries: ${actual.join(", ")}`);
  if (!entries[0]?.isDirectory() || !entries[1]?.isFile() || !entries[2]?.isDirectory()) throw new Error("release authorization root layout is invalid");
}
function requireSame(left, right, certification, label) { if (Buffer.compare(certification.canonicalJsonBytes(left), certification.canonicalJsonBytes(right)) !== 0) throw new Error(`${label} do not reconstruct from final bytes`); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
