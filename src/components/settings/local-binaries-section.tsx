import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";

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
    <Card>
      <CardHeader>
        <CardTitle>Local binaries</CardTitle>
        <CardDescription>
          Optional command-line tools (yt-dlp for downloads, whisper-cpp for transcription) that unlock keyless transcription and manual reel import. Install them only if you want those features to work.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ItemGroup>
          {binaries.map((bin) => (
            <Item key={bin.label} variant="outline" size="sm">
              <ItemMedia variant="icon">
                {bin.available ? (
                  <CheckCircle2 className="text-[var(--success)]" aria-hidden />
                ) : (
                  <AlertTriangle className="text-muted-foreground" aria-hidden />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{bin.label}</ItemTitle>
              </ItemContent>
              {!bin.available && bin.reason && (
                <ItemActions>
                  <Badge variant="secondary">{bin.reason}</Badge>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
      </CardContent>

      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Install with: <code className="rounded bg-muted px-1 py-0.5">brew install yt-dlp whisper-cpp</code>
        </p>
      </CardFooter>
    </Card>
  );
}
