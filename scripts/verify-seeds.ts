import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { igClient } from "@/server/ig/client";
import { IgError } from "@/server/ig/errors";
import { getSyncProgressAction } from "@/server/actions/sync-actions";

const NICHES = ["fitness", "finance", "tech", "business"];
const DIR = join(process.cwd(), "data/seeds");
const SPACING_MS = 3200; // orchestrator: >= 3s to protect the throwaway account
// A handle is DROPPED only when the sidecar affirmatively says the profile does not
// exist (IG_NOT_FOUND). IG_PRIVATE means the account is real but private — a private
// competitor is still worth tracking, so KEEP it. EVERY OTHER error (auth 401, challenge,
// service down, rate limited, network, 2fa, unknown) is a SYSTEMIC failure, not a verdict
// about this handle — STOP the run rather than silently dropping good handles. (A prior
// version dropped on any error, which emptied all four seed files on a single stale-token
// 401. Never treat a systemic failure as a per-handle drop.)
const NOT_FOUND = "IG_NOT_FOUND";
const PRIVATE_BUT_REAL = "IG_PRIVATE";

async function run() {
  const progress = await getSyncProgressAction();
  if (progress.ok && progress.progress?.status === "running") {
    console.error("A sync is running — refusing to verify seeds against a busy sidecar. Check /runs.");
    process.exit(1);
  }
  // A single network error after retry is dropped (an odd handle, or a one-off blip), but
  // a RUN of consecutive network errors is an outage, not a batch of bad handles — stop
  // before it silently drops a whole niche. Any success/not-found/private resets the run.
  const MAX_CONSECUTIVE_NETWORK = 3;
  let consecutiveNetwork = 0;
  for (const niche of NICHES) {
    const path = join(DIR, `${niche}.json`);
    const file = JSON.parse(readFileSync(path, "utf8"));
    const kept: Record<string, unknown>[] = [];
    let dropped = 0;
    for (const c of file.creators as Record<string, unknown>[]) {
      if (c.verified === true) { kept.push(c); continue; } // resumable: skip already-verified
      try {
        try {
          await igClient.profile(String(c.handle));
        } catch (first) {
          // A single network error is often transient OR pinned to one odd handle. Retry
          // once after a pause; if it still fails as network, fall through to drop-and-
          // continue rather than halting the whole run on one handle.
          if (first instanceof IgError && first.code === "IG_NETWORK") {
            await new Promise((r) => setTimeout(r, 4000));
            await igClient.profile(String(c.handle));
          } else {
            throw first;
          }
        }
        kept.push({ ...c, verified: true });
        consecutiveNetwork = 0;
      } catch (err) {
        const code = err instanceof IgError ? err.code : null;
        if (code === NOT_FOUND) {
          dropped += 1;
          consecutiveNetwork = 0; // a clean "does not exist" verdict — connectivity is fine
          console.warn(`DROP ${niche}/${String(c.handle)}: profile not found`);
        } else if (code === PRIVATE_BUT_REAL) {
          kept.push({ ...c, verified: true }); // exists but private — a real account, keep it
          consecutiveNetwork = 0;
          console.log(`KEEP (private) ${niche}/${String(c.handle)}`);
        } else if (code === "IG_NETWORK") {
          consecutiveNetwork += 1;
          if (consecutiveNetwork >= MAX_CONSECUTIVE_NETWORK) {
            // A run of network errors is an outage, not bad handles — stop and preserve the
            // rest (including this one) for a resumed run rather than dropping a whole niche.
            file.creators = [...kept, ...file.creators.slice(file.creators.indexOf(c))];
            writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
            console.error(`STOP at ${niche}/${String(c.handle)}: ${consecutiveNetwork} consecutive IG_NETWORK errors — likely an outage, not bad handles. Fix connectivity and re-run to resume.`);
            process.exit(2);
          }
          dropped += 1;
          console.warn(`DROP ${niche}/${String(c.handle)}: network error after retry (${consecutiveNetwork}/${MAX_CONSECUTIVE_NETWORK} consecutive)`);
        } else {
          // Systemic failure (auth/challenge/service/unknown) — NOT a per-handle
          // verdict. Persist progress and stop so a stale token or challenge can never
          // silently drop good handles.
          file.creators = [...kept, ...file.creators.slice(file.creators.indexOf(c))];
          writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
          console.error(`STOP at ${niche}/${String(c.handle)} (${code ?? (err instanceof Error ? err.message : String(err))}) — systemic error, not a bad handle. Fix and re-run to resume.`);
          process.exit(2);
        }
      }
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    file.creators = kept;
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    console.log(`${niche}: verified ${kept.length}, dropped ${dropped}`);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
