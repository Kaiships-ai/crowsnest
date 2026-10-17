import Link from "next/link";

import { cn } from "@/lib/utils";
import type { GraphTokenStatus } from "@/server/graph/client";
import { peekTokenStatus } from "@/server/graph/token-status";

/** Configured but refused. A missing token is not "broken" (a fresh machine has none), and
 *  rate limits and network blips clear on their own. */
const BROKEN: Partial<Record<GraphTokenStatus["state"], string>> = {
  auth_failed: "Instagram từ chối token Graph.",
  permission_denied: "Token Graph thiếu quyền insights.",
};

/** J6 "Sửa khi hỏng": one line when the Graph token is broken, opening the Instagram card
 *  in Cài đặt. Reads the last Check or measurement only, never Graph, so it never holds up a
 *  render or spends the hourly Graph budget. */
export function GraphTokenLine({ className }: { className?: string }) {
  const status = peekTokenStatus();
  const message = status ? BROKEN[status.state] : undefined;
  if (!message) return null;
  return (
    <Link
      href="/settings#graph-api"
      data-testid="graph-token-line"
      className={cn("mb-4 flex items-center gap-2 text-sm text-destructive underline-offset-2 hover:underline", className)}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
      {message} Mở Cài đặt để sửa.
    </Link>
  );
}
