import Link from "next/link";

import { NewTemplateDialog } from "@/components/vault/new-template-dialog";
import { TemplateCard } from "@/components/vault/template-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getScripts, getVaultItems, type VaultItemRow } from "@/server/queries/vault";

function firstLine(content: string): string {
  return content.split("\n")[0] ?? "";
}

/** DESIGN.md §6: the true-empty-Vault state (no hooks AND no styles at all) is
 * distinct copy from a single tab being empty while the Vault has other items. */
function EmptyTemplates({ kind, vaultIsEmpty }: { kind: "hook" | "style"; vaultIsEmpty: boolean }) {
  if (vaultIsEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No templates yet — save a hook or style from any video to start your Vault.
        </p>
        <Link href="/feed" className={cn(buttonVariants({ variant: "default" }))}>
          Browse the Feed
        </Link>
      </div>
    );
  }
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      No {kind === "hook" ? "hooks" : "styles"} saved yet.
    </p>
  );
}

function TemplateGrid({ items, kind, vaultIsEmpty }: { items: VaultItemRow[]; kind: "hook" | "style"; vaultIsEmpty: boolean }) {
  if (items.length === 0) return <EmptyTemplates kind={kind} vaultIsEmpty={vaultIsEmpty} />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {items.map((item) => (
        <TemplateCard key={item.id} item={item} />
      ))}
    </div>
  );
}

const VALID_TABS = ["hooks", "styles", "scripts"] as const;

export default async function VaultPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [hooks, styles, scripts, { tab }] = await Promise.all([getVaultItems("hook"), getVaultItems("style"), getScripts(), searchParams]);
  const vaultIsEmpty = hooks.length === 0 && styles.length === 0;
  // Save Script's "View in Vault" link deep-links here with ?tab=scripts (Task 6).
  const defaultTab = (VALID_TABS as readonly string[]).includes(tab ?? "") ? tab! : "hooks";

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Vault</h1>
          <p className="text-sm text-muted-foreground">
            Your library of extracted hook and style templates, plus saved scripts.
          </p>
        </div>
        <NewTemplateDialog />
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
          <TabsTrigger value="styles">Styles</TabsTrigger>
          <TabsTrigger value="scripts">Scripts</TabsTrigger>
        </TabsList>

        <TabsContent value="hooks" className="pt-4">
          <TemplateGrid items={hooks} kind="hook" vaultIsEmpty={vaultIsEmpty} />
        </TabsContent>

        <TabsContent value="styles" className="pt-4">
          <TemplateGrid items={styles} kind="style" vaultIsEmpty={vaultIsEmpty} />
        </TabsContent>

        <TabsContent value="scripts" className="pt-4">
          {scripts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No scripts yet — write one in the Remix Studio.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {scripts.map((script) => (
                <Card key={script.id}>
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium">{script.title}</h3>
                      <Badge variant={script.status === "final" ? "default" : "outline"}>{script.status}</Badge>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{firstLine(script.content)}</p>
                    {(script.hookTitle || script.styleTitle) && (
                      <div className="flex flex-wrap gap-1">
                        {script.hookTitle && <Badge variant="secondary">{script.hookTitle}</Badge>}
                        {script.styleTitle && <Badge variant="secondary">{script.styleTitle}</Badge>}
                      </div>
                    )}
                    {script.sourceVideo && (
                      <Link
                        href={`/feed/${script.sourceVideo.videoId}`}
                        className="w-fit text-xs text-muted-foreground hover:text-foreground"
                      >
                        {script.sourceVideo.channelHandle}
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
