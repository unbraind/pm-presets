/** npm's supported JSON report shapes preserve the same packed artifact boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { packedArchiveFilename } from "./fixtures/npm-pack.ts";

test("npm pack array reports identify the produced archive", () => {
  assert.equal(packedArchiveFilename('[{"filename":"pm-presets-2026.10.29.tgz"}]'), "pm-presets-2026.10.29.tgz");
});

test("npm pack package-keyed reports identify the produced archive", () => {
  assert.equal(packedArchiveFilename('{"pm-presets":{"filename":"pm-presets-2026.10.29.tgz"}}'), "pm-presets-2026.10.29.tgz");
});

test("npm pack reports without an artifact fail before consumer installation", () => {
  for (const report of ["[]", "{}", '[{"filename":3}]']) {
    assert.throws(() => packedArchiveFilename(report), /must report an archive filename/);
  }
});
