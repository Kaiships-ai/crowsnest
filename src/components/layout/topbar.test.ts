import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { getPageTitle } from "./topbar";

/*
 * /runs, /runs/[runId] and /logs all shipped without a ROUTE_TITLES entry, so their
 * topbar read "Crowsnest" instead of naming the page. Nothing caught it, because a
 * missing entry is not a type error or a crash — it is a silent fallback.
 *
 * So this walks the real (shell) route tree on disk rather than restating a list of
 * routes here. A list would need updating by the same person who just forgot to update
 * ROUTE_TITLES; the filesystem cannot be forgotten.
 */
const SHELL_DIR = path.join(process.cwd(), "src/app/(shell)");

/** Every route under (shell), as the pathname the browser would show. */
function shellRoutes(): string[] {
  const routes: string[] = [];

  function walk(dir: string, segments: string[]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // A parenthesised directory is a route group: it organises files without
        // appearing in the URL, so it contributes no segment.
        const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(path.join(dir, entry.name), isRouteGroup ? segments : [...segments, entry.name]);
      } else if (entry.name === "page.tsx") {
        // A dynamic segment is matched by pattern, so any concrete value exercises it.
        routes.push("/" + segments.map((s) => (s.startsWith("[") ? "sample-id" : s)).join("/"));
      }
    }
  }

  walk(SHELL_DIR, []);
  // The root page yields "/" + "" — normalise it to the pathname usePathname reports.
  return routes.map((r) => (r === "/" ? "/" : r.replace(/\/$/, "")));
}

describe("ROUTE_TITLES covers every route", () => {
  test("the walk finds the routes it is supposed to police", () => {
    const routes = shellRoutes();

    // Without this the whole file passes vacuously the day the walk breaks or the app
    // directory moves: zero routes trivially satisfy "every route has a title".
    expect(routes.length).toBeGreaterThanOrEqual(10);
    expect(routes).toContain("/");
    expect(routes).toContain("/runs");
    expect(routes).toContain("/logs");
    expect(routes).toContain("/channels/sample-id");
  });

  test("an unknown route really does fall back, so the assertion below can fail", () => {
    // The control. "Crowsnest" is the fallback this file exists to catch, so prove the
    // fallback is still reachable rather than trusting that it is.
    expect(getPageTitle("/not-a-route")).toBe("Crowsnest");
  });

  test("/channels/discover gets its own title, not the [channelId] detail fallback", () => {
    // /channels/discover previously matched the generic /channels/[^/]+ pattern and
    // read "Channel detail" instead of naming the discover page. The more specific
    // pattern must be listed before the generic one for this to hold.
    expect(getPageTitle("/channels/discover")).toBe("Nguồn");
  });

  test("no route falls through to the app name", () => {
    const untitled = shellRoutes().filter((route) => getPageTitle(route) === "Crowsnest");

    // Named in the failure rather than counted, so a break says which route to fix.
    expect(untitled).toEqual([]);
  });
});

describe("/mine is a redirect handler, not a page", () => {
  test("it carries no title: a handler never renders the topbar", () => {
    // Only page.tsx files render under the shell; /mine is route.ts, so a title for it is dead config.
    expect(shellRoutes()).not.toContain("/mine");
    expect(getPageTitle("/mine")).toBe("Crowsnest");
  });

  test("no in-app link goes through the redirect", () => {
    const files = ["src/components/remix/stage-finish.tsx", "src/components/vault/script-detail-dialog.tsx"];
    const linking = files.filter((f) => readFileSync(path.join(process.cwd(), f), "utf8").includes('href="/mine"'));
    expect(linking).toEqual([]);
  });
});
