#!/usr/bin/env node
import { resolve } from "node:path";

import { readStableRegistryState, runRegistryMutation } from "./registry-client.mjs";
import { reconcileRegistryMutation } from "./registry-reconciler.mjs";
import { loadBoundLedger, loadMitigationEvidence, loadPublicationAuthorization, publicationLedgerEnvelope, terminalLedgerStatus, validPublicationApproval, writePublicationLedger } from "./publication-support.mjs";

const args = parse(process.argv.slice(2));
const execute = args.execute === "true";
if (execute && !validPublicationApproval(args.approval)) throw new Error("--approval is required for protected rollback mutation");
const releaseRoot = resolve(required(args, "release-root"));
const output = resolve(required(args, "output"));
const timestamp = args.timestamp ?? new Date().toISOString();
const certification = await import(resolve("packages/certification/dist/index.js"));
const authorization = await loadPublicationAuthorization({
  releaseRoot,
  expectedCandidateDigest: required(args, "expected-candidate-digest"),
  expectedReleaseDigest: required(args, "expected-release-digest"),
  expectedReleaseSetDigest: required(args, "expected-release-set-digest"),
  expectedCommit: required(args, "expected-commit"),
  certification
});
const previous = authorization.policy.rollback.previousKnownGood;
if (typeof previous !== "string" || (previous !== "none" && !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(previous))) throw new Error("rollback policy previous-known-good authority is invalid");
if (previous === "1.0.0") throw new Error("rollback policy may not target the withdrawn release");
if (args.previous !== undefined) throw new Error("--previous is forbidden; the signed release policy is the sole rollback target authority");
const source = await loadBoundLedger({
  path: resolve(required(args, "ledger")),
  expectedDigest: required(args, "expected-ledger-digest"),
  authorization,
  certification
});
if (source.ledger.mode !== "executed" || source.ledger.status !== "passed" || !new Set(["publish-next", "promote-latest"]).has(source.ledger.phase)) throw new Error("rollback requires a passed executed publication/promotion ledger");
const mitigation = await loadMitigationEvidence({
  path: resolve(required(args, "mitigation")),
  expectedDigest: required(args, "expected-mitigation-digest")
});
const registryOptions = { registry: authorization.policy.registry.url };
const operations = [];
let terminalError = null;
const notice = "Withdrawn: see the AVAL 1.0 rollback mitigation notice";

for (const name of certification.rollbackOrder(authorization.releaseSet.order)) {
  const archive = authorization.releaseSet.packages.find((entry) => entry.name === name);
  if (archive === undefined) throw new Error(`rollback package is absent from authorized release: ${name}`);
  const initial = readStableRegistryState(name, "1.0.0", registryOptions);
  if (previous === "none") {
    for (const desiredTag of ["latest", "next"]) {
      const before = desiredTag === "latest" ? initial : readStableRegistryState(name, "1.0.0", registryOptions);
      const tagPlan = certification.planTagCompensation({
        packageName: name,
        version: "1.0.0",
        tarballSha256: archive.tarballSha256,
        registryIntegrity: archive.registryIntegrity,
        sequence: operations.length + 1,
        timestamp,
        approvalId: args.approval ?? "dry-run-no-registry-mutation",
        desiredTag,
        targetVersion: null,
        requiredCurrentTag: "1.0.0",
        registry: before
      });
      if (!execute || tagPlan.result === "already-exact" || tagPlan.result === "conflict") operations.push(tagPlan);
      else {
        const reconciled = reconcileRegistryMutation({
          planned: tagPlan,
          mutate: () => runRegistryMutation(["dist-tag", "rm", name, desiredTag], registryOptions),
          readState: () => readStableRegistryState(name, "1.0.0", registryOptions),
          certification
        });
        operations.push(reconciled.operation);
        if (reconciled.error !== null) { terminalError = reconciled.error; break; }
      }
    }
    if (terminalError !== null) break;
  } else {
    const previousState = readStableRegistryState(name, previous, registryOptions);
    const tagPlan = certification.planExactTag({
      packageName: name,
      version: "1.0.0",
      tarballSha256: archive.tarballSha256,
      registryIntegrity: archive.registryIntegrity,
      sequence: operations.length + 1,
      timestamp,
      approvalId: args.approval ?? "dry-run-no-registry-mutation",
      action: "rollback-tag",
      desiredTag: "latest",
      targetVersion: previous,
      targetVersionAvailable: previousState.integrity !== null,
      registry: initial
    });
    if (!execute || tagPlan.result === "already-exact") operations.push(tagPlan);
    else {
      const reconciled = reconcileRegistryMutation({
        planned: tagPlan,
        mutate: () => runRegistryMutation(["dist-tag", "add", `${name}@${previous}`, "latest"], registryOptions),
        readState: () => readStableRegistryState(name, "1.0.0", registryOptions),
        certification
      });
      operations.push(reconciled.operation);
      if (reconciled.error !== null) { terminalError = reconciled.error; break; }
    }
  }
  const current = execute ? readStableRegistryState(name, "1.0.0", registryOptions) : initial;
  const deprecation = certification.planDeprecation({
    packageName: name,
    version: "1.0.0",
    tarballSha256: archive.tarballSha256,
    registryIntegrity: archive.registryIntegrity,
    sequence: operations.length + 1,
    timestamp,
    approvalId: args.approval ?? "dry-run-no-registry-mutation",
    registry: current,
    message: notice
  });
  if (!execute || deprecation.result === "already-exact") operations.push(deprecation);
  else {
    const reconciled = reconcileRegistryMutation({
      planned: deprecation,
      mutate: () => runRegistryMutation(["deprecate", `${name}@1.0.0`, notice], registryOptions),
      readState: () => readStableRegistryState(name, "1.0.0", registryOptions),
      certification
    });
    operations.push(reconciled.operation);
    if (reconciled.error !== null) { terminalError = reconciled.error; break; }
  }
}

const status = execute ? terminalLedgerStatus(operations, terminalError) : "planned";
const ledger = publicationLedgerEnvelope(authorization, {
  phase: "rollback",
  mode: execute ? "executed" : "dry-run",
  status,
  previousLedgerDigest: source.digest,
  phaseEvidenceDigest: mitigation.digest,
  createdAt: timestamp,
  operations
});
const written = await writePublicationLedger({ output, ledger, certification });
if (terminalError !== null) throw new AggregateError([terminalError], `rollback failed; ledger ${written.digest}`);
if (execute && ledger.status !== "passed") throw new Error(`rollback is ${ledger.status}; ledger ${written.digest}`);
process.stdout.write(`${JSON.stringify({ status: ledger.status, mode: ledger.mode, output, previous, ledgerDigest: written.digest })}\n`);

function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 2) { const key = values[index]; if (!key?.startsWith("--")) throw new Error(`invalid argument ${String(key)}`); result[key.slice(2)] = values[index + 1] ?? "true"; } return result; }
function required(values, key) { const value = values[key]; if (typeof value !== "string" || value.length < 1) throw new Error(`--${key} is required`); return value; }
