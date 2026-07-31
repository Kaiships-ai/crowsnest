"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleOff, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getIgStatusAction,
  igChallengeChooseAction,
  igChallengeCodeAction,
  igLoginAction,
  igLoginBySessionAction,
  igLogoutAction,
  igTwoFactorAction,
} from "@/server/actions/ig-actions";
import { SidecarControl } from "@/components/settings/sidecar-control";

type StatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;
type LoginResult = Awaited<ReturnType<typeof igLoginAction>>;
type Failure = Extract<LoginResult, { ok: false }>;

/**
 * Which form is on screen. Deliberately separate from the *status* the server reported:
 * `phase` is "what did the user just start", `statusResult` is "what is actually true
 * server-side". Collapsing the two is how a UI ends up claiming "Connected" because a
 * button was clicked.
 */
type Phase = "idle" | "connecting" | "two_factor" | "challenge_choice" | "challenge_code" | "error";

/** The eight states the section can be in. Every one of them is reachable and distinct. */
type ViewState =
  | "service_down"
  | "no_credentials"
  | "logged_out"
  | "connecting"
  | "two_factor_required"
  | "challenge_required"
  | "connected"
  | "error";

function viewStateOf(phase: Phase, statusResult: StatusResult, failure: Failure | null): ViewState {
  switch (phase) {
    case "connecting":
      return "connecting";
    case "two_factor":
      return "two_factor_required";
    case "challenge_choice":
    case "challenge_code":
      return "challenge_required";
    case "error":
      // A step that failed *because the sidecar died mid-flow* is still the service-down
      // problem, and deserves the "start it like this" instructions rather than a generic
      // error with a Retry button that cannot succeed.
      return failure?.code === "IG_SERVICE_DOWN" ? "service_down" : "error";
    case "idle":
      break;
  }
  if (!statusResult.ok) {
    // An unreachable sidecar is its own state — never folded into "not connected",
    // because the fix ("start the service") is nothing like "click Connect".
    return statusResult.code === "IG_SERVICE_DOWN" ? "service_down" : "error";
  }
  if (!statusResult.status.credentialsConfigured) return "no_credentials";
  if (!statusResult.status.loggedIn) return "logged_out";
  return "connected";
}

/**
 * Tone maps to icon shape first, color second. `warn` (logged out, no credentials,
 * a cooldown) is the normal, expected state for this product — see the module doc —
 * so it reads in plain ink, not an alert hue. Only `bad` (the sidecar is actually
 * unreachable or a step actually failed) gets the destructive red; `ok` gets the
 * positive tone; `busy` stays muted while it spins.
 */
function StatusRow({ tone, label, detail }: { tone: "ok" | "warn" | "bad" | "busy"; label: string; detail?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "busy" ? Loader2 : tone === "bad" ? CircleOff : AlertTriangle;
  const color =
    tone === "ok" ? "text-[var(--pos)]" : tone === "bad" ? "text-destructive" : tone === "busy" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`size-4 shrink-0 ${color} ${tone === "busy" ? "animate-spin" : ""}`} aria-hidden />
      <span className="font-medium">{label}</span>
      {detail && <span className="text-xs text-muted-foreground">({detail})</span>}
    </div>
  );
}

