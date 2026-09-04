/** The header line counts what the Vault actually holds, one clause per category that
 * has rows in it.
 *
 * It used to count saved posts alone, so a Vault holding scripts and no saved posts
 * greeted you with "0 saved posts" while the Scripts tab below it was full. That was a
 * deliberate choice (the header was "about saved posts"), and M4-U3 reverses it: a
 * count of the one tab you might not be looking at is worse than no count, and the
 * per-tab counts now live on the tabs themselves.
 *
 * With a search term the line reports the size of the result instead, across all four
 * tabs, so a search that hides everything on the current tab still says why.
 *
 * This lives in its own module rather than inside page.tsx: a Next.js page module may
 * only export the default component plus a small set of config names (Next's
 * next-types-plugin rejects any other named export at build time), so a plain helper
 * function cannot be exported from page.tsx itself. */
export interface VaultCounts {
  savedPosts: number;
  scripts: number;
  hooks: number;
  styles: number;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function vaultHeaderCopy(counts: VaultCounts, query?: string): string {
  const { savedPosts, scripts, hooks, styles } = counts;
  const total = savedPosts + scripts + hooks + styles;
  const term = query?.trim();

  if (term) {
    if (total === 0) return `No matches for "${term}"`;
    return `${total} ${total === 1 ? "match" : "matches"} for "${term}"`;
  }

  if (total === 0) return "Nothing saved yet.";

  return [
    savedPosts > 0 ? plural(savedPosts, "saved post") : null,
    scripts > 0 ? plural(scripts, "script") : null,
    hooks > 0 ? plural(hooks, "hook") : null,
    styles > 0 ? plural(styles, "style") : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}
