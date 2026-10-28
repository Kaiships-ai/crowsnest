"use server";

import { LEGACY_UMAMI_SECRETS, umami, umamiAccess, websiteLine } from "../connectors/umami";
import { listUmamiWebsites, pullUmami, umamiBase, type UmamiWebsite } from "../connectors/umami/pull";
import { readSecret, writeSecrets } from "../connectors/secrets";
import type { SimpleResult } from "../lib/action-result";
import { clockNow } from "../lib/clock";
import { log } from "../lib/logger";
import type { PullResult } from "../lib/pull-result";
import { recordPullEnd, recordPullProgress, recordPullStart, recordSample } from "../services/connector-status";

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Test connection in the key dialog: lists the websites the pasted key can read, nothing saved. */
export async function testUmamiKeyAction(url: string, apiKey: string): Promise<{ ok: true; websites: UmamiWebsite[] } | { ok: false; message: string }> {
  try {
    const websites = await listUmamiWebsites(url, apiKey.trim());
    if (websites.length === 0) return { ok: false, message: "The key works, but it cannot read any website. Add one in Umami, then test again." };
    return { ok: true, websites };
  } catch (err) {
    return { ok: false, message: messageOf(err) };
  }
}

/** Save in the key dialog: checks the pick again, stores address, key and website, and clears an older build's login. */
export async function saveUmamiKeyAction(url: string, rawKey: string, websiteId: string): Promise<SimpleResult> {
  const apiKey = rawKey.trim();
  const tested = await testUmamiKeyAction(url, apiKey);
  if (!tested.ok) return { ok: false, error: tested.message };
  const website = tested.websites.find((w) => w.id === websiteId);
  if (!website) return { ok: false, error: "That website is not readable with this key. Test again and pick one." };
  const address = umamiBase(url);
  try {
    writeSecrets(umami, [["UMAMI_URL", address], ["UMAMI_API_KEY", apiKey], ["UMAMI_WEBSITE_ID", websiteId]], LEGACY_UMAMI_SECRETS);
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
  recordSample(umami.id, { ok: true, line: websiteLine(website, address) });
  return { ok: true };
}

/** The saved address, to fill the dialog; an older build's saved address carries over. Not a secret. */
export async function umamiAddressAction(): Promise<string | null> {
  return readSecret(umami, "UMAMI_URL") ?? null;
}

// ponytail: one card pull at a time in the app's one main process, so a module flag is the Stop.
let cardPull: { stop: boolean } | null = null;

/** Pull funnel from the Umami card. Returns once the pull starts; the card reads its progress from the row. */
export async function startUmamiPullAction(): Promise<SimpleResult> {
  if (cardPull) return { ok: false, error: "A funnel pull is already running." };
  const access = umamiAccess();
  if (!access) return { ok: false, error: "Connect Umami first." };
  const pull = { stop: false };
  cardPull = pull;
  const startedAt = clockNow();
  let last = { done: 0, total: 0 };
  recordPullStart(umami.id);
  void (async () => {
    let result: PullResult<unknown, unknown> = { kind: "failed", reason: "the pull did not finish" };
    try {
      result = await pullUmami(access, startedAt, {
        shouldStop: () => pull.stop,
        onPage: (p) => {
          last = p;
          recordPullProgress(umami.id, p);
        },
      });
    } catch (err) {
      result = { kind: "failed", reason: messageOf(err) };
      log.error("umami.card_pull.unexpected", { error: messageOf(err) });
    } finally {
      cardPull = null;
      recordPullEnd(umami.id, result, {
        total: last.total,
        done: last.done,
        updated: result.kind === "complete" ? last.done : 0,
        newItems: 0,
        failed: 0,
        durationSec: Math.round((clockNow().getTime() - startedAt.getTime()) / 1000),
        startedAt: startedAt.toISOString(),
        stop: pull.stop && result.kind === "partial" ? "stopped" : null,
        items: [],
      });
    }
  })().catch((err: unknown) => log.error("umami.card_pull.record_failed", { error: messageOf(err) }));
  return { ok: true };
}

/** Stop on the Umami card: the page in hand finishes, then the pull ends as Partial and stores nothing. */
export async function stopUmamiPullAction(): Promise<SimpleResult> {
  if (cardPull) cardPull.stop = true;
  return { ok: true };
}
