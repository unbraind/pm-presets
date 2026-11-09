/** Create ordinary empty config files that Git and npm can read on every platform. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Keep config lifetime under the caller's disposable directory and cleanup. */
export function createEmptyToolConfig(directory: string): string {
  const path = join(directory, "empty-tool-config");
  writeFileSync(path, "", { flag: "wx" });
  return path;
}
