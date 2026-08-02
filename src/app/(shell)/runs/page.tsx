import { RunsList } from "@/components/runs/runs-list";
import { getSetting } from "@/server/settings";
import { listRuns } from "@/server/queries/runs";

// Same reasoning as every other data-backed page in this shell (logs/page.tsx,
// channels/page.tsx): the first paint has to read whatever sync_jobs/remix_runs say
// right now, not a build-time snapshot. Live updates past first paint come from
// RunsList's SSE subscription (useRunStream), not from this route re-rendering.
export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = listRuns();
  // Read once per request, same as every other settings-backed page component (e.g.
  // settings/page.tsx's own Promise.all). RunsList needs both budgets client side to
  // evaluate the SLA chip on every stream tick, since evaluateSla is a pure function
  // with no settings access of its own.
  const [syncSlaMinutes, remixSlaMinutes] = await Promise.all([
    getSetting("syncSlaMinutes"),
    getSetting("remixSlaMinutes"),
  ]);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Runs</h1>
      <p className="mb-4 font-mono text-2xs text-faint">{runs.length} runs</p>
      <RunsList seedRuns={runs} syncSlaMinutes={syncSlaMinutes} remixSlaMinutes={remixSlaMinutes} />
    </div>
  );
}
