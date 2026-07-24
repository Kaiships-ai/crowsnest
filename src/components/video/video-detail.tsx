"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, Copy, ExternalLink, MoreHorizontal, Play, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { OutlierCard } from "@/components/feed/outlier-card";
import { OutlierBadge } from "@/components/feed/outlier-badge";
import { PlatformChip, platformLabel } from "@/components/feed/platform-chip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SaveToVaultDialog } from "@/components/vault/save-to-vault-dialog";
import { analyzeVideoAction } from "@/server/actions/analyze-actions";
import { buildVideoPromptAction } from "@/server/actions/export-actions";
import type { FeedItem } from "@/server/queries/feed";
// Aliased: this component is also named VideoDetail (Task 7's file/export name), so
// the query-layer type needs a different local name to avoid shadowing.
import type { VideoDetail as VideoDetailData } from "@/server/queries/video";
import type { VideoAnalysis } from "@/server/llm/schemas";
import { MetricChips } from "./metric-chips";

/**
 * Shared "no analysis yet" gate rendered inside both the Hook & Structure and
 * Why-it-worked tabs (Task 2) — one Claude call produces both, so whichever tab the
 * user lands on first can trigger it. Checked in order:
 *  1. No transcript yet and no way to make one (`canTranscribe` false — neither
 *     whisper.cpp nor Groq usable): an Alert with the brew/Settings hint, since
 *     there's nothing a button click could do (final-review finding B1).
 *  2. No transcript yet but transcription is possible: an active "Transcribe &
 *     Analyze" button — `analyzeVideoAction` now transcribes on demand before
 *     analyzing, and the transcribe half works fully keyless (whisper.cpp is local),
 *     so this button is live even with no ANTHROPIC_API_KEY set; if analysis itself
 *     then needs the key, that specific error surfaces from the same click.
 *  3. Has a transcript, no Claude key: the original key-missing Alert (DESIGN.md §6
 *     keyless-mode contract).
 *  4. Otherwise: the original "Analyze this video" button.
 */
