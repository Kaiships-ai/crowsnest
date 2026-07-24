/** DESIGN.md §2.7's Sync section: manual-only is the only option today (default per
 * the $0/mo local-first posture — scheduled sync is a future addition, not a toggle
 * that does anything yet), plus a preview of which provider(s) will actually run on
 * the next "Sync now" given the currently-configured keys. Static — no "use client". */
export function SyncSection({ providerChain }: { providerChain: string[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Sync</h2>
        <p className="text-sm text-muted-foreground">$0/mo local-first posture — auto-sync is opt-in, not on by default.</p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden className="flex size-4 items-center justify-center rounded-full border border-primary">
          <span className="size-2 rounded-full bg-primary" />
        </span>
        <span className="font-medium">Manual only</span>
        <span className="text-xs text-muted-foreground">(scheduled sync is a future addition)</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Current provider chain:{" "}
        {providerChain.length > 0 ? providerChain.join(" → ") : "none configured — add APIFY_TOKEN or HIKERAPI_KEY"}
      </p>
    </section>
  );
}
