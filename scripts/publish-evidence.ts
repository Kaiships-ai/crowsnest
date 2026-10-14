/**
 * Produces the publish component's evidence under data/evidence/publish/ (gitignored).
 *
 * Two proofs, both grounded in the real publish code path, never a bespoke one:
 *  1. dry-run-fake.md: runs the real `publishPlannedPost` in dry-run against fake
 *     storage and graph deps, proving the full path (upload, container, poll,
 *     delete) runs while the final media_publish is skipped.
 *  2. graph-auth-live.md: runs the real `checkGraphTokenAction` (GET /me) with the
 *     token stored in the local secrets table, proving the own-channel Graph token
 *     authenticates. Only the non-secret status fields are written; the token is
 *     never read into the output.
 *
 * Never writes a token or S3 secret. The live check needs a copy of the main tree's
 * data/crowsnest.db in this worktree (see the orchestrator's evidence steps).
 *
 * Run:  IG_SERVICE_TOKEN=... CROWSNEST_DB_PATH=data/crowsnest.db npx tsx scripts/publish-evidence.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import { publishPlannedPost } from "@/server/services/publish-post";

const OUT = "data/evidence/publish";

function write(name: string, body: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}`, body.trimStart());
  console.log(`wrote ${OUT}/${name}`);
}

async function dryRunFake(): Promise<void> {
  const calls: string[] = [];
  const store = new Map<string, Record<string, unknown>>([
    ["evidence_plan", { id: "evidence_plan", state: "publishing", videoAssetId: "asset_x", caption: "Evidence dry run", dryRun: 0, attemptCount: 0 }],
  ]);

  const deps = {
    loadRow: async (id: string) => (store.get(id) ?? null) as never,
    writeRow: async (id: string, patch: Record<string, unknown>) => {
      calls.push(`writeRow  ${JSON.stringify(patch)}`);
      store.set(id, { ...store.get(id), ...patch });
    },
    resolveVideoPath: async () => {
      calls.push("resolveVideoPath  -> /fake/evidence.mp4 (exists)");
      return "/fake/evidence.mp4";
    },
    getStorageProvider: () => {
      calls.push("getStorageProvider  -> configured (fake)");
      return {
        upload: async () => {
          calls.push("storage.upload  -> https://fake.example/crowsnest/evidence.mp4");
          return { publicUrl: "https://fake.example/crowsnest/evidence.mp4", objectKey: "crowsnest/evidence.mp4" };
        },
        delete: async (key: string) => calls.push(`storage.delete  ${key}`),
      };
    },
    isGraphConfigured: () => {
      calls.push("isGraphConfigured  -> true (fake)");
      return true;
    },
    createReelContainer: async (a: { videoUrl: string; caption: string }) => {
      calls.push(`graph.createReelContainer  video_url=${a.videoUrl} caption=${JSON.stringify(a.caption)}`);
      return { containerId: "FAKE_CONTAINER_1" };
    },
    pollReelContainer: async (id: string) => {
      calls.push(`graph.pollReelContainer  ${id} -> FINISHED`);
      return { status: "FINISHED" as const };
    },
    publishReel: async () => {
      calls.push("graph.publishReel  CALLED (should NOT happen in dry-run)");
      return { mediaId: "UNEXPECTED" };
    },
    now: () => "2026-09-04T00:00:00.000Z",
  };

  delete process.env.PUBLISH_DRY_RUN; // unset + non-production NODE_ENV => dry-run on
  const result = await publishPlannedPost("evidence_plan", { ...deps, claimed: true } as never);
  const publishSkipped = !calls.some((c) => c.startsWith("graph.publishReel  CALLED"));

  write("dry-run-fake.md", `
# Publish dry-run, full path against fake storage and graph

Runs the real \`publishPlannedPost\` (src/server/services/publish-post.ts) on a
ready plan with \`claimed: true\`, dry-run on (\`PUBLISH_DRY_RUN\` unset, non-production).
Storage and graph are fakes, so no network call and no live account is touched. This
proves the full path executes and the final \`media_publish\` is skipped.

## Call sequence

\`\`\`
${calls.join("\n")}
\`\`\`

## Result

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

## Assertions

- final media_publish skipped: ${publishSkipped ? "yes (graph.publishReel never called)" : "NO - FAILURE"}
- terminal state: ${(result as { state?: string }).state}
- dryRun marker on the row: ${(result as { dryRun?: boolean }).dryRun}
- object cleaned up: ${calls.some((c) => c.startsWith("storage.delete")) ? "yes" : "no"}
`);

  if (!publishSkipped || (result as { state?: string }).state !== "published") {
    throw new Error("dry-run evidence assertion failed");
  }
}

async function graphAuthLive(): Promise<void> {
  const res = await checkGraphTokenAction();
  const status = (res as { status?: Record<string, unknown> }).status ?? null;
  // Only non-secret fields. The token is never in this object; do not add it.
  const safe = status
    ? {
        configured: status.configured,
        state: status.state,
        username: status.username,
        message: status.message,
        checkedAt: status.checkedAt,
      }
    : { error: (res as { error?: string }).error ?? "unknown" };

  write("graph-auth-live.md", `
# Live Graph auth check (own channel)

Runs the real \`checkGraphTokenAction\` (src/server/actions/graph-actions.ts), which
calls \`GET /me?fields=id,username\` on the Instagram Graph API with the
\`IG_GRAPH_TOKEN\` stored in the local secrets table. This is the same token the
publish path uses. Read-only; nothing is posted. The token itself is never read into
this file, only the returned status.

## Sanitized status

\`\`\`json
${JSON.stringify(safe, null, 2)}
\`\`\`

A \`state\` of \`ok\` with a \`username\` proves the stored token authenticates against
the real Graph API, so the publish path's auth precondition is satisfied on this
machine. The remaining live gap is the S3/R2 bucket (no S3 keys exist locally yet;
see 05-backlog and the PR body for the exact ask).
`);
}

async function main(): Promise<number> {
  try {
    await dryRunFake();
  } catch (err) {
    console.error("dry-run-fake failed:", err instanceof Error ? err.message : err);
    return 1;
  }
  try {
    await graphAuthLive();
  } catch (err) {
    console.error("graph-auth-live failed:", err instanceof Error ? err.message : err);
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code));
