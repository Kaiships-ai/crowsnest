import Link from "next/link";

import { NewTemplateDialog } from "@/components/vault/new-template-dialog";
import { ScriptCard } from "@/components/vault/script-card";
import { SavedPostRow, VAULT_ROW_GRID } from "@/components/vault/saved-post-row";
import { TemplateCard } from "@/components/vault/template-card";
import { VaultEmptyState } from "@/components/vault/vault-empty-state";
import { VaultSearch } from "@/components/vault/vault-search";
import { VaultSortControl } from "@/components/vault/vault-sort-control";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getTopOutlierAllTime } from "@/server/queries/dashboard";
import { getSavedPosts, type SavedPostSort } from "@/server/queries/saved-posts";
import { getScripts, getVaultItems, type VaultItemRow } from "@/server/queries/vault";

import { matchesQuery } from "./vault-filter";
import { vaultHeaderCopy } from "./vault-header-copy";

// v1-scope.md P1 (archived) once planned to retire these two tabs and move Hooks/Styles
// into the Remix stage 3/4 pickers, with their own "save as template" action embedded in
// that flow. That in-flow picker action still isn't built. But a save path already
// exists today, just not in that planned location: a video's detail page renders a
// "Save to Vault" dialog once the video is analyzed (SaveToVaultDialog, saveToVaultAction
// in server/actions/vault-actions.ts), and vault_items holds real rows written through
// it. So these tabs are not a dead end - they read from a real, reachable save flow -
// and they stay until whoever builds the pickers gives the items a new home in the same
// change that retires this one.
const VALID_TABS = ["posts", "scripts", "hooks", "styles"] as const;
const VALID_SORTS: SavedPostSort[] = ["recent", "score", "analyzed"];

function parseSort(value: string | undefined): SavedPostSort {
  return (VALID_SORTS as string[]).includes(value ?? "") ? (value as SavedPostSort) : "recent";
}

/** A tab emptied by a search says so, rather than reusing the "nothing saved yet" copy
 * that would tell the user their Vault is empty when it is only filtered. */
function NoMatches({ noun, query }: { noun: string; query: string }) {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      No {noun} match &ldquo;{query}&rdquo;.
    </p>
  );
}

/** The true-empty-Vault state (no hooks AND no styles at all) is distinct copy from a
 * single tab being empty while the Vault has other template items. */
function EmptyTemplates({ kind, templatesEmpty }: { kind: "hook" | "style"; templatesEmpty: boolean }) {
  if (templatesEmpty) {
    return (
      <div className="mx-auto flex max-w-[52ch] flex-col items-center gap-3 py-16 text-center">
        <p className="text-lg font-medium">Nothing saved yet.</p>
        <p className="text-sm text-muted-foreground">
          Hooks and styles are saved from a video&rsquo;s detail page, not from here: open
          an analyzed video and use its &ldquo;Save to Vault&rdquo; button to keep a hook
          or a style.
        </p>
        <Link href="/feed" className={cn(buttonVariants({ variant: "default" }), "mt-2")}>
          Open the feed
        </Link>
      </div>
    );
  }
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      No {kind === "hook" ? "hooks" : "styles"} saved yet.
    </p>
  );
}