function CodeForm({
  id,
  label,
  hint,
  value,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) onSubmit();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          placeholder="123456"
          className="max-w-[10rem] font-mono"
        />
        <Button size="sm" variant="secondary" onClick={onSubmit} disabled={busy}>
          {busy ? "Submitting…" : "Submit"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The Instagram connection panel (design brief §3/§7). Data comes from the Python
 * instagrapi sidecar via `ig-actions.ts`; the initial status is fetched server-side by
 * the Settings page so this component needs no mount effect (this repo's eslint config
 * bans set-state-in-effect, and an effect here would also flash a wrong state first).
 *
 * Nothing on screen is inferred optimistically: after every step that could have changed
 * the session, the real `/health` is re-read and the panel re-renders from that.
 */
export function InstagramSection({ initialStatus, serviceUrl }: { initialStatus: StatusResult; serviceUrl: string }) {
  const [statusResult, setStatusResult] = useState<StatusResult>(initialStatus);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [sessionid, setSessionid] = useState("");

  const view = viewStateOf(phase, statusResult, failure);
  const status = statusResult.ok ? statusResult.status : null;
  // In the `error`/`service_down` views the message is whichever failed most recently: a
  // flow step if one did, otherwise the status read itself.
  const shownFailure: Failure | null = failure ?? (statusResult.ok ? null : statusResult);

  async function refreshStatus(): Promise<StatusResult> {
    const next = await getIgStatusAction();
    setStatusResult(next);
    return next;
  }

  function handleLoginResult(result: LoginResult) {
    if (!result.ok) {
      setFailure(result);
      setPhase("error");
      return;
    }
    setFailure(null);
    setCode("");
    if (result.status === "two_factor_required") setPhase("two_factor");
    else if (result.status === "challenge_required") setPhase("challenge_choice");
    else setPhase("idle");
  }

  async function connect() {
    setFailure(null);
    setPhase("connecting");
    const result = await igLoginAction();
    handleLoginResult(result);
    if (result.ok && result.status === "ok") await refreshStatus();
  }

  async function connectWithSession() {
    const value = sessionid.trim();
    if (!value) return;
    setFailure(null);
    setPhase("connecting");
    const result = await igLoginBySessionAction(value);
    handleLoginResult(result);
    if (result.ok) {
      setSessionid("");
      await refreshStatus();
    }
  }

  async function chooseChallengeChannel(choice: "email" | "sms") {
    setBusy(true);
    const result = await igChallengeChooseAction(choice);
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      setPhase("error");
      return;
    }
    // The sidecar answers `challenge_required` again once the code is on its way; any
    // other status means the challenge resolved without one.
    if (result.status === "challenge_required") {
      setCode("");
      setPhase("challenge_code");
    } else {
      handleLoginResult(result);
      if (result.status === "ok") await refreshStatus();
    }
  }

  async function submitCode(kind: "challenge" | "two_factor") {
    setBusy(true);
    const result = kind === "challenge" ? await igChallengeCodeAction(code) : await igTwoFactorAction(code);
    setBusy(false);
    handleLoginResult(result);
    if (result.ok && result.status === "ok") await refreshStatus();
  }

  async function disconnect() {
    setBusy(true);
    const result = await igLogoutAction();
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      setPhase("error");
      return;
    }
    setFailure(null);
    setPhase("idle");
    await refreshStatus();
  }

  async function recheck() {
    setBusy(true);
    setFailure(null);
    setPhase("idle");
    await refreshStatus();
    setBusy(false);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Instagram connection</h2>
          <p className="text-sm text-muted-foreground">
            Sync talks to a local Python <code>instagrapi</code> sidecar that holds the authenticated session.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={recheck} disabled={busy || phase === "connecting"}>
          <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden />
          Re-check
        </Button>
      </div>

      <SidecarControl health={statusResult} onHealthChange={refreshStatus} />

      {view !== "connected" && (
        <div className="flex flex-col gap-3 border border-border p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Sign in with a session token</h3>
            <Badge variant="secondary">Recommended</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Open <code>instagram.com</code> in a browser you&apos;re already signed into that account with, open DevTools, go to
            Application → Cookies, and copy the value of the <code>sessionid</code> cookie. This skips password login entirely, so it
            can&apos;t trip the failed-login count Instagram uses to checkpoint an account.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ig-sessionid">Session ID</Label>
            <div className="flex items-center gap-2">
              <Input
                id="ig-sessionid"
                type="password"
                value={sessionid}
                onChange={(e) => setSessionid(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy && phase !== "connecting") void connectWithSession();
                }}
                autoComplete="off"
                placeholder="paste the sessionid cookie value"
                className="max-w-sm font-mono"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void connectWithSession()}
                disabled={busy || phase === "connecting" || sessionid.trim().length === 0}
              >
                {phase === "connecting" ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border border-border p-4">
        {view === "service_down" && (
          <>
            <StatusRow tone="bad" label="Instagram service isn't running" detail={shownFailure?.error} />
            <p className="text-xs text-muted-foreground">
              Nothing answered at <code>{serviceUrl}</code> (<code>IG_SERVICE_URL</code>). Start the sidecar in a second terminal, then
              Re-check:
            </p>
            <pre className="overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">npm run ig:service</pre>
          </>
        )}

        {view === "no_credentials" && (
          <>
            <StatusRow tone="warn" label="No Instagram credentials configured" detail="service is running" />
            <p className="text-xs text-muted-foreground">
              Set <code>IG_USERNAME</code> and <code>IG_PASSWORD</code> in <code>.env.local</code> and restart the sidecar. They are read by
              the sidecar process only. This app never receives them, never renders them, and no form here submits a password.
            </p>
          </>
        )}

        {view === "logged_out" && (
          <>
            <StatusRow tone="warn" label="Not connected" detail="credentials configured, no active session" />
            <p className="text-xs text-muted-foreground">
              Connect signs in with the credentials already in the sidecar&apos;s environment. Instagram may answer with a two-factor prompt
              or a security challenge, and you&apos;ll finish that here.
            </p>
            <div>
              <Button size="sm" variant="secondary" onClick={connect}>
                Connect
              </Button>
            </div>
          </>
        )}

        {view === "connecting" && (
          <>
            <StatusRow tone="busy" label="Connecting…" detail="signing in via the sidecar" />
            <p className="text-xs text-muted-foreground">
              This can take up to two minutes. Instagram logins are deliberately rate-limited and the sidecar adds jitter.
            </p>
          </>
        )}

        {view === "two_factor_required" && (
          <>
            <StatusRow tone="warn" label="Two-factor code required" />
            <CodeForm
              id="ig-2fa-code"
              label="6-digit code"
              hint="From your authenticator app or the SMS Instagram just sent."
              value={code}
              busy={busy}
              onChange={setCode}
              onSubmit={() => void submitCode("two_factor")}
              onCancel={() => void recheck()}
            />
          </>
        )}

        {view === "challenge_required" && phase === "challenge_choice" && (
          <>
            <StatusRow tone="warn" label="Instagram issued a security challenge" detail="step 1 of 2" />
            <p className="text-xs text-muted-foreground">Choose where Instagram should send the verification code.</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void chooseChallengeChannel("email")} disabled={busy}>
                Email
              </Button>
              <Button size="sm" variant="outline" onClick={() => void chooseChallengeChannel("sms")} disabled={busy}>
                SMS
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void recheck()} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {view === "challenge_required" && phase === "challenge_code" && (
          <>
            <StatusRow tone="warn" label="Instagram issued a security challenge" detail="step 2 of 2" />
            <CodeForm
              id="ig-challenge-code"
              label="Verification code"
              hint="The code Instagram just sent to the channel you picked."
              value={code}
              busy={busy}
              onChange={setCode}
              onSubmit={() => void submitCode("challenge")}
              onCancel={() => void recheck()}
            />
          </>
        )}

        {view === "connected" && status && (
          <>
            <StatusRow tone="ok" label={status.username ? `Connected as @${status.username}` : "Connected"} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>instagrapi</dt>
              <dd className="font-mono">{status.instagrapiVersion ?? "not reported by the service"}</dd>
              <dt>Session file</dt>
              <dd>
                <Badge variant={status.sessionLoaded ? "secondary" : "outline"}>
                  {status.sessionLoaded ? "loaded from disk" : "not loaded (fresh login this run)"}
                </Badge>
              </dd>
              <dt>Service</dt>
              <dd className="font-mono">{serviceUrl}</dd>
              {status.cooldownUntil && (
                <>
                  <dt>Rate-limit cooldown</dt>
                  <dd className="font-mono">until {status.cooldownUntil}</dd>
                </>
              )}
            </dl>
            <div>
              <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>
                {busy ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          </>
        )}

        {view === "error" && shownFailure && (
          <>
            <StatusRow tone="bad" label={shownFailure.error} detail={shownFailure.code} />
            <p className="text-xs text-muted-foreground">
              {shownFailure.retryable
                ? "This one is worth retrying: it's a transient network, service or rate-limit condition."
                : shownFailure.needsUserAction
                  ? "Retrying as-is won't help: something has to change first (credentials, or a challenge Instagram wants resolved)."
                  : "Retrying as-is is unlikely to help. Check the sidecar's logs for the full error."}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void recheck()} disabled={busy}>
                Re-check status
              </Button>
              {shownFailure.retryable && (
                <Button size="sm" variant="secondary" onClick={() => void connect()} disabled={busy}>
                  Retry connect
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2 border border-border bg-card p-3">
        <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Risk: this uses Instagram&apos;s private API.</p>
          <p className="mt-1">
            <code>instagrapi</code> drives the same endpoints the mobile app uses. This violates Meta&apos;s Terms of Service. The account
            you connect can be challenged, restricted, or permanently banned, and there is no appeal path that acknowledges automated
            access. Use a burner account you can afford to lose, never your main one. Sync is rate-limited with jitter and pins one device
            profile to reduce the odds, but nothing here removes the risk.
          </p>
        </div>
      </div>
    </section>
  );
}
