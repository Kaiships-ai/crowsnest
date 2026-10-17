import { describe, expect, test } from "vitest";
import { INCIDENT_TABS, SETTINGS_TABS, SOURCES_TABS, activeTab } from "./section-tabs";

describe("activeTab", () => {
  test.each([
    [SOURCES_TABS, "/feed", "sources-tab-feed"],
    [SOURCES_TABS, "/feed/abc", "sources-tab-feed"],
    [SOURCES_TABS, "/channels", "sources-tab-channels"],
    [SOURCES_TABS, "/channels/abc", "sources-tab-channels"],
    [SOURCES_TABS, "/channels/discover", "sources-tab-discover"],
    [SETTINGS_TABS, "/settings", "settings-tab-config"],
    [SETTINGS_TABS, "/logs", "settings-tab-incidents"],
    [SETTINGS_TABS, "/runs/abc", "settings-tab-incidents"],
    [INCIDENT_TABS, "/runs/abc", "incidents-tab-runs"],
  ])("%#: %s marks %s", (tabs, path, id) => {
    expect(activeTab(tabs, path)?.testId).toBe(id);
  });

  test("a path outside every tab marks none, and a shared prefix is not a match", () => {
    expect(activeTab(SOURCES_TABS, "/settings")).toBeUndefined();
    expect(activeTab(SOURCES_TABS, "/feeder")).toBeUndefined();
  });
});
