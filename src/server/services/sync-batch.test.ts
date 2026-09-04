import { describe, expect, test, vi } from "vitest";
import { insertVideoSnapshots, type VideoSnapshotInsert } from "./sync-batch";

function rows(n: number): VideoSnapshotInsert[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    videoId: `v${i}`,
    capturedAt: "2026-09-04T00:00:00.000Z",
    viewCount: i,
    likeCount: i,
    commentCount: i,
  }));
}

/** A stand-in for the drizzle db that records how insert().values() is called. */
function spyDb() {
  const values = vi.fn();
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as never, insert, values };
}

describe("insertVideoSnapshots", () => {
  test("writes N rows in a single insert().values([...]) call", () => {
    const { db, insert, values } = spyDb();
    insertVideoSnapshots(rows(30), db);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toHaveLength(30);
  });

  test("no-ops with no db round trip when the array is empty", () => {
    const { db, insert } = spyDb();
    expect(insertVideoSnapshots([], db)).toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });
});
