/** Descriptor-bound, bounded file reads shared by public artifact boundaries. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/** Read a regular file once; callers translate any failure into their domain refusal. */
export function readBoundedInputFile(file: string, limit: number): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("input_file_type");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > limit) throw new Error("input_file_size");
    return buffer.subarray(0, size).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
