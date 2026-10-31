/** Decode npm 11 array and npm 12 package-keyed artifact reports identically. */
import assert from "node:assert/strict";

/** Return the archive selected by a successful single-package npm pack command. */
export function packedArchiveFilename(stdout: string): string {
  const [metadata] = Object.values(JSON.parse(stdout)) as Array<{ filename?: unknown }>;
  assert.equal(typeof metadata?.filename, "string", "npm pack must report an archive filename");
  return metadata.filename as string;
}
