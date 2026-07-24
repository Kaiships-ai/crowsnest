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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bridgeAddChannel, bridgeImportReel } from "./sync-bridge";

const PLATFORM_ITEMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
];

export function AddChannelDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"handle" | "url">("handle");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState("instagram");
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
    const result = await bridgeAddChannel(handle, platform);
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
      <DialogTrigger render={<Button size="sm" />}>+ Channel</DialogTrigger>
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
              <Label htmlFor="channel-handle">Handle</Label>
              <Input
                id="channel-handle"
                placeholder="@handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="channel-platform">Platform</Label>
              <Select items={PLATFORM_ITEMS} value={platform} onValueChange={(v) => setPlatform(v as string)}>
                <SelectTrigger id="channel-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_ITEMS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
