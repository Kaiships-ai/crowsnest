"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bookmark, ChevronLeft, ChevronRight, Copy, ExternalLink, Image as ImageIcon, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { OutlierCard } from "@/components/feed/outlier-card";
import { OutlierBadge } from "@/components/feed/outlier-badge";
import { platformLabel } from "@/components/feed/platform-chip";
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
import { formatCompact, formatDuration, relativeTime } from "@/lib/format";
import { assetUrl } from "@/lib/media-url";
import { cn } from "@/lib/utils";
import { SaveToVaultDialog } from "@/components/vault/save-to-vault-dialog";
import { SavePostButton } from "./save-post-button";
import { analyzeVideoAction } from "@/server/actions/analyze-actions";
import { buildVideoPromptAction } from "@/server/actions/export-actions";
import type { FeedItem } from "@/server/queries/feed";
import type { MedianBasis } from "@/server/queries/channels";
// Aliased: this component is also named VideoDetail (Task 7's file/export name), so
// the query-layer type needs a different local name to avoid shadowing.
import type { VideoDetail as VideoDetailData } from "@/server/queries/video";
import type { StoredVideoAnalysis } from "@/server/services/analyze";
import { MetricChips } from "./metric-chips";
import { MedianBaseline } from "./median-baseline";
import { LayoutSection } from "./layout-section";

/** Adjacency within whatever ordering the caller resolved "the current feed" to be —
 *  see the doc comments on FEED_ORDER_LIMIT and resolveFeedNav in
 *  feed/[videoId]/resolve-feed-nav.ts for how that's computed and its honest
 *  limitations. Null means there's nowhere to go (or nowhere to know to go). */