function TemplateGrid({
  items,
  kind,
  templatesEmpty,
  query,
}: {
  items: VaultItemRow[];
  kind: "hook" | "style";
  templatesEmpty: boolean;
  query: string;
}) {
  if (items.length === 0 && query !== "") return <NoMatches noun={kind === "hook" ? "hooks" : "styles"} query={query} />;
  if (items.length === 0) return <EmptyTemplates kind={kind} templatesEmpty={templatesEmpty} />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {items.map((item) => (
        <TemplateCard key={item.id} item={item} />
      ))}
    </div>
  );
}

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; sort?: string; q?: string }>;
}) {
  const { tab, sort: sortParam, q } = await searchParams;
  const sort = parseSort(sortParam);
  const query = (q ?? "").trim();
  const defaultTab = (VALID_TABS as readonly string[]).includes(tab ?? "") ? tab! : "posts";

  const [allSavedPosts, allScripts, allHooks, allStyles] = await Promise.all([
    getSavedPosts(sort),
    getScripts(),
    getVaultItems("hook"),
    getVaultItems("style"),
  ]);
  // Whether the Vault holds any templates at all, read before the search narrows
  // anything: the "your Vault is empty" copy is about the Vault, not about the search.
  const templatesEmpty = allHooks.length === 0 && allStyles.length === 0;

  const savedPosts = allSavedPosts.filter((row) =>
    matchesQuery(query, [row.item.caption, row.item.channel.handle, row.note])
  );
  const scripts = allScripts.filter((script) =>
    matchesQuery(query, [script.title, script.content, script.sourceVideo?.channelHandle])
  );
  const filterTemplates = (items: VaultItemRow[]) =>
    items.filter((item) => matchesQuery(query, [item.title, item.templateText, ...item.tags]));
  const hooks = filterTemplates(allHooks);
  const styles = filterTemplates(allStyles);
  // Only spend a query on this when the empty state actually needs a real link, since
  // there is no sense reading the top outlier on every visit to a Vault with rows.
  // All-time, not "today's top": the empty state wants a real outlier to browse, and
  // getTopOutliersToday's 7-day window can hand back a null-scored recent post when
  // nothing scored has been posted this week.
  const topOutlier = allSavedPosts.length === 0 ? await getTopOutlierAllTime(1) : [];
  // Only a genuinely scored post is worth a deep link; otherwise send the empty state
  // to /feed same as when there's no row at all.
  const topOutlierVideoId = topOutlier[0]?.outlierScore != null ? topOutlier[0].videoId : null;

  return (
    // min-h-screen (not tab-specific) so the page's total height never drops below the
    // shell's `main` viewport: without it, switching from the posts table (often taller
    // than the viewport, so `main`'s own scrollbar - overflow-y-auto in (shell)/layout.tsx
    // - is showing) to a short/empty card tab could drop the content below that
    // threshold and hide the scrollbar, which shifts this mx-auto column sideways by the
    // scrollbar's width. Forcing the wrapper past `main`'s visible height keeps that
    // scrollbar always present, so the column - and the tab bar inside it - never moves
    // horizontally on tab switch. Width/padding here are already tab-invariant: this div
    // wraps the header and the Tabs root, so no tab swap ever touches them.
    <div className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-10 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          {/* No heading here: Topbar already renders this route's h1 ("Vault") — see
              nav-items/topbar's ROUTE_TITLES — so the page printed the same word a
              second time down the left edge. Dropped outright, the way /logs and /runs
              did, rather than demoted: /mine keeps its line because it names WHICH
              channel is yours, which the topbar never says, and this one said nothing
              the topbar had not already said. The count line leads the page now, and
              its top margin goes with the heading it used to sit under. */}
          <p className="font-mono text-2xs text-muted-foreground">
            {vaultHeaderCopy(
              {
                savedPosts: savedPosts.length,
                scripts: scripts.length,
                hooks: hooks.length,
                styles: styles.length,
              },
              query
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <VaultSearch query={query} />
          <NewTemplateDialog />
        </div>
      </div>

      {/* Each tab carries its own count. The header line above is about the whole
          Vault, so without these a tab could still be read as a claim about the tab
          you are looking at, which is exactly the bug (a Scripts tab headed "0 saved
          posts"). With a search running these are match counts per tab, which is also
          how you find which tab the matches landed in. */}
      <Tabs defaultValue={defaultTab}>
        <TabsList variant="line" className="border-b border-border">
          <TabsTrigger value="posts" data-lab className="font-mono text-2xs">
            Saved posts <span className="ml-1.5 text-muted-foreground">{savedPosts.length}</span>
          </TabsTrigger>
          <TabsTrigger value="scripts" data-lab className="font-mono text-2xs">
            Scripts <span className="ml-1.5 text-muted-foreground">{scripts.length}</span>
          </TabsTrigger>
          <TabsTrigger value="hooks" data-lab className="font-mono text-2xs">
            Hooks <span className="ml-1.5 text-muted-foreground">{hooks.length}</span>
          </TabsTrigger>
          <TabsTrigger value="styles" data-lab className="font-mono text-2xs">
            Styles <span className="ml-1.5 text-muted-foreground">{styles.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="pt-6">
          <div className="flex justify-end pb-6">
            <VaultSortControl sort={sort} />
          </div>

          {savedPosts.length === 0 && query !== "" ? (
            <NoMatches noun="saved posts" query={query} />
          ) : savedPosts.length === 0 ? (
            <VaultEmptyState topOutlierVideoId={topOutlierVideoId} />
          ) : (
            <div className="flex flex-col">
              {/* VAULT_ROW_GRID is `40px_minmax(0,1fr)_76px_112px_104px` - every column but
                  the caption is a fixed pixel track, and SavedPostRow already falls back to
                  "-" for a missing score/note rather than rendering an empty cell, so no
                  column ever shrinks or grows with a row's content. Header and rows share
                  this one grid, so they can't drift out of alignment either. */}
              <div
                className={cn(
                  VAULT_ROW_GRID,
                  "gap-4 border-b border-border pb-3 font-mono text-2xs tracking-wide text-muted-foreground"
                )}
              >
                <span />
                <span>SAVED POST</span>
                <span className="text-right">SCORE</span>
                <span className="text-right">WHY KEPT</span>
                <span className="text-right">POSTED</span>
              </div>
              <div>
                {savedPosts.map((row) => (
                  <SavedPostRow key={row.id} row={row} />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="scripts" className="pt-6">
          {scripts.length === 0 && query !== "" ? (
            <NoMatches noun="scripts" query={query} />
          ) : scripts.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No scripts yet. Write one in the Remix Studio.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {scripts.map((script) => (
                <ScriptCard key={script.id} script={script} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="hooks" className="pt-6">
          <TemplateGrid items={hooks} kind="hook" templatesEmpty={templatesEmpty} query={query} />
        </TabsContent>

        <TabsContent value="styles" className="pt-6">
          <TemplateGrid items={styles} kind="style" templatesEmpty={templatesEmpty} query={query} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
