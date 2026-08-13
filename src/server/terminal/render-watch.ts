// src/server/terminal/render-watch.ts
import { mkdirSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";

interface WatchOpts {
  slug: string;
  onFound: (mp4Path: string) => void;
}

function rendersRoot(): string {
  return path.join(config.VAULT_PATH, "Studio", "workspace", "renders");
}

/**
 * Watches the vault renders root for this post's finished MP4. The render directory is
 * named `<date>-<slug>`, and this only needs the slug, so it matches on the suffix and
 * ignores whatever date /ksa:cooking stamps. Fires onFound once, after the file's size
 * holds steady across two reads, so a half-written file is never captured.
 */
export function watchForRender({ slug, onFound }: WatchOpts): { stop: () => void } {
  const root = rendersRoot();
  mkdirSync(root, { recursive: true });

  let done = false;
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;

  const matchesSlug = (rel: string): boolean => {
    // rel is like "2026-08-13-my-post/video.mp4" on macOS recursive watch.
    const parts = rel.split(path.sep);
    if (parts.length < 2) return false;
    const dir = parts[parts.length - 2];
    const file = parts[parts.length - 1];
    return file === "video.mp4" && dir.endsWith(`-${slug}`);
  };

  const confirmStableThenFire = (mp4Path: string): void => {
    let last = -1;
    const check = (): void => {
      if (done) return;
      let size: number;
      try {
        size = statSync(mp4Path).size;
      } catch {
        return; // file vanished mid-write, let the next event re-trigger
      }
      if (size > 0 && size === last) {
        done = true;
        stop();
        onFound(mp4Path);
        return;
      }
      last = size;
      timer = setTimeout(check, 400);
    };
    check();
  };

  const stop = (): void => {
    if (watcher) { watcher.close(); watcher = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  };

  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      try {
        if (done || filename === null) return;
        const rel = filename.toString();
        if (matchesSlug(rel)) confirmStableThenFire(path.join(root, rel));
      } catch {
        // A watch event must never crash the single-process server; drop it.
      }
    });
  } catch {
    // If the platform cannot watch (or the root disappeared), the watcher stays null and
    // the studio simply never auto-captures; the operator can still work in the terminal.
  }

  return { stop };
}
