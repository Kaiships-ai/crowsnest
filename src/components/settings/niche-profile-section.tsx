import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * DESIGN.md §2.7's Niche Profile editor lived here as a Textarea feeding
 * `services/remix.ts`'s `getNicheProfile()` (`app_settings.niche_profile`). Task 6 moves
 * editing to `/persona`: the niche text is now the seed for Persona's Audience field
 * (`getPersona()` in `server/services/persona.ts`), and every Remix generation stage
 * reads the full persona (audience, voice, do, do-not) rather than the niche string
 * alone. This section becomes a pointer rather than an editor, on purpose — with the
 * Persona screen now the real editing surface, a second editable copy of the same value
 * here would just be two places that could disagree about what "the niche" currently
 * is.
 *
 * `app_settings.niche_profile` itself is untouched: nothing here writes or clears it,
 * and `getPersona()` still reads it as a fresh persona's seed the same way it always
 * did (see that function's own doc comment). Server, not client — there is no local
 * state or action left to run, just a link.
 */
export function NicheProfileSection({ initialNiche }: { initialNiche: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Niche profile</CardTitle>
        <CardDescription>
          {initialNiche ? `Currently "${initialNiche}." Edit it, along with voice and do/don't guidance, on` : "Configured on"}{" "}
          <Link href="/persona" className="underline underline-offset-2 hover:text-foreground">
            Persona
          </Link>
          , which feeds every Remix generation.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
