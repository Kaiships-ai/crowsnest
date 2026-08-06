/** Vault search (M4-U3). The Vault is a single-user local SQLite database whose four
 * tabs are already read in full on every visit, so search filters those rows in memory
 * rather than adding four indexed LIKE queries: no new query shape, no new index, and
 * the same rows the page already has. If the Vault ever grows past a few thousand rows
 * this is the thing to replace, not the page around it.
 *
 * Lives beside page.tsx rather than in it because a Next.js page module may only export
 * the default component plus Next's own config names, the same reason vault-header-copy
 * is its own module. */

/** True when every whitespace-separated term in `query` appears somewhere in `fields`,
 * case-insensitively. An empty query matches everything, so callers can pass it
 * straight through without branching. Terms are ANDed: "claude design" finds a row
 * mentioning both, in either order, in any of its fields. */
export function matchesQuery(query: string, fields: (string | null | undefined)[]): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  // Joined with a newline so a term can never match across a field boundary (a note
  // ending "cut" and a caption starting "away" must not match "cutaway").
  const haystack = fields.filter((field): field is string => Boolean(field)).join("\n").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
