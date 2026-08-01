/** The header line is about saved posts, so it keeps counting them even when the count
 * is zero, EXCEPT when the whole Vault (saved posts, scripts, hooks, and styles alike)
 * is empty, only then does the header claim the whole Vault is empty, rather than
 * showing "0 saved posts" while, say, Scripts has content.
 *
 * This lives in its own module rather than inside page.tsx: a Next.js page module may
 * only export the default component plus a small set of config names (Next's
 * next-types-plugin rejects any other named export at build time), so a plain helper
 * function cannot be exported from page.tsx itself. */
export function vaultHeaderCopy(counts: {
  savedPosts: number;
  scripts: number;
  hooks: number;
  styles: number;
}): string {
  const { savedPosts, scripts, hooks, styles } = counts;
  if (savedPosts === 0 && scripts === 0 && hooks === 0 && styles === 0) {
    return "Nothing saved yet.";
  }
  return `${savedPosts} saved post${savedPosts === 1 ? "" : "s"}`;
}
