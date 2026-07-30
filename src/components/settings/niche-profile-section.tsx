"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveNicheSettingsAction } from "@/server/actions/settings-actions";

// Comma-separated free text, same convention as new-template-dialog.tsx's tags Input
// — simpler than a chip widget and consistent with the rest of the app.
function parseKeywords(value: string): string[] {
  return value
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** DESIGN.md §2.7's Niche Profile section — the Textarea + keyword list feed
 * services/remix.ts's getNicheProfile() (same `app_settings.niche_profile` key), so
 * every Remix generation stage is grounded by whatever's saved here. */
export function NicheProfileSection({
  initialNiche,
  initialKeywords,
}: {
  initialNiche: string;
  initialKeywords: string[];
}) {
  const [niche, setNiche] = useState(initialNiche);
  const [keywordsText, setKeywordsText] = useState(initialKeywords.join(", "));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await saveNicheSettingsAction(niche, parseKeywords(keywordsText));
    setSaving(false);
    if (result.ok) toast.success("Niche profile saved");
    else toast.error(result.error);
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Niche profile</h2>
        <p className="text-sm text-muted-foreground">Feeds every Remix generation — describe your audience and content style.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="niche-profile">Description</Label>
        <Textarea id="niche-profile" value={niche} onChange={(e) => setNiche(e.target.value)} rows={4} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="niche-keywords">Keywords (comma separated)</Label>
        <Input
          id="niche-keywords"
          value={keywordsText}
          onChange={(e) => setKeywordsText(e.target.value)}
          placeholder="ai, productivity, solo-founder"
        />
      </div>

      <Button onClick={save} disabled={saving || !niche} className="w-fit">
        {saving ? "Saving…" : "Save"}
      </Button>
    </section>
  );
}
