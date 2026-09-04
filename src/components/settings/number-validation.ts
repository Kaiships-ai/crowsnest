/** Shared validation for the settings NumberField rows (scoring windows, SLA minutes,
 *  feed floors). Returns a plain error message or null. Kept pure so it is unit-testable
 *  without rendering and reusable as the save gate across every numeric section. */
export function numberFieldError(
  value: string,
  opts: { min?: number; max?: number; integer?: boolean }
): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "Enter a number";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Enter a number";
  if (opts.integer && !Number.isInteger(n)) return "Must be a whole number";
  if (opts.min !== undefined && n < opts.min) return `Must be at least ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `Must be at most ${opts.max}`;
  return null;
}
