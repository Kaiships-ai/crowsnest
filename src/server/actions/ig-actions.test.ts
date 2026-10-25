import { beforeEach, describe, expect, test, vi } from "vitest";

// config.ts validates at module load and throws on a missing IG_SERVICE_TOKEN (that
// refuse-to-start behaviour is deliberate). vi.hoisted, not a plain statement: ESM import
// bindings are evaluated before top-level statements run, so a bare assignment here would
// land *after* config.ts had already thrown.
vi.hoisted(() => {
  process.env.IG_SERVICE_TOKEN = "test-token";
  process.env.IG_SERVICE_URL = "http://127.0.0.1:8765";
});

const sidecar = vi.hoisted(() => ({
  health: vi.fn(),
  login: vi.fn(),
  loginBySession: vi.fn(),
  resolveChallenge: vi.fn(),
  submitTwoFactor: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../ig/client", () => ({ igClient: sidecar }));

// igLoginBySessionAction persists the sessionid via the secrets store before calling the
// sidecar. That store writes to a real sqlite db, which this file otherwise never touches
// (every other action here is exercised purely through the mocked igClient) — mocking it
// keeps the test isolated to the action's own logic instead of depending on db state.
const secretsStore = vi.hoisted(() => ({ setSecret: vi.fn() }));
vi.mock("../secrets/store", () => secretsStore);

import {
  getIgStatusAction,
  igChallengeChooseAction,
  igChallengeCodeAction,
  igLoginAction,
  igLoginBySessionAction,
  igLoginWithCredentialsAction,
  igLogoutAction,
  igTwoFactorAction,
} from "./ig-actions";
import { IgError } from "../ig/errors";
import type { IgHealth } from "../ig/client";

/**
 * What `igClient.health()` actually resolves to: `mapHealth`'s output, not the sidecar's
 * wire body.
 *
 * The fixture here used to be the raw snake_case payload, and that is precisely what let
 * a dead drift check look thoroughly tested — the mock disagreed with the real client's
 * contract, so the tests exercised a code path production never reached.
 */
const HEALTH: IgHealth = {
  status: "ok",
  loggedIn: true,
  username: "burner.acct",
  instagrapiVersion: "2.1.2",
  sessionLoaded: true,
  canLogin: true,
  cooldownUntil: null,
};

/**
 * What a sidecar that stopped honouring `HealthResponse` looks like *after* `mapHealth`:
 * absent strings become `null` / `"unknown"`, and — the dangerous part — absent booleans
 * become an ordinary `false` that reads exactly like a signed-out account.
 */
const DRIFTED: IgHealth = {
  status: "unknown",
  loggedIn: false,
  username: null,
  instagrapiVersion: null,
  sessionLoaded: false,
  canLogin: false,
  cooldownUntil: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getIgStatusAction", () => {
  test("maps a conforming health response into the status the UI renders", async () => {
    sidecar.health.mockResolvedValue(HEALTH);

    const result = await getIgStatusAction();

    expect(result).toEqual({
      ok: true,
      status: {
        loggedIn: true,
        credentialsConfigured: true,
        username: "burner.acct",
        instagrapiVersion: "2.1.2",
        sessionLoaded: true,
        cooldownUntil: null,
      },
    });
  });

  test("carries a cooldown and a logged-out-but-configured account through unchanged", async () => {
    sidecar.health.mockResolvedValue({
      ...HEALTH,
      loggedIn: false,
      username: null,
      sessionLoaded: false,
      cooldownUntil: "2026-07-27T12:00:00Z",
    } satisfies IgHealth);

    const result = await getIgStatusAction();

    expect(result).toMatchObject({
      ok: true,
      status: { loggedIn: false, credentialsConfigured: true, username: null, cooldownUntil: "2026-07-27T12:00:00Z" },
    });
  });

  test("an unreachable sidecar is IG_SERVICE_DOWN, NOT a logged-out account", async () => {
    sidecar.health.mockRejectedValue(new IgError("IG_SERVICE_DOWN", "Instagram service is unreachable"));

    const result = await getIgStatusAction();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("IG_SERVICE_DOWN");
    expect(result.error).toBe("The Instagram service isn't running. Start it with `pnpm run ig:service`.");
    expect(result.retryable).toBe(true);
    // The distinguishing assertion: no `status` object at all, so no UI path can read
    // `loggedIn: false` off a service that never answered.
    expect(result).not.toHaveProperty("status");
  });

  test("credentials absent is its own state, distinct from logged out", async () => {
    sidecar.health.mockResolvedValue({ ...HEALTH, loggedIn: false, username: null, canLogin: false } satisfies IgHealth);

    const result = await getIgStatusAction();

    expect(result).toMatchObject({ ok: true, status: { loggedIn: false, credentialsConfigured: false } });
  });

  test("a drifted health response is IG_DRIFT, NOT a signed-out account", async () => {
    sidecar.health.mockResolvedValue(DRIFTED);

    const result = await getIgStatusAction();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("IG_DRIFT");
    // The assertion that matters. Every boolean on DRIFTED is `false`, so the old code
    // reported a perfectly plausible signed-out account and Settings told the user to
    // reconnect one that was connected fine. A failure carries no `status` object at
    // all, so no UI path can read `loggedIn: false` off a sidecar we no longer parse.
    expect(result).not.toHaveProperty("status");
  });

  test("a sidecar answering with an unexpected status is drift, even if every other field parses", async () => {
    sidecar.health.mockResolvedValue({ ...HEALTH, status: "degraded" } satisfies IgHealth);

    const result = await getIgStatusAction();

    expect(result).toMatchObject({ ok: false, code: "IG_DRIFT" });
  });

  test("a missing instagrapi_version is drift — the sidecar declares it mandatory", async () => {
    sidecar.health.mockResolvedValue({ ...HEALTH, instagrapiVersion: null } satisfies IgHealth);

    const result = await getIgStatusAction();

    expect(result).toMatchObject({ ok: false, code: "IG_DRIFT" });
  });

  test("never leaks a credential even if the sidecar were to echo one back", async () => {
    sidecar.health.mockResolvedValue({ ...HEALTH, password: "hunter2", ig_password: "hunter2" });

    const result = await getIgStatusAction();

    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  test("an unexpected non-IgError throw still returns a result instead of crossing the boundary", async () => {
    sidecar.health.mockRejectedValue(new TypeError("boom"));

    const result = await getIgStatusAction();

    expect(result).toMatchObject({ ok: false, code: "IG_UNKNOWN", error: "boom" });
  });
});

describe("igLoginAction", () => {
  test("takes no arguments and sends no credentials to the sidecar", async () => {
    sidecar.login.mockResolvedValue({ status: "ok" });

    const result = await igLoginAction();

    expect(result).toEqual({ ok: true, status: "ok" });
    expect(sidecar.login).toHaveBeenCalledWith({});
    // The action itself is the enforcement point: it cannot forward a password because
    // it cannot receive one. Server actions are public endpoints, so this matters.
    expect(igLoginAction.length).toBe(0);
  });

  test("surfaces two_factor_required and challenge_required as successful statuses", async () => {
    sidecar.login.mockResolvedValueOnce({ status: "two_factor_required" });
    expect(await igLoginAction()).toEqual({ ok: true, status: "two_factor_required" });

    sidecar.login.mockResolvedValueOnce({ status: "challenge_required" });
    expect(await igLoginAction()).toEqual({ ok: true, status: "challenge_required" });
  });

  test("bad credentials come back as a needs-user-action, non-retryable failure", async () => {
    sidecar.login.mockRejectedValue(new IgError("IG_BAD_CREDENTIALS", "rejected"));

    const result = await igLoginAction();

    expect(result).toEqual({
      ok: false,
      error: "Instagram rejected the saved credentials.",
      code: "IG_BAD_CREDENTIALS",
      retryable: false,
      needsUserAction: true,
    });
  });

  test("a rate limit is reported as retryable", async () => {
    sidecar.login.mockRejectedValue(new IgError("IG_RATE_LIMITED", "429"));

    const result = await igLoginAction();

    expect(result).toMatchObject({ ok: false, code: "IG_RATE_LIMITED", retryable: true });
  });
});

describe("igLoginBySessionAction", () => {
  test("stores the sessionid and calls the sidecar", async () => {
    sidecar.loginBySession.mockResolvedValue({ ...HEALTH, loggedIn: true, username: "kai" });

    const result = await igLoginBySessionAction("SESSIONID_VALUE");

    expect(result.ok).toBe(true);
    expect(secretsStore.setSecret).toHaveBeenCalledWith("IG_SESSIONID", "SESSIONID_VALUE");
    expect(sidecar.loginBySession).toHaveBeenCalledWith("SESSIONID_VALUE");
  });

  test("maps a sidecar error to a failure", async () => {
    sidecar.loginBySession.mockRejectedValue(new IgError("IG_AUTH_REQUIRED", "bad session"));

    const result = await igLoginBySessionAction("bad");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("IG_AUTH_REQUIRED");
  });
});

describe("challenge flow", () => {
  test("step A sends the chosen channel and reports the next status", async () => {
    sidecar.resolveChallenge.mockResolvedValue({ status: "challenge_required" });

    const result = await igChallengeChooseAction("sms");

    expect(sidecar.resolveChallenge).toHaveBeenCalledWith({ choice: "sms" });
    expect(result).toEqual({ ok: true, status: "challenge_required" });
  });

  test("step A rejects a choice that isn't email or sms without calling the sidecar", async () => {
    const result = await igChallengeChooseAction("carrier-pigeon" as "email");

    expect(result).toMatchObject({ ok: false, code: "IG_INVALID_INPUT" });
    expect(sidecar.resolveChallenge).not.toHaveBeenCalled();
  });

  test("step B submits a trimmed numeric code", async () => {
    sidecar.resolveChallenge.mockResolvedValue({ status: "ok" });

    const result = await igChallengeCodeAction("  123456 ");

    expect(sidecar.resolveChallenge).toHaveBeenCalledWith({ code: "123456" });
    expect(result).toEqual({ ok: true, status: "ok" });
  });

  test("step B rejects a non-numeric code locally", async () => {
    const result = await igChallengeCodeAction("abc123");

    expect(result).toMatchObject({ ok: false, code: "IG_INVALID_INPUT" });
    expect(sidecar.resolveChallenge).not.toHaveBeenCalled();
  });
});

describe("igTwoFactorAction", () => {
  test("submits a 6-digit code", async () => {
    sidecar.submitTwoFactor.mockResolvedValue({ status: "ok" });

    expect(await igTwoFactorAction("654321")).toEqual({ ok: true, status: "ok" });
    expect(sidecar.submitTwoFactor).toHaveBeenCalledWith("654321");
  });

  test.each(["", "12345", "1234567", "12 34 56", "abcdef"])("rejects %j locally", async (code) => {
    const result = await igTwoFactorAction(code);

    expect(result).toMatchObject({ ok: false, code: "IG_INVALID_INPUT" });
    expect(sidecar.submitTwoFactor).not.toHaveBeenCalled();
  });
});

describe("igLoginWithCredentialsAction", () => {
  test("validates first: a wrong password is rejected and nothing is saved", async () => {
    sidecar.login.mockRejectedValue(new IgError("IG_BAD_CREDENTIALS", "rejected"));

    const result = await igLoginWithCredentialsAction("burner.acct", "wrong-password");

    expect(result).toMatchObject({ ok: false, code: "IG_BAD_CREDENTIALS" });
    expect(sidecar.login).toHaveBeenCalledWith({ username: "burner.acct", password: "wrong-password" });
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });

  test("an immediate ok persists IG_USERNAME and IG_PASSWORD", async () => {
    sidecar.login.mockResolvedValue({ status: "ok" });

    const result = await igLoginWithCredentialsAction("burner.acct", "correct-password");

    expect(result).toEqual({ ok: true, status: "ok" });
    expect(secretsStore.setSecret).toHaveBeenCalledWith("IG_USERNAME", "burner.acct");
    expect(secretsStore.setSecret).toHaveBeenCalledWith("IG_PASSWORD", "correct-password");
  });

  test("two_factor_required is returned unsaved - the login isn't finished yet", async () => {
    sidecar.login.mockResolvedValue({ status: "two_factor_required" });

    const result = await igLoginWithCredentialsAction("burner.acct", "correct-password");

    expect(result).toEqual({ ok: true, status: "two_factor_required" });
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });

  test("rejects a blank username or password locally, without calling the sidecar", async () => {
    const result = await igLoginWithCredentialsAction("", "something");

    expect(result).toMatchObject({ ok: false, code: "IG_INVALID_INPUT" });
    expect(sidecar.login).not.toHaveBeenCalled();
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });

  test("rejects a whitespace-only password locally, without calling the sidecar", async () => {
    const result = await igLoginWithCredentialsAction("burner.acct", "   ");

    expect(result).toMatchObject({ ok: false, code: "IG_INVALID_INPUT" });
    expect(sidecar.login).not.toHaveBeenCalled();
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });

  test("a rate limit from the sidecar's own cooldown is reported as retryable, not swallowed", async () => {
    sidecar.login.mockRejectedValue(new IgError("IG_RATE_LIMITED", "429"));

    const result = await igLoginWithCredentialsAction("burner.acct", "correct-password");

    expect(result).toMatchObject({ ok: false, code: "IG_RATE_LIMITED", retryable: true });
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });
});

describe("igLogoutAction", () => {
  test("returns ok on success", async () => {
    sidecar.logout.mockResolvedValue({ status: "ok" });

    expect(await igLogoutAction()).toEqual({ ok: true });
  });

  test("a failing logout is reported, not swallowed", async () => {
    sidecar.logout.mockRejectedValue(new IgError("IG_SERVICE_DOWN", "down"));

    expect(await igLogoutAction()).toMatchObject({ ok: false, code: "IG_SERVICE_DOWN" });
  });
});
