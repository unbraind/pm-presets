/** Independent byte oracle: inspect all tracker files, not just settings or SDK projections. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

/** Random credentials and transformations that value-based redaction tends to miss. */
export function secretCorpus(): string[] {
  const token = `synthetic-${randomBytes(18).toString("hex")}`;
  const raw = `${token}\"\\é/end`;
  return [raw, JSON.stringify(raw).slice(1, -1), encodeURIComponent(raw), Buffer.from(raw).toString("base64"), `${token.slice(0, 15)} ${token.slice(15)}`];
}

/** Include every file and filename (history, caches, items, templates and locks included). */
export function trackerBytes(root: string): string {
  const values: string[] = [];
  /** Walk real tracker entries; inspect symlink text without following external trees. */
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      values.push(relative(root, file));
      if (entry.isSymbolicLink()) values.push(readlinkSync(file));
      else if (entry.isDirectory()) walk(file);
      else values.push(readFileSync(file).toString("utf8"));
    }
  }
  walk(root);
  return values.join("\n");
}

/** Never include the forbidden value in assertion errors or test-runner output. */
export function assertNoCredentials(bytes: string, credentials: readonly string[]): void {
  for (const credential of credentials) {
    for (const value of [credential, JSON.stringify(credential).slice(1, -1), encodeURIComponent(credential), Buffer.from(credential).toString("base64")]) {
      assert.ok(!bytes.includes(value), "credential bytes or an encoded representation escaped the external-reference boundary");
    }
    // Split-form detection: substantial halves must not appear independently either.
    assert.ok(!bytes.includes(credential.slice(0, 15)), "a credential fragment escaped the reference boundary");
    assert.ok(!bytes.includes(credential.slice(-12)), "a credential fragment escaped the reference boundary");
  }
}
