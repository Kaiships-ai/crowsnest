import { NextResponse, type NextRequest } from "next/server";

/** `/?tab=...` is an old Dashboard link. A config redirect would carry the query along and
 *  loop, and a page `redirect()` streams under loading.tsx, so it lands here instead. */
export function proxy(request: NextRequest) {
  if (!request.nextUrl.searchParams.has("tab")) return NextResponse.next();
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = { matcher: "/" };
