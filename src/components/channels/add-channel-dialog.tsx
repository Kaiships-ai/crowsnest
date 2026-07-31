"use client";

import { useState } from "react";
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

export function AddChannelDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"handle" | "url">("handle");
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
    setOpen(next);
    if (!next) reset();
  }

  async function submitHandle() {
    setPending(true);
    const result = await bridgeAddChannel(handle);
    setPending(false);
    if (result.ok) {
      toast.success(`${handle} tracked`);
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }

  async function submitReel() {
    setPending(true);
    const result = await bridgeImportReel(reelUrl);
    setPending(false);
    if (result.ok) {
      toast.success("Reel imported");
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>Add channel</DialogTrigger>
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

          <TabsContent value="handle" className="flex flex-col gap-3 pt-2">
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
            <Button onClick={submitHandle} disabled={!handle || pending}>
              Track channel
            </Button>
          </TabsContent>

          <TabsContent value="url" className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reel-url">Reel URL</Label>
              <Input
                id="reel-url"
                placeholder="https://…"
                value={reelUrl}
                onChange={(e) => setReelUrl(e.target.value)}
              />
            </div>
            <Button onClick={submitReel} disabled={!reelUrl || pending}>
              Import reel
            </Button>
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
