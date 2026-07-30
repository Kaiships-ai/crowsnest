import Link from "next/link";

import { NewTemplateDialog } from "@/components/vault/new-template-dialog";
import { ScriptCard } from "@/components/vault/script-card";
import { SavedPostRow, VAULT_ROW_GRID } from "@/components/vault/saved-post-row";
import { TemplateCard } from "@/components/vault/template-card";
import { VaultEmptyState } from "@/components/vault/vault-empty-state";
import { VaultSortControl } from "@/components/vault/vault-sort-control";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getTopOutliersToday } from "@/server/queries/dashboard";
import { getSavedPosts, type SavedPostSort } from "@/server/queries/saved-posts";
import { getScripts, getVaultItems, type VaultItemRow } from "@/server/queries/vault";

// v1-scope.md P1 Vault schedules Hooks/Styles to move to the Remix stage 3/4 pickers,
// with a "save as template" action from the detail screen as their new save path. That
// destination isn't built yet anywhere in the app, and vault_items already holds real
// rows (hooks and layouts saved from real analyses). Retiring these two tabs before the
// pickers exist would make that real content unreachable from any screen, which is the
// same failure as a control that does nothing, just facing the other way: content that
// exists and cannot be got at. So these tabs stay until whoever builds the pickers
// retires them in the same change that gives the items their new home.
const VALID_TABS = ["posts", "scripts", "hooks", "styles"] as const;
const VALID_SORTS: SavedPostSort[] = ["recent", "score", "analyzed"];

function parseSort(value: string | undefined): SavedPostSort {
  return (VALID_SORTS as string[]).includes(value ?? "") ? (value as SavedPostSort) : "recent";
}

/** The true-empty-Vault state (no hooks AND no styles at all) is distinct copy from a
 * single tab being empty while the Vault has other template items. */
function EmptyTemplates({ kind, templatesEmpty }: { kind: "hook" | "style"; templatesEmpty: boolean }) {
  if (templatesEmpty) {
    return (
      <div className="mx-auto flex max-w-[52ch] flex-col items-center gap-3 py-16 text-center">
        <p className="text-lg font-medium">Nothing saved yet.</p>
        <p className="text-sm text-muted-foreground">
          Saving a hook or style keeps it with its source video, so a remix run can start from it later.
        </p>
        <Link href="/feed" className={cn(buttonVariants({ variant: "default" }), "mt-2")}>
          Browse the Feed
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

function TemplateGrid({ items, kind, templatesEmpty }: { items: VaultItemRow[]; kind: "hook" | "style"; templatesEmpty: boolean }) {
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
  searchParams: Promise<{ tab?: string; sort?: string }>;
}) {
  const { tab, sort: sortParam } = await searchParams;
  const sort = parseSort(sortParam);
  const defaultTab = (VALID_TABS as readonly string[]).includes(tab ?? "") ? tab! : "posts";

  const [savedPosts, scripts, hooks, styles] = await Promise.all([
    getSavedPosts(sort),
    getScripts(),
    getVaultItems("hook"),
    getVaultItems("style"),
  ]);
  const templatesEmpty = hooks.length === 0 && styles.length === 0;
  // Only spend a query on this when the empty state actually needs a real link, since
  // there is no sense reading the top outlier on every visit to a Vault with rows.
  const topOutlier = savedPosts.length === 0 ? await getTopOutliersToday(1) : [];

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.015em]">Vault</h1>
          <p className="mt-3 font-mono text-2xs text-faint">
            {savedPosts.length === 0
              ? "Nothing saved yet."
              : `${savedPosts.length} saved post${savedPosts.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <NewTemplateDialog />
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList variant="line" className="border-b border-border">
          <TabsTrigger value="posts" data-lab className="font-mono text-2xs">
            Saved posts
          </TabsTrigger>
          <TabsTrigger value="scripts" data-lab className="font-mono text-2xs">
            Scripts
          </TabsTrigger>
          <TabsTrigger value="hooks" data-lab className="font-mono text-2xs">
            Hooks
          </TabsTrigger>
          <TabsTrigger value="styles" data-lab className="font-mono text-2xs">
            Styles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="pt-6">
          <div className="flex justify-end pb-6">
            <VaultSortControl sort={sort} />
          </div>

          {savedPosts.length === 0 ? (
            <VaultEmptyState topOutlierVideoId={topOutlier[0]?.videoId ?? null} />
          ) : (
            <div className="flex flex-col">
              <div
                className={cn(
                  VAULT_ROW_GRID,
                  "gap-4 border-b border-border pb-3 font-mono text-2xs tracking-wide text-faint"
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
          {scripts.length === 0 ? (
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
          <TemplateGrid items={hooks} kind="hook" templatesEmpty={templatesEmpty} />
        </TabsContent>

        <TabsContent value="styles" className="pt-6">
          <TemplateGrid items={styles} kind="style" templatesEmpty={templatesEmpty} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
