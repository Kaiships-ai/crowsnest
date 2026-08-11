"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bridgeAddChannel, bridgeImportReel } from "./sync-bridge";

// The platform picker used to offer TikTok and YouTube Shorts. Nothing could ever sync
// them — there is one data source now, Instagram — so choosing either produced a channel
// row that silently never updated. An option that cannot work is worse than no option.
// The `platform` column stays in the schema for a future second source.

export function AddChannelDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialTab = "handle",
  showTrigger = true,
}: {
  /** Externally-controlled open state — the feed toolbar's "Add video URL" button drives
   *  this same dialog instance rather than owning a second submit path (task-4 brief:
   *  reuse the existing single-reel import, don't write a second one). Omitted, the
   *  dialog falls back to its own internal `open` state, unchanged from before. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which tab the dialog opens on. The feed toolbar opens straight to "url" so "Add
   *  video URL" doesn't land on the handle form first. */
  initialTab?: "handle" | "url";
  /** The channels board renders its own "Add channel" trigger button; the feed toolbar
   *  supplies its own "Add video URL" button instead and drives `open` itself, so it
   *  passes `false` here to skip rendering a second, redundant trigger. */
  showTrigger?: boolean;
} = {}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const [tab, setTab] = useState<"handle" | "url">(initialTab);
  const [handle, setHandle] = useState("");
  const [reelUrl, setReelUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setHandle("");
    setReelUrl("");
    setError(null);
    setPending(false);
  }

  function onOpenChange(next: boolean) {
    if (isControlled) controlledOnOpenChange?.(next);
    else setUncontrolledOpen(next);
    // Every open starts back on `initialTab` — without this, a caller-driven open (e.g.
    // the feed toolbar wanting "url") would land on whatever tab a *previous* open left
    // the still-mounted dialog on.
    if (next) setTab(initialTab);
    if (!next) reset();
  }

  async function submitHandle() {
    // Clear the previous rejection first, so a retry does not sit under a stale reason
    // while the new attempt is in flight.
    setError(null);
    setPending(true);
    const result = await bridgeAddChannel(handle);
    setPending(false);
    if (result.ok) {
      toast.success(`${handle} tracked`);
      onOpenChange(false);
      // The board behind this dialog is server-rendered, so the new column only appears
      // after the route re-renders. Without this the add looked like it did nothing until
      // the user reloaded by hand.
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function submitReel() {
    setError(null);
    setPending(true);
    const result = await bridgeImportReel(reelUrl);
    setPending(false);
    if (result.ok) {
      toast.success("Reel imported");
      onOpenChange(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showTrigger && <DialogTrigger render={<Button size="sm" variant="secondary" />}>Add channel</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a channel</DialogTitle>
          <DialogDescription>Track a channel by handle, or import a single reel by URL.</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "handle" | "url");
            setError(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="handle">By handle</TabsTrigger>
            <TabsTrigger value="url">Paste reel URL</TabsTrigger>
          </TabsList>

          <TabsContent value="handle" className="pt-2">
            {/* A form, not just an Input + Button, so Enter in the field submits the
                same way the button click does — same pattern the Settings secret
                fields use (secrets-section.tsx), just via a real submit event instead
                of an onKeyDown check, since there's exactly one field per tab here. */}
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitHandle();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="channel-handle">Instagram handle</Label>
                <Input
                  id="channel-handle"
                  placeholder="@handle or instagram.com/handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  A profile URL works too — it&apos;s normalised to a handle.
                </p>
              </div>
              <Button type="submit" disabled={!handle || pending}>
                {pending ? "Checking handle…" : "Track channel"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="url" className="pt-2">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitReel();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reel-url">Reel URL</Label>
                <Input
                  id="reel-url"
                  placeholder="https://…"
                  value={reelUrl}
                  onChange={(e) => setReelUrl(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!reelUrl || pending}>
                {pending ? "Importing…" : "Import reel"}
              </Button>
            </form>
          </TabsContent>

          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
