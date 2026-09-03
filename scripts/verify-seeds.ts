import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { igClient } from "@/server/ig/client";
import { IgError } from "@/server/ig/errors";
import { getSyncProgressAction } from "@/server/actions/sync-actions";

const NICHES = ["fitness", "finance", "tech", "business"];
const DIR = join(process.cwd(), "data/seeds");
const SPACING_MS = 3200; // orchestrator: >= 3s to protect the throwaway account
// Codes that mean "the account is being challenged / logged out" — stop, do not continue.
// (errors.ts has no IG_CHALLENGE_REQUIRED / IG_LOGIN_REQUIRED; the real codes are
// IG_CHALLENGE and IG_AUTH_REQUIRED.)
const STOP_CODES = new Set(["IG_CHALLENGE", "IG_AUTH_REQUIRED"]);

async function run() {
  const progress = await getSyncProgressAction();
  if (progress.ok && progress.progress?.status === "running") {
    console.error("A sync is running — refusing to verify seeds against a busy sidecar. Check /runs.");
    process.exit(1);
  }
  for (const niche of NICHES) {
    const path = join(DIR, `${niche}.json`);
    const file = JSON.parse(readFileSync(path, "utf8"));
    const kept: Record<string, unknown>[] = [];
    let dropped = 0;
    for (const c of file.creators as Record<string, unknown>[]) {
      if (c.verified === true) { kept.push(c); continue; } // resumable: skip already-verified
      try {
        await igClient.profile(String(c.handle));
        kept.push({ ...c, verified: true });
      } catch (err) {
        if (err instanceof IgError && STOP_CODES.has(err.code)) {
          file.creators = [...kept, ...file.creators.slice(file.creators.indexOf(c))];
          writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
          console.error(`CHALLENGE at ${niche}/${String(c.handle)} (${err.code}) — stopping. Re-run later to resume.`);
          process.exit(2);
        }
        dropped += 1;
        console.warn(`DROP ${niche}/${String(c.handle)}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    file.creators = kept;
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    console.log(`${niche}: verified ${kept.length}, dropped ${dropped}`);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
