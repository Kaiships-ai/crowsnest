"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveNicheSettingsAction } from "@/server/actions/settings-actions";

/** DESIGN.md §2.7's Niche Profile section — the Textarea feeds services/remix.ts's
 * getNicheProfile() (`app_settings.niche_profile`), so every Remix generation stage
 * is grounded by whatever's saved here.
 *
 * There used to be a Keywords field next to this one. It wrote to
 * `app_settings.niche_keywords` and was read back only to repopulate its own input
 * — no generation prompt or query anywhere in the app ever read it (truth pass,
 * v1-gap-inventory.md). A field that presents as configuration and changes nothing
 * is the fabricated-capability bug the truth pass exists to remove, so it's gone
 * from the screen. `initialKeywords` is still threaded through and sent back
 * unchanged on every save, so no stored value gets silently wiped by this change —
 * it's just not something you can see or edit anymore. */
export function NicheProfileSection({
  initialNiche,
  initialKeywords,
}: {
  initialNiche: string;
  initialKeywords: string[];
}) {
  const [niche, setNiche] = useState(initialNiche);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await saveNicheSettingsAction(niche, initialKeywords);
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

      <Button onClick={save} disabled={saving || !niche} className="w-fit">
        {saving ? "Saving…" : "Save"}
      </Button>
    </section>
  );
}
