import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractFrames, parseWatchReport, WatchExtractError } from "./watch-frames";

const REPORT = `
# watch: video report

- **Duration:** 00:19 (19.4s)
- **Frames:** 3 selected from 3 candidates (scene, full range, budget 19, cap 100)

## Frames

Frames live at: \`/tmp/w/frames\`

- \`/tmp/w/frames/frame_0001.jpg\` (t=00:00, reason=first-frame)
- \`/tmp/w/frames/frame_0002.jpg\` (t=00:03, reason=scene-change)
- \`/tmp/w/frames/frame_0003.jpg\` (t=01:07, reason=scene-change)

## Transcript

_No transcript available._
`;

describe("parseWatchReport", () => {
  test("reads path, seconds and reason from each frame line", () => {
    const frames = parseWatchReport(REPORT);
    expect(frames).toEqual([
      { path: "/tmp/w/frames/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" },
      { path: "/tmp/w/frames/frame_0002.jpg", timestampSeconds: 3, reason: "scene-change" },
      { path: "/tmp/w/frames/frame_0003.jpg", timestampSeconds: 67, reason: "scene-change" },
    ]);
  });

  test("returns an empty list when the report lists no frames", () => {
    expect(parseWatchReport("# watch: video report\n\n## Frames\n\n_No frames extracted._\n")).toEqual([]);
  });

  test("ignores the 'Frames live at' line, which is not a frame", () => {
    const frames = parseWatchReport(REPORT);
    expect(frames.every((f) => f.path.endsWith(".jpg"))).toBe(true);
  });
});

describe("extractFrames", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "watch-frames-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * Writes a python fixture that stands in for watch.py. `extractFrames` invokes
   * `python3 <scriptPath>`, so the fixture is a plain .py file: no shebang, no chmod.
   */
  function fixture(name: string, source: string): string {
    const p = path.join(dir, name);
    writeFileSync(p, source);
    return p;
  }

  const ONE_FRAME_REPORT = [
    "# watch: video report",
    "",
    "## Frames",
    "",
    "Frames live at: `/tmp/x/frames`",
    "",
    "- `/tmp/x/frames/frame_0001.jpg` (t=00:00, reason=first-frame)",
    "",
  ].join("\n");

  test("parses the frames the fixture's canned report prints", async () => {
    const script = fixture(
      "report_ok.py",
      `print(${JSON.stringify(ONE_FRAME_REPORT)})\n`
    );
    const frames = await extractFrames("/videos/in.mp4", "/tmp/x/frames", { scriptPath: script });
    expect(frames).toEqual([
      { path: "/tmp/x/frames/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" },
    ]);
  });

  test("invokes the script with --no-whisper, the video path, and --out-dir", async () => {
    const argvFile = path.join(dir, "argv-basic.json");
    const script = fixture(
      "argv_capture_basic.py",
      [
        "import sys, json",
        `with open(${JSON.stringify(argvFile)}, "w") as f:`,
        "    json.dump(sys.argv[1:], f)",
        `print(${JSON.stringify(ONE_FRAME_REPORT)})`,
        "",
      ].join("\n")
    );

    await extractFrames("/videos/in.mp4", "/tmp/out-dir", { scriptPath: script });

    const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
    expect(argv).toContain("--no-whisper");
    expect(argv).toContain("/videos/in.mp4");
    const outDirIdx = argv.indexOf("--out-dir");
    expect(outDirIdx).toBeGreaterThanOrEqual(0);
    expect(argv[outDirIdx + 1]).toBe("/tmp/out-dir");
  });

  test("passes --max-frames and the value when maxFrames is set", async () => {
    const argvFile = path.join(dir, "argv-maxframes.json");
    const script = fixture(
      "argv_capture_maxframes.py",
      [
        "import sys, json",
        `with open(${JSON.stringify(argvFile)}, "w") as f:`,
        "    json.dump(sys.argv[1:], f)",
        `print(${JSON.stringify(ONE_FRAME_REPORT)})`,
        "",
      ].join("\n")
    );

    await extractFrames("/videos/in.mp4", "/tmp/out-dir", { scriptPath: script, maxFrames: 5 });

    const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
    const idx = argv.indexOf("--max-frames");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1]).toBe("5");
  });

  test("maxFrames: 0 is falsy, so --max-frames is NOT passed (pinning current behavior, not endorsing it)", async () => {
    const argvFile = path.join(dir, "argv-maxframes-zero.json");
    const script = fixture(
      "argv_capture_maxframes_zero.py",
      [
        "import sys, json",
        `with open(${JSON.stringify(argvFile)}, "w") as f:`,
        "    json.dump(sys.argv[1:], f)",
        `print(${JSON.stringify(ONE_FRAME_REPORT)})`,
        "",
      ].join("\n")
    );

    // `if (opts.maxFrames)` in extractFrames treats 0 the same as "not provided": a
    // caller who explicitly asks for 0 frames silently gets the script's own default
    // instead. That may or may not be desired, but this test only pins today's
    // behavior; it does not endorse it.
    await extractFrames("/videos/in.mp4", "/tmp/out-dir", { scriptPath: script, maxFrames: 0 });

    const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
    expect(argv).not.toContain("--max-frames");
  });

  test("rejects with WatchExtractError carrying stderr when the script exits non-zero", async () => {
    const script = fixture(
      "fail_nonzero.py",
      ["import sys", 'sys.stderr.write("boom: unsupported codec\\n")', "sys.exit(1)", ""].join("\n")
    );

    await expect(extractFrames("/videos/in.mp4", "/tmp/out-dir", { scriptPath: script })).rejects.toThrow(
      WatchExtractError
    );
    await expect(extractFrames("/videos/in.mp4", "/tmp/out-dir", { scriptPath: script })).rejects.toThrow(
      /boom: unsupported codec/
    );
  });

  test("rejects with WatchExtractError when the report has no frame lines", async () => {
    const script = fixture(
      "no_frames.py",
      [
        "print('# watch: video report')",
        "print()",
        "print('## Frames')",
        "print()",
        "print('_No frames extracted._')",
        "",
      ].join("\n")
    );

    await expect(extractFrames("/videos/in.mp4", "/tmp/out-dir", { scriptPath: script })).rejects.toThrow(
      WatchExtractError
    );
  });

  test("stdin is ignored: a script that reads stdin hits EOF immediately instead of hanging", async () => {
    const script = fixture(
      "reads_stdin.py",
      [
        "import sys",
        "data = sys.stdin.read()",
        `print(${JSON.stringify(ONE_FRAME_REPORT)})`,
        "",
      ].join("\n")
    );

    // A short timeout: if stdin were inherited (or left open) instead of ignored, the
    // child would block on stdin.read() and this call would hang until the timeout
    // fired and rejected. With stdio: ["ignore", ...] the read hits EOF right away.
    const frames = await extractFrames("/videos/in.mp4", "/tmp/x/frames", {
      scriptPath: script,
      timeoutMs: 3000,
    });
    expect(frames).toHaveLength(1);
  });
});
