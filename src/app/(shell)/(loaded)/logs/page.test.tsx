import { beforeEach, describe, expect, test, vi } from "vitest";

const queryLogEvents = vi.hoisted(() => vi.fn(() => []));
vi.mock("@/server/logs/store", () => ({ queryLogEvents }));

const { default: LogsPage } = await import("./page");

beforeEach(() => queryLogEvents.mockClear());

describe("logs page levels", () => {
  test.each([
    [{}, ["warn", "error"]],
    [{ levels: "info,warn,error" }, ["info", "warn", "error"]],
    [{ levels: "" }, []],
  ])("%j reads %j", async (sp, levels) => {
    await LogsPage({ searchParams: Promise.resolve(sp) });
    expect(queryLogEvents).toHaveBeenCalledWith(expect.objectContaining({ levels }));
  });
});
