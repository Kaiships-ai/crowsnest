"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bookmark, Copy, ExternalLink, Image as ImageIcon, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { OutlierCard } from "@/components/feed/outlier-card";
import { OutlierBadge } from "@/components/feed/outlier-badge";
import { PlatformChip, platformLabel } from "@/components/feed/platform-chip";
import { VideoThumb } from "@/components/feed/video-thumb";
import { CarouselViewer } from "@/components/video/carousel-viewer";
import { VideoPlayer } from "@/components/video/video-player";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompact, formatDuration, formatMultiplier, relativeTime } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { assetUrl } from "@/lib/media-url";
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

/**
 * DESIGN.md §2.4: hook type + format/style tags, then the beat-by-beat structure
 * (Hook 0–3s / Build / Payoff / CTA). No "visual layout" section here (on-screen-text
 * placement, cut rhythm, framing) — the prototype shows one, but video_analyses has no
 * columns for it (schema.ts only has hookType/structureSegments/formatTags/styleTags/
 * whyItWorked) and adding one means a src/server change outside this slice's file list.
 * Dropped rather than faked, per the shared brief's disagreement rule.
 */
function HookStructureTab({ analysis, durationSec }: { analysis: VideoAnalysis; durationSec: number | null }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <span data-lab className="font-mono text-2xs text-faint">
          Hook
        </span>
        <div className="mt-3 flex flex-wrap gap-4">
          <span className="font-mono text-xs text-foreground">{analysis.hookType}</span>
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
      </div>

      <div>
        <span data-lab className="font-mono text-2xs text-faint">
          Beats
        </span>
        {analysis.structureSegments.length > 0 ? (
          <div className="mt-6 flex flex-col gap-6">
            {analysis.structureSegments.map((segment, i) => {
              const span = segment.endSec - segment.startSec;
              // Real derived proportion (segment length / whole video), not a fabricated
              // number — falls back to an even split when duration is unknown.
              const widthPct = durationSec && durationSec > 0 ? Math.min((span / durationSec) * 100, 100) : null;
              return (
                <div key={i} className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-6">
                  <span data-num className="font-mono text-2xs text-faint">
                    {formatDuration(segment.startSec)}–{formatDuration(segment.endSec)}
                  </span>
                  <div>
                    <span className="text-sm font-semibold">{segment.label}</span>
                    <span className="text-sm text-muted-foreground"> — {segment.note}</span>
                    <div
                      className="mt-3 h-0.5 bg-line-strong"
                      style={{ width: widthPct !== null ? `${widthPct}%` : "100%" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No structure segments returned.</p>
        )}
      </div>
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
      {detail.deletedAt && (
        <Alert variant="destructive" className="mx-6 mt-6">
          <AlertTriangle />
          <AlertTitle>No longer on {platformLabel(item.channel.platform)}</AlertTitle>
          <AlertDescription>
            This post was removed from the creator&rsquo;s timeline on {relativeTime(detail.deletedAt)}. It&rsquo;s
            kept here because its transcript, analysis, and remix work still matter — the media below reflects the
            last copy we downloaded.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-1 gap-16 overflow-hidden p-6">
        {/* Left: the video and everything measured about it. */}
        <div className="flex w-[320px] shrink-0 flex-col gap-8 overflow-y-auto">
          <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden bg-card">
            {item.mediaType === "carousel" ? (
              <CarouselViewer items={detail.children} />
            ) : item.mediaType === "video" ? (
              <VideoPlayer
                videoId={item.videoId}
                videoAssetId={item.videoAssetId}
                thumbnailAssetId={item.thumbnailAssetId}
              />
            ) : (
              <>
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageIcon className="size-12 text-faint" aria-hidden />
                </div>
                <VideoThumb assetId={item.thumbnailAssetId} />
              </>
            )}
            <div className="absolute top-2 right-2 z-10">
              <OutlierBadge score={item.outlierScore} size="lg" />
            </div>
          </div>

          <div>
            <span
              data-num
              className={cn(
                "block font-mono text-xl font-medium leading-none",
                heatTier(item.outlierScore) > 0 ? "text-score" : "text-foreground"
              )}
            >
              {formatMultiplier(item.outlierScore)}
            </span>
            <span className="mt-3 block text-sm text-muted-foreground">
              vs {item.channel.handle}&rsquo;s own median views
            </span>
          </div>

          {item.caption && (
            <p className="max-w-[34ch] text-lg leading-snug font-semibold tracking-tight">{item.caption}</p>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-xs">
            <span data-num className="text-foreground">
              {formatCompact(item.viewCount)} views
            </span>
            <span data-num className="text-foreground">
              {formatDuration(item.durationSec) || "—"}
            </span>
            <span data-num className="text-muted-foreground">
              {relativeTime(item.postedAt)}
            </span>
            <span data-num className="text-muted-foreground">
              {formatCompact(item.channel.followerCount)} followers
            </span>
          </div>

          <MetricChips viewCount={item.viewCount} likeCount={detail.likeCount} commentCount={detail.commentCount} />

          <div className="flex flex-col gap-3">
            <Link href={`/channels/${item.channel.id}`} className="flex items-center gap-2 hover:underline">
              <Avatar size="sm">
                <AvatarImage src={assetUrl(item.channel.avatarAssetId) ?? undefined} alt="" />
                <AvatarFallback>
                  {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{item.channel.handle}</span>
            </Link>

            <PlatformChip platform={item.channel.platform} />

            <div className="flex items-center gap-4">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                View on {platformLabel(item.channel.platform)} <ExternalLink className="size-3.5" />
              </a>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <Copy className="size-3.5" /> Copy link
              </button>
            </div>
          </div>
        </div>

        {/* Right: the analysis — hook, story beats, why it worked. overflow-y-auto so
            the exit actions below the tabs stay reachable even when analysis content
            (long transcript aside, that has its own ScrollArea) runs tall. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Tabs defaultValue="transcript" className="flex h-full flex-col">
            <TabsList>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="hook">Hook &amp; structure</TabsTrigger>
              <TabsTrigger value="why">Why it worked</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="min-h-0 flex-1">
              {detail.transcript ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between gap-6 pt-4">
                    <span data-lab className="font-mono text-2xs text-faint">
                      Transcript · {detail.transcript.source}
                    </span>
                    <Button variant="outline" size="sm" onClick={copyTranscript}>
                      <Copy className="size-3.5" /> Copy transcript
                    </Button>
                  </div>
                  <ScrollArea className="mt-4 h-full pr-4">
                    <p className="max-w-[68ch] text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {detail.transcript.text}
                    </p>
                  </ScrollArea>
                </div>
              ) : (
                <p className="pt-4 text-sm text-muted-foreground">
                  No transcript yet — open Hook &amp; structure or Why it worked and click Transcribe &amp; Analyze
                </p>
              )}
            </TabsContent>

            <TabsContent value="hook" className="pt-4">
              {detail.analysis ? (
                <HookStructureTab analysis={detail.analysis} durationSec={item.durationSec} />
              ) : (
                <div className="flex flex-col items-start gap-6 py-16">
                  <AnalysisGate
                    videoId={item.videoId}
                    hasTranscript={hasTranscript}
                    hasKey={hasLlmKey}
                    canTranscribe={canTranscribe}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="why" className="pt-4">
              {detail.analysis ? (
                <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                  {detail.analysis.whyItWorked}
                </p>
              ) : (
                <div className="flex flex-col items-start gap-6 py-16">
                  <AnalysisGate
                    videoId={item.videoId}
                    hasTranscript={hasTranscript}
                    hasKey={hasLlmKey}
                    canTranscribe={canTranscribe}
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* End of the reading path: exactly one amber exit (Remix). Save/Copy stay
              on a raised (outline) surface per the amber-budget rule. */}
          <div className="mt-16 flex items-center gap-4 border-t border-border pt-8">
            <Link href={`/feed/${item.videoId}/remix`} className={cn(buttonVariants({ variant: "default" }))}>
              Remix this
            </Link>
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
              <Wand2 className="size-3.5" /> Copy as prompt
            </Button>
          </div>
        </div>
      </div>

      <SimilarOutliers items={similar} />
    </div>
  );
}
