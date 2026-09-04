import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const NICHES = ["fitness", "finance", "tech", "business"] as const;
const DIR = join(process.cwd(), "data/seeds");

test.each(NICHES)("seed file %s is well-formed", (niche) => {
  const raw = JSON.parse(readFileSync(join(DIR, `${niche}.json`), "utf8"));
  expect(raw.niche).toBe(niche);
  expect(typeof raw.label).toBe("string");
  expect(Array.isArray(raw.creators)).toBe(true);
  const handles = new Set<string>();
  for (const c of raw.creators) {
    expect(c.handle).toMatch(/^[A-Za-z0-9._]+$/); // normalized, no @
    expect(typeof c.why).toBe("string");
    expect(c.why.length).toBeGreaterThan(0);
    expect(typeof c.source).toBe("string");
    expect(handles.has(c.handle.toLowerCase())).toBe(false);
    handles.add(c.handle.toLowerCase());
  }
});
