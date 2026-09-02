"use server";

import { igClient, type IgHealth, type IgLoginStatus } from "../ig/client";
import { IgError } from "../ig/errors";
import { log } from "../lib/logger";
import { setSecret } from "../secrets/store";

/**
 * Server actions backing the Settings page's Instagram section.
 *
 * Three rules this module exists to enforce:
 *
 *  1. **Nothing throws across the action boundary.** Every export returns a discriminated
 *     result. A thrown error in a server action reaches the browser as an opaque
 *     "An error occurred in the Server Components render", which is exactly the kind of
 *     unusable state this section is supposed to eliminate.
 *
 *  2. **No action accepts a password blind.** `igLoginAction()` takes *no arguments at
 *     all* - the sidecar logs in with `IG_USERNAME`/`IG_PASSWORD` from its own
 *     environment, and those values never enter this process, this response, or a log
 *     line. `igLoginWithCredentialsAction` below is the one deliberate exception: it
 *     exists specifically to validate a typed password against a real sidecar login
 *     before ever persisting it - the opposite of a blind write - see its own doc for
 *     why that's a different risk than an action that just accepted and stored
 *     `(username, password)`.
 *
 *  3. **"I don't know" is never reported as "logged out".** A sidecar that isn't running
 *     produces `IG_SERVICE_DOWN`, a distinct state the UI renders differently from a
 *     healthy-but-unauthenticated service.
 */

/** Codes this module can return that are *not* sidecar errors. */
const INVALID_INPUT = "IG_INVALID_INPUT";

interface Failure {
  ok: false;
  error: string;
  code: string;
  /** True when trying the same thing again could plausibly work (rate limit, network). */
  retryable: boolean;
  /** True when a human has to do something here before anything else can work. */
  needsUserAction: boolean;
}

interface IgStatus {
  loggedIn: boolean;
  /** `IG_USERNAME`/`IG_PASSWORD` are both set in the sidecar's environment. */
  credentialsConfigured: boolean;
  username: string | null;
  instagrapiVersion: string | null;
  sessionLoaded: boolean;
  /** Set while the sidecar is deliberately backing off after a rate limit. */
  cooldownUntil: string | null;
}

type StatusResult = { ok: true; status: IgStatus } | Failure;
type LoginResult = { ok: true; status: IgLoginStatus } | Failure;
type SimpleResult = { ok: true } | Failure;

function toFailure(err: unknown): Failure {
  if (err instanceof IgError) {
    return { ok: false, error: err.userMessage, code: err.code, retryable: err.retryable, needsUserAction: err.needsUserAction };
  }
  const message = err instanceof Error ? err.message : String(err);
  log.error("ig.action.unexpected", { error: message });
  return { ok: false, error: message, code: "IG_UNKNOWN", retryable: false, needsUserAction: false };
}

function invalidInput(message: string): Failure {
  return { ok: false, error: message, code: INVALID_INPUT, retryable: false, needsUserAction: true };
}

/**
 * Detects a health response that no longer matches the sidecar's contract.
 *
 * Why this cannot simply check the booleans: `igClient.health()` returns an
 * already-mapped `IgHealth`, and the mapper coerces with `bool(v) => v === true`. A
 * sidecar that stopped sending `logged_in` therefore arrives here as an ordinary
 * `false`, indistinguishable from a signed-out account — and that is the dangerous
 * direction, because Settings would tell the user to reconnect an account that is
 * connected fine. The `requireBool` guard that used to live here could never fire for
 * exactly that reason: it was checking a field the mapper had already made a boolean.
 *
 * Two fields survive that collapse, and `HealthResponse`
 * (services/ig/crowsnest_ig/models.py) makes both mandatory: `status` is `Literal["ok"]`
 * and `instagrapi_version` is a non-optional `str`. The mapper turns an absent one into
 * `"unknown"` / `null` rather than into a plausible `false`, so they are the honest
 * drift detectors available at this layer.
 *
 * What this does not catch: a response that keeps both of those and drops only
 * `logged_in`. Pydantic makes the sidecar incapable of sending that — the field is
 * required with no default — so the realistic drift, a whole-shape change, is covered.
 * Closing it completely means teaching `mapHealth` to tell absent from false, which
 * lives in client.ts.
 */
function assertHealthShape(health: IgHealth): void {
  const drifted = health.status !== "ok" ? "status" : health.instagrapiVersion === null ? "instagrapi_version" : null;
  if (drifted === null) return;
  throw new IgError("IG_DRIFT", `Instagram service health response no longer matches the expected shape (bad or missing "${drifted}").`, {
    detail: { field: drifted, status: health.status },
  });
}

/**
 * Sidecar health + whether credentials are configured.
 *
 * An unreachable sidecar comes back as `ok: false` with `IG_SERVICE_DOWN`, and a
 * drifted one as `IG_DRIFT` — both reported states the UI shows for what they are,
 * never as a signed-out account. Note that a failure carries no `status` object at all,
 * so there is no field for a UI path to misread as `loggedIn: false`.
 */
