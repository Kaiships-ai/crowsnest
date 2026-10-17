import { toast } from "sonner";

type AutosaveResult = { ok: true } | { ok: false; error: string };

/**
 * Wraps a fire-and-forget autosave call (`updateStageAction(...)`, invoked directly —
 * not awaited — from a stage's onChange/onBlur handlers) so a rejected promise or an
 * `{ ok: false }` result surfaces as a toast instead of vanishing silently. Before
 * this (review finding M2), a failed background save — a network blip, a stale
 * session id, whatever — left the user editing a draft that was never actually being
 * persisted, with zero feedback. Resolves true only when the write landed.
 */
export function autosave(result: Promise<AutosaveResult>): Promise<boolean> {
  return result
    .then((res) => {
      if (!res.ok) toast.error("Autosave failed", { description: res.error });
      return res.ok;
    })
    .catch(() => {
      toast.error("Autosave failed");
      return false;
    });
}
