import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { METRIC_LEDGER, type MetricSource } from "@/server/metrics/ledger";
import { setSecret } from "@/server/secrets/store";
import { buildRegistry, CONNECTORS, listConnectors, managedSecrets, testConnector } from "./registry";
import type { Connector } from "./types";

const DIR = join(process.cwd(), "src/server/connectors");
const REAL = import.meta.glob<{ connector: Connector }>("./*/index.ts", { eager: true });
const SAMPLE = import.meta.glob<{ connector: Connector }>("./__fixtures__/*/index.ts", { eager: true });

beforeEach(async () => {
  migrate();
  await db.delete(tables.sealedSecrets);
  await db.delete(tables.secrets);
});

describe("connector registry", () => {
  test("every connector folder registers itself, with no list to edit", () => {
    const folders = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("__")).map((d) => d.name);
    expect(CONNECTORS.map((c) => c.manifest.id)).toEqual(folders.sort());
    expect(CONNECTORS.map((c) => [c.manifest.id, c.adapter ? "adapter" : "manifest-only"])).toEqual([
      ["chatbotx", "manifest-only"],
      ["groq", "adapter"],
      ["ig-sidecar", "adapter"],
      ["instagram-graph", "adapter"],
      ["polar", "manifest-only"],
      ["umami", "manifest-only"],
    ]);
  });

  test("a sample connector in its own folder lists, tests, pulls and reads its secret with no core edit", async () => {
    const registry = buildRegistry({ ...REAL, ...SAMPLE });
    const sample = registry.find((c) => c.manifest.id === "sample-crm");
    expect(listConnectors(registry).find((c) => c.id === "sample-crm")).toMatchObject({ status: "needs-setup", feeds: ["purchase"] });
    expect(await testConnector("sample-crm", registry)).toEqual({ ok: false, message: "no API key" });

    setSecret("SAMPLE_CRM_KEY", "crm-key-1");
    expect(listConnectors(registry).find((c) => c.id === "sample-crm")?.status).toBe("configured");
    expect(await testConnector("sample-crm", registry)).toEqual({ ok: true, message: null });
    expect(await sample?.adapter?.pull?.()).toEqual({ kind: "complete", rows: [{ orders: 3 }] });
    expect(managedSecrets(registry).map((m) => m.spec.name)).toContain("SAMPLE_CRM_KEY");
  });

  test("refuses a connector whose id is not its folder, or a secret two connectors declare", () => {
    const sample = SAMPLE["./__fixtures__/sample-crm/index.ts"];
    expect(() => buildRegistry({ "./other/index.ts": sample })).toThrow('exports connector "sample-crm"; its id must be its folder name');
    const twin = { connector: { ...sample.connector, manifest: { ...sample.connector.manifest, id: "twin" } } };
    expect(() => buildRegistry({ ...SAMPLE, "./twin/index.ts": twin })).toThrow("secret SAMPLE_CRM_KEY is declared by both sample-crm and twin");
  });

  test("every ledger metric marked not-connected names a manifest-only connector that feeds it", () => {
    const views = listConnectors();
    for (const [id, metric] of Object.entries(METRIC_LEDGER)) {
      const source: MetricSource | null = metric.kind === "count" ? metric.source : null;
      if (source?.kind !== "not-connected") continue;
      const owner = views.find((v) => v.id === source.connector);
      expect(owner?.status, id).toBe("not-connected");
      expect(owner?.feeds, id).toContain(id);
    }
  });

  test("lists where each secret comes from, never its value", () => {
    setSecret("IG_GRAPH_TOKEN", "graph-sentinel-token");
    const graph = listConnectors().find((c) => c.id === "instagram-graph");
    expect(graph?.secrets.find((s) => s.name === "IG_GRAPH_TOKEN")?.source).toBe("keychain");
    expect(JSON.stringify(listConnectors())).not.toContain("graph-sentinel-token");
  });

  test("a manifest-only connector is never called", async () => {
    expect(await testConnector("polar")).toEqual({ ok: false, message: "polar is not connected" });
  });
});

describe("secret reads go through the registry", () => {
  const ALLOWED = ["src/server/connectors/secrets.ts", "src/server/start.ts"];
  const roots = ["src/server", "src/lib", "src/kai-cli", "src/main", "scripts"];

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const path = join(dir, d.name);
      if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(path);
      return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [path] : [];
    });
  }

  test("only the connector secrets module and boot import the keychain store", () => {
    const importers = roots
      .flatMap((root) => sources(join(process.cwd(), root)))
      .filter((path) => /^import (?!type )[^;]*from "[^"]*secrets\/store"/m.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));
    expect(importers.sort()).toEqual(ALLOWED);
  });
});
