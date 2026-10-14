import { Camera, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Instagram only in V1 (V1-BRIEF.md, Kai's ruling 2026-07-31). This used to carry
// TikTok and YouTube Shorts branches, but sync can only ever write platform:
// "instagram", so those branches never rendered anything real. The schema column
// stays multi-valued for a later platform (v1-scope.md), this component doesn't
// need to guess ahead of it.
//
// DESIGN.md §4.1: platform identity deliberately skips a categorical color ramp —
// the chip carries its own recognizable glyph shape in a neutral monochrome
// treatment instead (current-color icon in a translucent dark pill). Camera is a
// stand-in evoking the platform's format, not a literal brand icon.
const PLATFORM_META: Record<string, { icon: LucideIcon; label: string }> = {
  instagram: { icon: Camera, label: "Instagram" },
};

export function platformLabel(platform: string): string {
  return PLATFORM_META[platform]?.label ?? platform;
}

export function PlatformChip({ platform, className }: { platform: string; className?: string }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta?.icon ?? Camera;

  // The two overrides are shape, not tone: this chip floats over a thumbnail, so it is
  // a circle sized to the glyph rather than Badge's text-width pill, and its fill is a
  // scrim over artwork rather than a theme surface.
  return (
    <Badge
      variant="default"
      className={cn("size-6 p-0 bg-black/55 text-white backdrop-blur-sm", className)}
    >
      <Icon aria-hidden />
      <span className="sr-only">{meta?.label ?? platform}</span>
    </Badge>
  );
}