export interface FeedNav {
  backHref: string;
  prevHref: string | null;
  nextHref: string | null;
  /** "N of Total", or null when this post's position inside the resolved order
   *  couldn't be established (falls outside a truncated slice, or an empty feed). */
  indexLabel: string | null;
}

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
          Install a local transcriber (<code>brew install yt-dlp whisper-cpp</code>, then download a GGML model,
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
 * (Hook 0–3s / Build / Payoff / CTA). The Layout section used to hang off the end of
 * this tab, which meant a frame pass was only reachable on a video that already had a
 * text analysis; it has its own always-present tab now (see LayoutSection).
 *
 * `formatTags` come from the text analysis pass reading the transcript, the same
 * source as `hookType` — a real reading, shown plain. `styleTags` describe visual
 * style (pacing, shot type) that a text-only model can only guess at without ever
 * having seen a frame, so every one renders muted with a "· unverified" marker until
 * a real frame pass exists to confirm or replace them (prototype's own distinction,
 * proto/tail-overlays.html's tagRow: verified tags plain, guessed ones flagged).
 */
function HookStructureTab({
  analysis,
  durationSec,
}: {
  analysis: StoredVideoAnalysis;
  durationSec: number | null;
}) {
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
            <span key={`style-${tag}`} className="font-mono text-2xs text-muted-foreground">
              {tag} <span className="text-faint">· unverified</span>
            </span>
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
                    <span className="text-sm text-muted-foreground">, {segment.note}</span>
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
  medianBasis,
  feedNav,
  savedPost,
}: {
  detail: VideoDetailData;
  hasLlmKey: boolean;
  /** Whether at least one transcript provider (whisper.cpp locally, or Groq via
   * GROQ_API_KEY) is actually usable right now — threaded down to AnalysisGate so it
   * can offer a live "Transcribe & Analyze" button instead of a dead end. */
  canTranscribe: boolean;
  similar: FeedItem[];
  /** The sample the hero score was computed from — `getChannelMedianBasis`, keyed to
   *  this video so its own bar can be picked out of the histogram. Null only if the
   *  channel row vanished between the feed query and this render. */
  medianBasis: MedianBasis | null;
  feedNav: FeedNav;
  /** The `saved_posts` row for this video, or null when it has not been kept. Read on
   *  the server so the button shows its real state on first paint rather than flipping
   *  after a fetch. */
  savedPost: { id: string; note: string | null } | null;
}) {
  const { item } = detail;
  const hasTranscript = detail.transcript !== null;
  const router = useRouter();

  // Reading twelve posts in a row is the daily loop (V1 scope §2, Video detail
  // criterion 11) — arrow keys move without a trip back to the feed grid. Skipped
  // while a text input has focus so the command palette's search box, or any future
  // one, doesn't lose keystrokes to page navigation.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft" && feedNav.prevHref) router.push(feedNav.prevHref);
      if (e.key === "ArrowRight" && feedNav.nextHref) router.push(feedNav.nextHref);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, feedNav.prevHref, feedNav.nextHref]);

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
      toast.error("Couldn't copy to clipboard. Check browser permissions.");
    }
  }

  async function copyTranscript() {
    if (!detail.transcript) return;
    try {
      await navigator.clipboard.writeText(detail.transcript.text);
      toast.success("Transcript copied");
    } catch {
      toast.error("Couldn't copy to clipboard. Check browser permissions.");
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
      toast.success("Prompt copied, paste into any LLM");
    } catch {
      toast.error("Couldn't copy to clipboard. Check browser permissions.");
    }
  }

  return (
    // min-h-full, not h-full: the shell's <main> is the scroll container (a fixed height,
    // overflow-y-auto). Pinning this page to exactly that height forced the analysis and
    // the left card into their own tiny inner scrollers while Similar outliers ate the
    // rest. Letting the page grow past main means main scrolls the whole thing as one.
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-6 font-mono text-2xs tracking-wide text-faint">
        <Link href={feedNav.backHref} className="text-muted-foreground hover:text-foreground">
          ← Feed
        </Link>
        <div className="flex items-center gap-5">
          {feedNav.indexLabel && <span data-num>{feedNav.indexLabel}</span>}
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1 p-0 text-2xs text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-40"
            disabled={!feedNav.prevHref}
            onClick={() => feedNav.prevHref && router.push(feedNav.prevHref)}
          >
            <ChevronLeft className="size-3.5" /> prev
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1 p-0 text-2xs text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-40"
            disabled={!feedNav.nextHref}
            onClick={() => feedNav.nextHref && router.push(feedNav.nextHref)}
          >
            next <ChevronRight className="size-3.5" />
          </Button>
          <span>←/→ keys work too</span>
        </div>
      </div>

      {detail.deletedAt && (
        <Alert variant="destructive" className="mx-6 mt-6">
          <AlertTriangle />
          <AlertTitle>No longer on {platformLabel(item.channel.platform)}</AlertTitle>
          <AlertDescription>
            This post was removed from the creator&rsquo;s timeline on {relativeTime(detail.deletedAt)}. It&rsquo;s
            kept here because its transcript, analysis, and remix work still matter. The media below reflects the
            last copy we downloaded.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-start gap-16 p-6">
        {/* Left: the video and everything measured about it. */}
        <div className="flex w-[320px] shrink-0 flex-col gap-8">
          {/* Capped at 42vh (rather than letting aspect-[9/16] run the full column
              width out to its natural ~1.78x height) so the six stats below are
              never pushed under the fold in a ~900px window. Media components render
              with object-contain/object-cover inside this box (see VideoPlayer,
              CarouselViewer, VideoThumb), so a shorter box still reads as vertical
              media, just letterboxed or lightly cropped instead of full-bleed. */}
          <div className="relative aspect-[9/16] max-h-[42vh] w-full shrink-0 overflow-hidden bg-card">
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

          {/* The six required-visible numbers (views, duration, posted, followers,
              likes, comments) sit right under the media, ahead of the baseline,
              caption, and channel/link block below — those can scroll, these can't. */}
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

          <MedianBaseline score={item.outlierScore} handle={item.channel.handle} basis={medianBasis} />

          {item.caption && (
            <p className="max-w-[34ch] text-lg leading-snug font-semibold tracking-tight">{item.caption}</p>
          )}

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

        {/* Right: the analysis, hook, story beats, why it worked. No inner scroll: the
            whole page scrolls in the shell's main, so the beats and the exit actions below
            the tabs flow at full height (the transcript has its own bounded ScrollArea). */}
        <div className="flex min-w-0 flex-1 flex-col">
          {detail.analysis?.summary ? (
            <section className="mb-4 border border-border bg-card p-4">
              <h3 className="mb-1.5 font-mono text-[13px] uppercase tracking-[0.06em] text-faint">Summary</h3>
              <p className="text-[17px] text-foreground">{detail.analysis.summary}</p>
            </section>
          ) : null}
          <Tabs defaultValue="transcript" className="flex flex-col">
            <TabsList>
              <TabsTrigger value="transcript">
                Transcript
                {detail.transcript ? (
                  <span className="ml-1.5 font-mono text-[12px] text-faint tabular-nums">
                    {detail.transcript.text.trim().split(/\s+/).filter(Boolean).length} words
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="hook">Hook &amp; structure</TabsTrigger>
              <TabsTrigger value="why">Why it worked</TabsTrigger>
              <TabsTrigger value="layout">Layout</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript">
              {detail.transcript ? (
                <div className="flex flex-col">
                  <div className="flex items-center justify-between gap-6 pt-4">
                    <span data-lab className="font-mono text-2xs text-faint">
                      Transcript · {detail.transcript.source}
                    </span>
                    <Button variant="outline" size="sm" onClick={copyTranscript}>
                      <Copy className="size-3.5" /> Copy transcript
                    </Button>
                  </div>
                  {/* Tabs no longer carries h-full (that was the source of the
                      action-bar-over-beats overlap on the Hook tab), so this can't
                      lean on an inherited 100%-height chain anymore. ScrollArea needs
                      a definite height (not just a max-height) for its Viewport's
                      size-full to resolve — without one it collapses to auto and the
                      whole right column scrolls through the full transcript text
                      instead of the transcript scrolling in its own box. */}
                  <ScrollArea className="mt-4 h-[60vh] pr-4">
                    <p className="max-w-[68ch] text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {detail.transcript.text}
                    </p>
                  </ScrollArea>
                </div>
              ) : (
                <p className="pt-4 text-sm text-muted-foreground">
                  No transcript yet. Open Hook &amp; structure or Why it worked and click Transcribe &amp; Analyze
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

            {/* Always rendered, analysis or not: a frame pass reads the video file, it
                does not need a transcript analysis to have run first. LayoutSection
                takes a null analysis as its "no frame pass has run yet" state. */}
            <TabsContent value="layout" className="pt-4">
              <LayoutSection videoId={item.videoId} analysis={detail.analysis} />
            </TabsContent>
          </Tabs>

          {/* End of the reading path: exactly one amber exit (Remix). Save/Copy stay
              on a raised (outline) surface per the amber-budget rule.
              Keep-this-post and Save-to-Vault fill the single "Save" slot the
              prototype has here, so the pair sits inside its own bracket (divider,
              tighter gap, a destination caption under each) rather than reading as
              a fourth peer action next to Remix and Copy — the icon swap in
              SavePostButton (star, not bookmark) does the rest of the work of
              telling them apart before anyone reads a label. */}
          {/* Pinned to the bottom of the shell's main (the scroll container, see the note
              above), so the exit actions stay reachable instead of scrolling off the end
              of a long transcript. Translucent so the beats stay readable underneath. */}
          <div className="sticky bottom-0 z-10 mt-16 flex items-start gap-4 border-t border-border bg-background/95 pt-8 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Link href={`/feed/${item.videoId}/remix`} className={cn(buttonVariants({ variant: "default" }))}>
              Remix this
            </Link>

            <div className="flex items-start gap-3 border-l border-border pl-4">
              <div className="flex flex-col items-start gap-1.5">
                <SavePostButton videoId={item.videoId} saved={savedPost} />
                <span className="font-mono text-2xs text-faint">Vault → Saved posts</span>
              </div>

              <div className="flex flex-col items-start gap-1.5">
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
                <span className="font-mono text-2xs text-faint">Vault → Hooks &amp; styles</span>
              </div>
            </div>

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