export async function getIgStatusAction(): Promise<StatusResult> {
  try {
    const health = await igClient.health();
    assertHealthShape(health);
    return {
      ok: true,
      status: {
        loggedIn: health.loggedIn,
        credentialsConfigured: health.canLogin,
        sessionLoaded: health.sessionLoaded,
        username: health.username,
        instagrapiVersion: health.instagrapiVersion,
        cooldownUntil: health.cooldownUntil,
      },
    };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Starts a login using the credentials configured in the *sidecar's* environment.
 *
 * Takes no arguments on purpose — see rule 2 in this file's header. The returned status
 * drives the next UI step: `ok` (done), `two_factor_required`, or `challenge_required`.
 */
export async function igLoginAction(): Promise<LoginResult> {
  try {
    log.info("ig.login.requested", {});
    const { status } = await igClient.login({});
    log.info("ig.login.result", { status });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Signs in by adopting a `sessionid` cookie copied from a browser that is already
 * logged into instagram.com, instead of a password login.
 *
 * This is the recommended connect path (design brief §3/§7): Instagram will sometimes
 * accept a password in a browser and still answer `IG_BAD_CREDENTIALS` to the private
 * API when it distrusts the IP or device, and a sessionid import performs no password
 * authentication, so it cannot add to the failed-login count that gets an account
 * checkpointed. The sessionid is persisted via the secrets store so it survives a
 * sidecar restart, mirroring `IG_USERNAME`/`IG_PASSWORD` for the fallback flow.
 *
 * Note the write order here: `IG_SESSIONID` is persisted *before* the sidecar call
 * resolves, so a rejected sessionid is still saved as if it worked. That's a deliberate,
 * narrower risk for a value that expires and gets replaced routinely, not a pattern to
 * copy - `igLoginWithCredentialsAction` below validates first and saves only on success,
 * for exactly that reason.
 */
export async function igLoginBySessionAction(sessionid: string): Promise<LoginResult> {
  try {
    setSecret("IG_SESSIONID", sessionid);
    log.info("ig.login_by_session.requested", {});
    const { status } = await igClient.loginBySession(sessionid);
    log.info("ig.login_by_session.result", { status });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Signs in with a typed username and password, validating against the sidecar BEFORE
 * persisting anything (03-feature-description.md section 5, ENH-1) - the opposite order
 * from `igLoginBySessionAction` above. `IG_USERNAME`/`IG_PASSWORD` are only written to
 * the secrets store when the sidecar's own `/login` reports `"ok"` for THIS call; a
 * rejected login changes nothing. A `two_factor_required`/`challenge_required` status is
 * returned as-is, unsaved - the login isn't finished, so there's nothing yet to persist.
 * The caller (Settings' Instagram section, `/first-run`'s connect step) finishes that
 * case through the existing, unmodified
 * `igChallengeChooseAction`/`igChallengeCodeAction`/`igTwoFactorAction` - the sidecar
 * already remembers the pending username/password from this call's own `/login` request
 * (`session.py`'s `_pending_credentials`) - and persists the credentials it already holds
 * once one of those reports `"ok"`.
 *
 * Reuses the sidecar's own rate-limit/cooldown (`IG_RATE_LIMITED`) rather than opening a
 * second, faster retry loop: this calls the exact same `/login` endpoint every other
 * login path in this file calls, so a fixed username submitted repeatedly hits the same
 * server-side cooldown `igLoginAction` already would.
 */
export async function igLoginWithCredentialsAction(username: string, password: string): Promise<LoginResult> {
  const user = username.trim();
  if (!user || !password) return invalidInput("Enter both a username and a password.");
  try {
    log.info("ig.login_with_credentials.requested", {});
    const { status } = await igClient.login({ username: user, password });
    log.info("ig.login_with_credentials.result", { status });
    if (status === "ok") {
      setSecret("IG_USERNAME", user);
      setSecret("IG_PASSWORD", password);
    }
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}

/** Challenge step A: tell Instagram where to send the code. */
export async function igChallengeChooseAction(choice: "email" | "sms"): Promise<LoginResult> {
  if (choice !== "email" && choice !== "sms") {
    return invalidInput("Choose either email or SMS.");
  }
  try {
    const { status } = await igClient.resolveChallenge({ choice });
    log.info("ig.challenge.choice", { choice, status });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}

/** Challenge step B: submit the code Instagram sent. */
export async function igChallengeCodeAction(code: string): Promise<LoginResult> {
  const trimmed = typeof code === "string" ? code.trim() : "";
  if (!/^\d{4,8}$/.test(trimmed)) {
    return invalidInput("Enter the numeric code Instagram sent (4–8 digits).");
  }
  try {
    const { status } = await igClient.resolveChallenge({ code: trimmed });
    log.info("ig.challenge.code", { status });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}

/** Submits a 6-digit two-factor code from the authenticator app or SMS. */
export async function igTwoFactorAction(code: string): Promise<LoginResult> {
  const trimmed = typeof code === "string" ? code.trim() : "";
  if (!/^\d{6}$/.test(trimmed)) {
    return invalidInput("Enter the 6-digit two-factor code.");
  }
  try {
    const { status } = await igClient.submitTwoFactor(trimmed);
    log.info("ig.two_factor.submitted", { status });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}

/** Drops the sidecar's authenticated session. Sync stops working until reconnected. */
export async function igLogoutAction(): Promise<SimpleResult> {
  try {
    await igClient.logout();
    log.info("ig.logout.done", {});
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}
