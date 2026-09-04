import { PersonaSection } from "@/components/settings/persona-section";
import { getPersona } from "@/server/services/persona";

// Reads live `persona` / `app_settings.niche_profile` state on every load, same
// reasoning as settings/page.tsx and runs/page.tsx: no dynamic segment or searchParams
// to implicitly opt this route out of static rendering otherwise.
export const dynamic = "force-dynamic";

// Topbar already renders this route's h1 ("Persona") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts directly at the section.
export default async function PersonaPage() {
  const persona = await getPersona();
  return (
    <div className="mx-auto max-w-[720px] p-6">
      <PersonaSection initial={persona} />
    </div>
  );
}
