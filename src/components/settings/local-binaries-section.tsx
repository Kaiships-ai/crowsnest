import { AlertTriangle, CheckCircle2 } from "lucide-react";

export interface BinaryStatus {
  label: string;
  available: boolean;
  reason?: string;
}

/** DESIGN.md §2.7-adjacent (Task 2, phase 4): green/amber rows for the optional local
 * binaries that unlock keyless local transcription and manual reel import. No
 * interactivity needed (a page-load check), so this stays a plain server-renderable
 * component — no "use client". */
export function LocalBinariesSection({ binaries }: { binaries: BinaryStatus[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Local binaries</h2>
        <p className="text-sm text-muted-foreground">
          Optional — enables keyless local transcription and manual reel import.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {binaries.map((bin) => (
          <div key={bin.label} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
            {bin.available ? (
              <CheckCircle2 className="size-4 shrink-0 text-[var(--pos)]" aria-hidden />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="font-medium">{bin.label}</span>
            {!bin.available && bin.reason && <span className="text-xs text-muted-foreground">— {bin.reason}</span>}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Install with: <code className="rounded bg-muted px-1 py-0.5">brew install yt-dlp whisper-cpp</code>
      </p>
    </section>
  );
}
