import { test, expect } from "@playwright/test";
import { installMockBackend } from "./helpers/mock-backend";

// Keyless acceptance smoke for the mock-backend harness. It proves the intercept
// works without a running Next server or database, so the same helper can pin
// real page behavior once specs navigate the app (npm run dev, then page.goto).
test("mock-backend intercepts an api fetch and the page renders the fixture", async ({ page }) => {
  const backend = await installMockBackend(page, {
    "/api/feed": { outliers: [{ id: "v1", title: "Mocked outlier" }] },
  });

  await page.setContent(`
    <div id="out">loading</div>
    <script>
      fetch("https://crowsnest.local/api/feed")
        .then((r) => r.json())
        .then((d) => { document.getElementById("out").textContent = d.outliers[0].title; });
    </script>
  `);

  await expect(page.getByText("Mocked outlier")).toBeVisible();
  expect(backend.calls("/api/feed")).toHaveLength(1);
});

test("an unmapped api path returns 404 so specs fail loudly", async ({ page }) => {
  await installMockBackend(page, {});

  await page.setContent(`
    <div id="status">pending</div>
    <script>
      fetch("https://crowsnest.local/api/missing")
        .then((r) => { document.getElementById("status").textContent = String(r.status); });
    </script>
  `);

  await expect(page.getByText("404")).toBeVisible();
});
