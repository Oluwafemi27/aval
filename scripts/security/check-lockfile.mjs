#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (lock.lockfileVersion !== 3) throw new Error("package-lock.json must use lockfileVersion 3");
const failures = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === "") continue;
  if (entry.link) continue;
  if (typeof entry.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(entry.version)) failures.push(`${path}: exact version missing`);
  if (typeof entry.resolved === "string" && /^(?:git\+|github:|file:|https?:\/\/(?!registry\.npmjs\.org\/))/iu.test(entry.resolved)) failures.push(`${path}: unapproved dependency source`);
  if (typeof entry.integrity !== "string" && !/^(?:apps|examples|packages)\//u.test(path)) failures.push(`${path}: integrity missing`);
}
if (failures.length > 0) throw new Error(failures.join("\n"));
process.stdout.write(`${JSON.stringify({ status: "passed", packages: Object.keys(lock.packages ?? {}).length - 1 })}\n`);
