import { redirect } from "next/navigation";
import { mineRedirectTarget } from "@/components/mine/month-param";

/** /mine moved onto the Dashboard. Every inbound link (remix finish, vault script dialog)
 *  is about the plan, so it lands on the Calendar tab, keeping a valid month. */
export default async function MinePage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  redirect(mineRedirectTarget(await searchParams));
}
