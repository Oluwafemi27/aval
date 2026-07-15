import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  isDefinitiveRegistryNotFound,
  parseRegistryJson,
  readRegistryState,
  readStableRegistryState,
  runRegistryMutation
} from "../../scripts/release/registry-client.mjs";

const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

describe("fail-closed npm registry reads", () => {
  it("allows absence only for a definitive E404", () => {
    expect(isDefinitiveRegistryNotFound("npm ERR! code E404\n404 Not Found")).toBe(true);
    expect(isDefinitiveRegistryNotFound('{"code":"E404"}')).toBe(true);
    expect(isDefinitiveRegistryNotFound("npm ERR! code E401 unauthorized")).toBe(false);
    expect(isDefinitiveRegistryNotFound("ENETUNREACH registry.npmjs.org")).toBe(false);
    expect(isDefinitiveRegistryNotFound("ETIMEDOUT")).toBe(false);
  });

  it("rejects malformed and oversized registry JSON instead of treating it as absence", () => {
    expect(parseRegistryJson('{"next":"1.0.0"}')).toEqual({ next: "1.0.0" });
    expect(() => parseRegistryJson("not-json")).toThrow(/malformed/u);
    expect(() => parseRegistryJson(" ".repeat(4 * 1024 * 1024 + 1))).toThrow(/oversized/u);
  });

  it("reads exact integrity, tags, and deprecation through an injectable fail-closed transport", () => {
    const replies = [
      { status: 0, stdout: JSON.stringify(integrity), stderr: "" },
      { status: 0, stdout: '{"next":"1.0.0","latest":"0.9.0"}', stderr: "" },
      { status: 0, stdout: '"Withdrawn"', stderr: "" }
    ];
    const calls: string[][] = [];
    const spawn = (_command: string, args: readonly string[]) => {
      calls.push([...args]);
      return replies.shift()!;
    };
    expect(readRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn, registry: "https://registry.npmjs.org/" })).toEqual({
      name: "@pixel-point/aval-graph", version: "1.0.0", integrity,
      tags: { next: "1.0.0", latest: "0.9.0" }, deprecation: "Withdrawn"
    });
    expect(calls).toHaveLength(3);
    expect(calls.every((args) => args.slice(-2).join(" ") === "--registry https://registry.npmjs.org/")).toBe(true);
  });

  it("does not turn auth, timeout, malformed JSON, or mutation failure into package absence", () => {
    for (const diagnostics of ["npm ERR! code E401", "ETIMEDOUT", "ENETUNREACH"]) {
      const spawn = () => ({ status: 1, stdout: "", stderr: diagnostics });
      expect(() => readRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn })).toThrow(/failed closed/u);
    }
    const malformed = () => ({ status: 0, stdout: "not-json", stderr: "" });
    expect(() => readRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn: malformed })).toThrow(/malformed/u);
    const mutation = () => ({ status: 1, stdout: "", stderr: "denied" });
    expect(() => runRegistryMutation(["dist-tag", "add", "@pixel-point/aval-graph@1.0.0", "latest"], { spawn: mutation })).toThrow(/status 1/u);
    expect(() => readRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn: malformed, registry: "http://registry.npmjs.org/" })).toThrow(/canonical HTTPS/u);
    expect(() => runRegistryMutation(["publish", "package.tgz"], { spawn: mutation })).toThrow(/disable lifecycle/u);
    expect(() => runRegistryMutation(["publish", "package.tgz", "--ignore-scripts", "--registry", "https://attacker.invalid/"], { spawn: mutation })).toThrow(/override/u);
  });

  it("requires two identical complete reads before treating registry state as stable", () => {
    const stableReplies = [
      JSON.stringify(integrity), '{"next":"1.0.0"}', 'null',
      JSON.stringify(integrity), '{"next":"1.0.0"}', 'null'
    ];
    const stableSpawn = () => ({ status: 0, stdout: stableReplies.shift()!, stderr: "" });
    expect(readStableRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn: stableSpawn })).toMatchObject({ integrity, tags: { next: "1.0.0" } });

    const states = ["1.0.0", "1.0.1", "1.0.2"];
    const unstableReplies = states.flatMap((tag) => ['"sha512-exact"', `{\"next\":\"${tag}\"}`, 'null']);
    for (let index = 0; index < unstableReplies.length; index += 3) unstableReplies[index] = JSON.stringify(integrity);
    const unstableSpawn = () => ({ status: 0, stdout: unstableReplies.shift()!, stderr: "" });
    expect(() => readStableRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn: unstableSpawn })).toThrow(/did not stabilize/u);
  });

  it("rejects noncanonical integrity and unbounded dist-tag maps", () => {
    const noncanonical = [
      { status: 0, stdout: '"sha512-short"', stderr: "" },
      { status: 0, stdout: "{}", stderr: "" },
      { status: 0, stdout: "null", stderr: "" }
    ];
    expect(() => readRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn: () => noncanonical.shift()! })).toThrow(/noncanonical integrity/u);
    const tags = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`tag${String(index)}`, "1.0.0"]));
    const oversized = [
      { status: 0, stdout: JSON.stringify(integrity), stderr: "" },
      { status: 0, stdout: JSON.stringify(tags), stderr: "" },
      { status: 0, stdout: "null", stderr: "" }
    ];
    expect(() => readRegistryState("@pixel-point/aval-graph", "1.0.0", { spawn: () => oversized.shift()! })).toThrow(/too many dist-tags/u);
  });

  it("keeps publish, promotion, and rollback dry-runs on real registry reads", async () => {
    for (const path of ["scripts/release/publish-exact.mjs", "scripts/release/promote-dist-tags.mjs", "scripts/release/rollback-dist-tags.mjs"]) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/execute\s*\?\s*readRegistryState/u);
      expect(source).not.toMatch(/integrity:\s*null,\s*tags:\s*\{\}/u);
      expect(source).toContain("readStableRegistryState(");
    }
    const promotion = await readFile("scripts/release/promote-dist-tags.mjs", "utf8");
    expect(promotion).toContain("planTagCompensation");
    expect(promotion).toMatch(/\.filter\([\s\S]+\)\.reverse\(\)/u);
  });
});
