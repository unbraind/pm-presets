/** JSON keys are own data, including names inherited by ordinary JavaScript objects. */

/** Define a mutable enumerable JSON field without invoking inherited setters. */
export function setJsonProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
