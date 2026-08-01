import { describe, expect, test } from "vitest";

import { viewStateOf } from "./instagram-section";

type StatusResult = Parameters<typeof viewStateOf>[1];
type Failure = NonNullable<Parameters<typeof viewStateOf>[2]>;
type OkStatus = Extract<StatusResult, { ok: true }>["status"];

function okStatus(overrides: Partial<OkStatus> = {}): StatusResult {
  return {
    ok: true,
    status: {
      loggedIn: false,
      credentialsConfigured: false,
      username: null,
      instagrapiVersion: null,
      sessionLoaded: false,
      cooldownUntil: null,
      ...overrides,
    },
  };
}

function serviceDownFailure(): Failure {
  return { ok: false, error: "Instagram service isn't running", code: "IG_SERVICE_DOWN", retryable: true, needsUserAction: false };
}

describe("viewStateOf", () => {
  test("a sessionid-only login (loggedIn true, credentialsConfigured false) is connected", () => {
    expect(viewStateOf("idle", okStatus({ loggedIn: true, credentialsConfigured: false }), null)).toBe("connected");
  });

  test("no session and no stored credentials is no_credentials", () => {
    expect(viewStateOf("idle", okStatus({ loggedIn: false, credentialsConfigured: false }), null)).toBe("no_credentials");
  });

  test("stored credentials but no live session is logged_out", () => {
    expect(viewStateOf("idle", okStatus({ loggedIn: false, credentialsConfigured: true }), null)).toBe("logged_out");
  });

  test("an unreachable sidecar is still service_down regardless of status", () => {
    expect(viewStateOf("idle", serviceDownFailure(), null)).toBe("service_down");
  });
});
