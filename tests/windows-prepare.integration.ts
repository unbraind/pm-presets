/**
 * Exercises the canonical `pm-ops/merge-driver` installer through a real
 * Windows command parser, from this package's own CI.
 *
 * The launcher delegates to `runPrepareMergeDriver`, so this is the production
 * lifecycle: `pm` is resolved from PATH, and the directory holding the `.cmd`
 * shim contains spaces and a literal `%USERNAME%` segment. The installer must
 * hand cmd.exe only the constant command `pm merge install`, never the
 * interpolated path, or the percent segment would expand and the spaces
 * would split the command.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPrepareMergeDriver } from "pm-ops/merge-driver";

test("the canonical installer survives spaces and literal percent-delimited PATH segments on Windows", (t) => {
  assert.strictEqual(process.platform, "win32");
  const directory = mkdtempSync(join(tmpdir(), "pm presets %USERNAME% "));
  const marker = join(directory, "installed.txt");
  writeFileSync(join(directory, "pm.cmd"), '@echo off\r\n> "%PM_PRESETS_TEST_MARKER%" echo installed\r\n');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = { ...process.env, PATH: directory, PATHEXT: ".CMD", PM_PRESETS_TEST_MARKER: marker };
  assert.strictEqual(runPrepareMergeDriver(environment, "win32"), 0);
  assert.strictEqual(readFileSync(marker, "utf8").trim(), "installed");
});
