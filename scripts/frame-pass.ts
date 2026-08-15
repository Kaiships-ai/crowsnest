/**
 * Frame-pass bridge CLI. The layout read (per beat: on-screen text, animation, demo
 * cursor, tool demo, text position, voice pace) is a vision task, and no vision-capable model is reachable in-app: the LLM
 * client has no image path and the 9router proxy relays no live vision model. So the
 * read is produced out of process, in a Claude Code terminal session that runs the
 * `/watch` skill over the video's frames, and this script is how that result gets back
 * into Crowsnest. Full workflow: docs/product/frame-pass-workflow.md.
 *
 * Subcommands:
 *   resolve <videoId>            print the local mp4 path to run /watch against
 *   write   <videoId> [flags]    persist a VideoLayout JSON as the video's layout
 *   fail    <videoId> --error M  record that a pass ran and produced no reading
 *
 * write flags:
 *   --layout <path|->            JSON file with the per-beat VideoLayout array ("-" = stdin)
 *   --frames-sampled N           how many frames /watch extracted
 *   --model <name>               vision model that read them (default: claude-code/watch)
 *
 * Point CROWSNEST_DB_PATH at a copy to rehearse without touching data/crowsnest.db.
 */
import { readFileSync } from "node:fs";
import { BEAT_LAYOUT_FIELDS } from "@/server/llm/schemas";
import {
  persistFramePass,
  recordFramePassFailure,
  resolveVideoFile,
  FramePassValidationError,
  FramePassNoVideoError,
} from "@/server/services/frame-pass";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readJson(source: string): unknown {
  const raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  return JSON.parse(raw);
}

async function main(): Promise<number> {
  const [cmd, videoId] = process.argv.slice(2);
  if (!cmd || !videoId) {
    console.error("usage: tsx scripts/frame-pass.ts <resolve|write|fail> <videoId> [flags]");
    return 2;
  }

  if (cmd === "resolve") {
    const r = await resolveVideoFile(videoId);
    if (!r.ok) {
      console.error(`no file: ${r.reason}`);
      return 1;
    }
    console.log(r.path);
    return 0;
  }

  if (cmd === "write") {
    const layoutSource = flag("--layout");
    if (!layoutSource) {
      console.error("write needs --layout <path|-> (a JSON array of per-beat VideoLayout rows)");
      return 2;
    }
    const framesSampled = Number(flag("--frames-sampled"));
    const frameModel = flag("--model") ?? "claude-code/watch";
    const layout = readJson(layoutSource);

    const stored = await persistFramePass({
      videoId,
      // persistFramePass validates the shape with VideoLayoutSchema, so a malformed JSON
      // is caught there rather than trusted here.
      layout: layout as never,
      framesSampled,
      frameModel,
    });
    const readCount = stored.reduce(
      (n, beat) => n + BEAT_LAYOUT_FIELDS.filter((k) => beat[k].value !== null).length,
      0
    );
    console.log(
      `wrote layout for ${videoId}: ${stored.length} beat rows, ${readCount} of ${stored.length * BEAT_LAYOUT_FIELDS.length} fields readable (${framesSampled} frames, ${frameModel})`
    );
    return 0;
  }

  if (cmd === "fail") {
    const error = flag("--error");
    if (!error) {
      console.error("fail needs --error <message>");
      return 2;
    }
    await recordFramePassFailure(videoId, error);
    console.log(`recorded frame-pass failure for ${videoId}: ${error}`);
    return 0;
  }

  console.error(`unknown command: ${cmd}`);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof FramePassValidationError || err instanceof FramePassNoVideoError) {
      console.error(err.message);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
