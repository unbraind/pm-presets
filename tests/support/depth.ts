/**
 * Full local/release depth is the default. Quick keeps a deterministic tenth
 * of the same seeds, with at least 25 cases capped by the original count.
 */
export function testDepth(full: number): number {
  return process.env.PM_TEST_DEPTH === "quick" ? Math.min(full, Math.max(25, Math.ceil(full / 10))) : full;
}

/** Scale operational test watchdogs for slower runners without disabling them. */
export function testTime(milliseconds: number, factor = process.env.PM_TEST_TIME_SCALE ?? "1"): number {
  const scale = Number(factor);
  if (!Number.isFinite(scale) || scale <= 0 || milliseconds * scale > 2_147_483_647) {
    throw new Error("PM_TEST_TIME_SCALE must be a finite positive timer scale");
  }
  return Math.ceil(milliseconds * scale);
}
