import type { Page } from "@playwright/test";

export type Fixtures = Record<string, unknown>;

export interface MockBackend {
  /** Pathnames of intercepted `/api/**` requests, in call order. */
  calls(path: string): string[];
}

/**
 * Install a deterministic, keyless mocked backend for a Playwright page.
 *
 * Intercepts every fetch to the Next API routes (`**\/api\/**`) and serves the
 * fixture keyed by the request pathname. An unmapped path returns 404 so a spec
 * fails loudly instead of hanging. This is the crowsnest analog of openclaw's
 * mock Gateway: pin UI behavior against fixed data, then change internals freely.
 */
export async function installMockBackend(page: Page, fixtures: Fixtures): Promise<MockBackend> {
  const seen: string[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    seen.push(pathname);
    const body = fixtures[pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "no fixture", path: pathname }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return {
    calls: (path: string) => seen.filter((p) => p === path),
  };
}
