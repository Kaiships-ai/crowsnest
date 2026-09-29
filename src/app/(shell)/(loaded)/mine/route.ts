import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { mineRedirectTarget } from "@/components/mine/month-param";

/** /mine moved onto the Dashboard. Every inbound link (remix finish, vault script dialog)
 *  is about the plan, so it lands on the Calendar tab, keeping a valid month. A route
 *  handler, not a page: a page here streams under (loaded)/loading.tsx, so its redirect
 *  arrived as a 200 with a meta refresh instead of a real HTTP redirect. */
export function GET(request: NextRequest) {
  redirect(mineRedirectTarget({ month: request.nextUrl.searchParams.get("month") ?? undefined }));
}
