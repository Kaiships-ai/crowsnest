const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validMonth(raw: unknown): string | null {
  return typeof raw === "string" && MONTH_RE.test(raw) ? raw : null;
}

/** Where an old /mine link lands: the Calendar tab, carrying only a valid month. A path,
 *  never a full URL, so no param can steer it off-site. */
export function mineRedirectTarget(params: { month?: string | string[] }): string {
  const month = validMonth(params.month);
  return month ? `/?tab=calendar&month=${month}` : "/?tab=calendar";
}
