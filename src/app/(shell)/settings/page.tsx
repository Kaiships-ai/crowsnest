import { ApiKeyStatusCard } from "@/components/settings/api-key-status-card";
import { LocalBinariesSection, type BinaryStatus } from "@/components/settings/local-binaries-section";
import { NicheProfileSection } from "@/components/settings/niche-profile-section";
import { SyncSection } from "@/components/settings/sync-section";
import { detectBinary } from "@/server/lib/exec";
import { getProviderChain } from "@/server/providers/registry";
// Side-effect import (see sync-engine.ts's own comment, and settings-actions.ts's
// reuse of the same pattern): apify.ts/hikerapi.ts self-register into registry.ts's
// module-level Map when *this* module loads, which is what makes getProviderChain()
// below resolve non-empty when a real key is set, instead of always coming back [].
import "@/server/services/sync-engine";
import { getNicheSettings, testAnthropicKeyAction } from "@/server/actions/settings-actions";
import { whisperAvailability } from "@/server/transcribe/whispercpp";

// Reads live process.env / filesystem / DB state on every load — no dynamic segment
// or searchParams to implicitly opt this route out of static rendering otherwise
// (same reasoning as (shell)/page.tsx's Dashboard).
export const dynamic = "force-dynamic";

// Topbar already renders this route's h1 ("Settings") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts directly at the first section.
export default async function SettingsPage() {
  const [nicheSettings, ytdlpPath, whisper] = await Promise.all([
    getNicheSettings(),
    detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp"),
    whisperAvailability(),
  ]);

  const binaries: BinaryStatus[] = [
    { label: "yt-dlp", available: ytdlpPath !== null, reason: ytdlpPath === null ? "not found on PATH" : undefined },
    { label: "whisper-cli (+ model)", available: whisper.available, reason: whisper.reason },
  ];

  const providerChain = getProviderChain().map((p) => p.name);

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-8 p-6">
      <NicheProfileSection initialNiche={nicheSettings.niche} initialKeywords={nicheSettings.keywords} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">API keys</h2>
          <p className="text-sm text-muted-foreground">Keys live in .env.local — restart the dev server after editing.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ApiKeyStatusCard
            label="Anthropic"
            envVar="ANTHROPIC_API_KEY"
            present={Boolean(process.env.ANTHROPIC_API_KEY)}
            onTest={testAnthropicKeyAction}
          />
          <ApiKeyStatusCard
            label="Apify"
            envVar="APIFY_TOKEN"
            present={Boolean(process.env.APIFY_TOKEN)}
            presenceOnlyHint="Verified on first sync"
          />
          <ApiKeyStatusCard
            label="Groq"
            envVar="GROQ_API_KEY"
            present={Boolean(process.env.GROQ_API_KEY)}
            presenceOnlyHint="Verified on first transcribe"
          />
          <ApiKeyStatusCard
            label="HikerAPI"
            envVar="HIKERAPI_KEY"
            present={Boolean(process.env.HIKERAPI_KEY)}
            presenceOnlyHint="Verified on first sync"
          />
        </div>
      </section>

      <LocalBinariesSection binaries={binaries} />

      <SyncSection providerChain={providerChain} />
    </div>
  );
}
