import Link from "next/link";
import { Archive } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { NewTemplateDialog } from "@/components/vault/new-template-dialog";
import { ScriptCard } from "@/components/vault/script-card";
import { SavedPostRow } from "@/components/vault/saved-post-row";
import { TemplateCard } from "@/components/vault/template-card";
import { VaultEmptyState } from "@/components/vault/vault-empty-state";
import { VaultSearch } from "@/components/vault/vault-search";
import { VaultSortControl } from "@/components/vault/vault-sort-control";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>
          No {noun} match &ldquo;{query}&rdquo;.
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

/** The true-empty-Vault state (no hooks AND no styles at all) is distinct copy from a
 * single tab being empty while the Vault has other template items. */
function EmptyTemplates({ kind, templatesEmpty }: { kind: "hook" | "style"; templatesEmpty: boolean }) {
  if (templatesEmpty) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Archive />
          </EmptyMedia>
          <EmptyTitle>Nothing saved yet.</EmptyTitle>
          <EmptyDescription>
            Hooks and styles are saved from a video&rsquo;s detail page, not from here: open an analyzed video and use its
            &ldquo;Save to Vault&rdquo; button to keep a hook or a style.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href="/feed" />}>Open the feed</Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>No {kind === "hook" ? "hooks" : "styles"} saved yet.</EmptyTitle>
      </EmptyHeader>
    </Empty>
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
    <PageContainer className="flex min-h-screen flex-col gap-8">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        {/* No heading here: Topbar already renders this route's h1 ("Vault") — see
            nav-items/topbar's ROUTE_TITLES — so the page printed the same word a second
            time down the left edge. Dropped outright, the way /logs and /runs did,
            rather than demoted: /mine keeps its line because it names WHICH channel is
            yours, which the topbar never says, and this one said nothing the topbar had
            not already said. */}
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Saved post</TableHead>
                  <TableHead className="w-[76px] text-right">Score</TableHead>
                  <TableHead className="w-[112px] text-right">Why kept</TableHead>
                  <TableHead className="w-[104px] text-right">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedPosts.map((row) => (
                  <SavedPostRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="scripts" className="pt-6">
          {scripts.length === 0 && query !== "" ? (
            <NoMatches noun="scripts" query={query} />
          ) : scripts.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyTitle>No scripts yet. Write one in the Remix Studio.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
    </PageContainer>
  );
}
