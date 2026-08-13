// src/server/terminal/render-watch.ts
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";

interface WatchOpts {
  slug: string;
  onFound: (mp4Path: string) => void;
}

const POLL_INTERVAL_MS = 700;

function rendersRoot(): string {
  return path.join(config.VAULT_PATH, "Studio", "workspace", "renders");
}

/**
 * Polls the vault renders root for this post's finished MP4. The render directory is
 * named `<date>-<slug>`, and this only needs the slug, so it matches on the suffix and
 * ignores whatever date /ksa:cooking stamps. Fires onFound once, after the file's size
 * holds steady across two consecutive poll ticks, so a half-written file is never
 * captured.
 *
 * Polling (not fs.watch) is deliberate: fs.watch's recursive mode on macOS
 * (FSEvents-backed) can drop the very event this needs, most likely because the
 * watcher is not yet attached to the kernel subsystem at the moment the render
 * lands right after the watcher is created. A missed event means the studio
 * silently never captures a finished render, which readdir-based polling cannot do.
 */
export function watchForRender({ slug, onFound }: WatchOpts): { stop: () => void } {
  const root = rendersRoot();
  mkdirSync(root, { recursive: true });

  let done = false;
  let timer: NodeJS.Timeout | null = null;
  const lastSizeByPath = new Map<string, number>();

  const stop = (): void => {
    done = true;
    if (timer) { clearInterval(timer); timer = null; }
  };

  const tick = (): void => {
    if (done) return;
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith(`-${slug}`)) continue;
        const mp4Path = path.join(root, entry.name, "video.mp4");
        if (!existsSync(mp4Path)) continue;
        const size = statSync(mp4Path).size;
        const last = lastSizeByPath.get(mp4Path);
        if (size > 0 && last === size) {
          done = true;
          stop();
          onFound(mp4Path);
          return;
        }
        lastSizeByPath.set(mp4Path, size);
      }
    } catch {
      // A poll error must never crash the process; try again on the next tick.
    }
  };

  timer = setInterval(tick, POLL_INTERVAL_MS);

  return { stop };
}