function AnalysisGate({
  videoId,
  hasTranscript,
  hasKey,
  canTranscribe,
}: {
  videoId: string;
  hasTranscript: boolean;
  hasKey: boolean;
  canTranscribe: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function runAnalysis() {
    setPending(true);
    const result = await analyzeVideoAction(videoId);
    setPending(false);
    if (result.ok) {
      toast.success("Analysis complete");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (!hasTranscript && !canTranscribe) {
    return (
      <Alert>
        <AlertTitle>No transcript available yet</AlertTitle>
        <AlertDescription>
          Install a local transcriber (<code>brew install yt-dlp whisper-cpp</code>, then download a GGML model —
          see Settings for the exact missing path) or add GROQ_API_KEY in Settings, then try again.
        </AlertDescription>
      </Alert>
    );
  }

  if (!hasTranscript) {
    return (
      <Button onClick={runAnalysis} disabled={pending}>
        {pending ? "Transcribing…" : "Transcribe & Analyze"}
      </Button>
    );
  }

  if (!hasKey) {
    return (
      <Alert>
        <AlertTitle>Add your Claude API key</AlertTitle>
        <AlertDescription>Add ANTHROPIC_API_KEY in Settings to enable analysis.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Button onClick={runAnalysis} disabled={pending}>
      {pending ? "Analyzing…" : "Analyze this video"}
    </Button>
  );
}

/** DESIGN.md §2.4: annotated segments (Hook 0–3s / Build / Payoff / CTA) + format/style tag Badges. */
function HookStructureTab({ analysis }: { analysis: VideoAnalysis }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{analysis.hookType}</Badge>
        {analysis.formatTags.map((tag) => (
          <Badge key={`format-${tag}`} variant="secondary">
            {tag}
          </Badge>
        ))}
        {analysis.styleTags.map((tag) => (
          <Badge key={`style-${tag}`} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
      {analysis.structureSegments.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {analysis.structureSegments.map((segment, i) => (
            <li key={i} className="flex gap-3 border-l-2 border-border pl-3">
              <span className="w-16 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                {formatDuration(segment.startSec)}–{formatDuration(segment.endSec)}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{segment.label}</span>
                <span className="text-sm text-muted-foreground">{segment.note}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No structure segments returned.</p>
      )}
    </div>
  );
}

/**
 * Task 3's "Similar outliers" section — a compact OutlierCard row scored by tag
 * overlap (services/similar.ts), rendered as its own full-width section below the
 * tabs rather than the DESIGN.md v0.1 overflow-menu jump (superseded per the plan).
 */
function SimilarOutliers({ items }: { items: FeedItem[] }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
      <h2 className="text-base font-semibold">Similar outliers</h2>
      {items.length > 0 ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {items.map((item) => (
            <div key={item.videoId} className="w-40 shrink-0">
              <OutlierCard item={item} variant="compact" onOpen={(id) => router.push(`/feed/${id}`)} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Analyze more videos to see patterns</p>
      )}
    </div>
  );
}

export function VideoDetail({
  detail,
  hasLlmKey,
  canTranscribe,
  similar,
}: {
  detail: VideoDetailData;
  hasLlmKey: boolean;
  /** Whether at least one transcript provider (whisper.cpp locally, or Groq via
   * GROQ_API_KEY) is actually usable right now — threaded down to AnalysisGate so it
   * can offer a live "Transcribe & Analyze" button instead of a dead end. */
  canTranscribe: boolean;
  similar: FeedItem[];
}) {
  const { item } = detail;
  const hasTranscript = detail.transcript !== null;

  // Clipboard writes can reject (denied permission, insecure context, etc.) — caught
  // explicitly in both functions below so a failure surfaces as a toast instead of a
  // silent unhandled rejection with no user feedback (backlog item, matching the
  // pattern Task 7's createPrompt/copyVariant handlers already use in this file and
  // stage-script.tsx/script-card.tsx).
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy to clipboard — check browser permissions.");
    }
  }

  async function copyTranscript() {
    if (!detail.transcript) return;
    try {
      await navigator.clipboard.writeText(detail.transcript.text);
      toast.success("Transcript copied");
    } catch {
      toast.error("Couldn't copy to clipboard — check browser permissions.");
    }
  }

  /** DESIGN.md §2.4 / spec §8: structured Copy-as-Prompt export (Task 7). Works
   * regardless of analysis state — export.ts degrades gracefully section by section.
   * Clipboard writes can reject (denied permission, insecure context, etc.) — caught
   * explicitly so a failure surfaces as a toast instead of a silent unhandled
   * rejection with no user feedback. */
  async function createPrompt() {
    const result = await buildVideoPromptAction(item.videoId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.prompt);
      toast.success("Prompt copied — paste into any LLM");
    } catch {
      toast.error("Couldn't copy to clipboard — check browser permissions.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 gap-6 overflow-hidden p-6">
        <div className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto">
          <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden rounded-lg bg-[#1E2230]">
            <div className="absolute inset-0 flex items-center justify-center">
              <Play className="size-12 text-white/25" fill="currentColor" aria-hidden />
            </div>
            <div className="absolute top-2 right-2">
              <OutlierBadge score={item.outlierScore} size="lg" />
            </div>
          </div>

          <MetricChips viewCount={item.viewCount} likeCount={detail.likeCount} commentCount={detail.commentCount} />

          <Link href={`/channels/${item.channel.id}`} className="flex items-center gap-2 hover:underline">
            <Avatar size="sm">
              <AvatarImage src={item.channel.avatarUrl ?? undefined} alt="" />
              <AvatarFallback>
                {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{item.channel.handle}</span>
          </Link>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <PlatformChip platform={item.channel.platform} />
            <span>{relativeTime(item.postedAt)}</span>
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            View on {platformLabel(item.channel.platform)} <ExternalLink className="size-3.5" />
          </a>

          <div className="mt-auto flex items-center gap-2 pt-2">
            {detail.analysis ? (
              <SaveToVaultDialog videoId={item.videoId} analysis={detail.analysis} />
            ) : (
              <Tooltip>
                <TooltipTrigger render={<Button variant="outline" size="sm" disabled focusableWhenDisabled />}>
                  <Bookmark className="size-3.5" /> Save to Vault
                </TooltipTrigger>
                <TooltipContent>Analyze this video first to save hook/style templates</TooltipContent>
              </Tooltip>
            )}
            <Button variant="outline" size="sm" onClick={createPrompt}>
              <Wand2 className="size-3.5" /> Create Prompt
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={copyLink}>
                  <Copy /> Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyTranscript} disabled={!detail.transcript}>
                  <Copy /> Copy transcript
                </DropdownMenuItem>
                <DropdownMenuItem onClick={createPrompt}>
                  <Wand2 /> Copy as prompt
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <Tabs defaultValue="transcript" className="flex h-full flex-col">
            <TabsList>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="hook">Hook &amp; Structure</TabsTrigger>
              <TabsTrigger value="why">Why it worked</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="min-h-0 flex-1">
              <ScrollArea className="h-full pr-4">
                {detail.transcript ? (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.transcript.text}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No transcript yet — open Hook &amp; Structure or Why it worked and click Transcribe &amp; Analyze
                  </p>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="hook" className="pt-4">
              {detail.analysis ? (
                <HookStructureTab analysis={detail.analysis} />
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-start gap-3">
                    <AnalysisGate
                      videoId={item.videoId}
                      hasTranscript={hasTranscript}
                      hasKey={hasLlmKey}
                      canTranscribe={canTranscribe}
                    />
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="why" className="pt-4">
              {detail.analysis ? (
                <Card>
                  <CardContent className="text-sm text-muted-foreground">{detail.analysis.whyItWorked}</CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-start gap-3">
                    <AnalysisGate
                      videoId={item.videoId}
                      hasTranscript={hasTranscript}
                      hasKey={hasLlmKey}
                      canTranscribe={canTranscribe}
                    />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <SimilarOutliers items={similar} />

      <div className="sticky bottom-0 flex justify-end border-t border-border bg-background/95 p-4 backdrop-blur">
        <Link href={`/feed/${item.videoId}/remix`} className={cn(buttonVariants({ variant: "default" }))}>
          Remix this video →
        </Link>
      </div>
    </div>
  );
}
