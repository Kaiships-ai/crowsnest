"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { finishRemixAction } from "@/server/actions/remix-actions";
import type { RemixSessionRow } from "@/server/services/remix";

/**
 * The last stage: confirm what the run produced, then add it to the plan.
 *
 * Before this stage existed a remix ended at "script saved", and the only route onward
 * was noticing the optional date field on the Script stage. Finishing creates an undated
 * draft planned post, with `planned_posts.remixSessionId` carrying the remix's hook and
 * beats onto that post.
 *
 * Nothing here is invented. A hook or a variant the user never picked renders as a
 * placeholder saying so, not as a plausible-looking default.
 */
export function StageFinish({ session }: { session: RemixSessionRow }) {
  const [pending, setPending] = useState(false);
  const [postId, setPostId] = useState<string | null>(null);

  const variants = session.variants ?? [];
  const chosenIndex = session.chosenVariantIndex;
  // Deliberately not `variants[chosenIndex ?? 0]`: falling back to the first variant
  // would show the user a script they never chose and call it their pick.
  const chosenVariant = chosenIndex !== null && chosenIndex >= 0 ? (variants[chosenIndex] ?? null) : null;

  async function finish() {
    setPending(true);
    const result = await finishRemixAction(session.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPostId(result.postId);
    toast.success(result.created ? "Added to your plan." : "Opening your plan.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span data-lab className="font-mono text-2xs tracking-wide text-faint uppercase">
          Hook
        </span>
        {session.chosenHook ? (
          <p className="text-sm text-foreground">{session.chosenHook}</p>
        ) : (
          <p className="text-sm text-muted-foreground">(no hook chosen)</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span data-lab className="font-mono text-2xs tracking-wide text-faint uppercase">
          Chosen script
        </span>
        {chosenVariant !== null ? (
          <>
            <p className="text-xs text-muted-foreground">
              Variant <span data-num>{(chosenIndex ?? 0) + 1}</span> of {variants.length}
            </p>
            <p className="mt-1 border-l-2 border-border pl-3 text-sm whitespace-pre-wrap text-foreground">{chosenVariant}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            (no variant picked yet) Go back to the Script stage, open the variant you want, and save it.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {postId ? (
          <>
            <p className="text-sm text-muted-foreground">This remix is on your plan.</p>
            <Link
              href="/mine"
              className="w-fit border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted active:scale-[0.98]"
            >
              View in your plan
            </Link>
          </>
        ) : (
          <>
            <Button onClick={finish} disabled={pending}>
              {pending ? "Finishing…" : "Finish"}
            </Button>
            <p className="max-w-[56ch] text-xs text-muted-foreground">
              Adds this remix to your plan as an undated draft. No date is set, because
              finishing a script is not a decision about when to post it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
