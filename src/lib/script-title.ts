/**
 * Turns whatever text the Remix studio has to hand (the session topic, itself
 * prefilled from the source video's caption) into a title short enough to be a title.
 *
 * The Vault's Scripts tab was showing script rows whose `title` ran to two thousand
 * characters, because the save dialog defaulted the title to `session.topic` and the
 * Prompt stage prefills that topic with the entire Instagram caption plus " — for my
 * niche". Both cards and dialogs then clamped the wall down to one line, which hid the
 * smell instead of fixing it. This is the fix at the source: the save dialog defaults
 * to a derived title, and the user can still type anything they want over it.
 */

/** Titles longer than this get cut at the last word boundary that fits. */
export const SCRIPT_TITLE_MAX = 60;

/** Below this, a first "sentence" is more likely a list marker or an abbreviation
 * ("3.", "Ep. 4") than a real sentence, so the fuller line wins. */
const MIN_SENTENCE_LENGTH = 12;

const PLACEHOLDER = "Untitled script";

export function deriveScriptTitle(source: string | null | undefined): string {
  const normalized = (source ?? "").replace(/\s+/g, " ").trim();
  if (normalized === "") return PLACEHOLDER;

  // First sentence, when there is one long enough to stand on its own. This is also
  // what drops the Prompt stage's " — for my niche" suffix from a caption that ends
  // in a full stop, without special-casing that one string.
  const sentence = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0];
  const line = sentence && sentence.length >= MIN_SENTENCE_LENGTH ? sentence : normalized;

  const cleaned = line
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:;|·—–-]+|[\s.,:;|·—–-]+$/g, "");

  if (cleaned === "") return PLACEHOLDER;
  if (cleaned.length <= SCRIPT_TITLE_MAX) return cleaned;

  const cut = cleaned.slice(0, SCRIPT_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  // A single word longer than the cap has no boundary to back off to, so it is cut
  // where it is rather than returned whole.
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[\s.,:;|·—–-]+$/, "")}…`;
}
