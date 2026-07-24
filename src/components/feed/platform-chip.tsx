import { Camera, Film, Music2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// DESIGN.md §4.1: platform identity deliberately skips a 3-way categorical color
// ramp — each chip carries its own recognizable glyph *shape* in a neutral monochrome
// treatment instead (current-color icon in a translucent dark pill). lucide-react
// ships no branded logos, which is exactly the point: shape reads as identity, not a
// trademarked mark. Camera/Music/Film are stand-ins evoking each platform's format,
// not literal brand icons.
const PLATFORM_META: Record<string, { icon: LucideIcon; label: string }> = {
  instagram: { icon: Camera, label: "Instagram" },
  tiktok: { icon: Music2, label: "TikTok" },
  youtube_shorts: { icon: Film, label: "YouTube Shorts" },
};

export function platformLabel(platform: string): string {
  return PLATFORM_META[platform]?.label ?? platform;
}

export function PlatformChip({ platform, className }: { platform: string; className?: string }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta?.icon ?? Film;

  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm",
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{meta?.label ?? platform}</span>
    </span>
  );
}
