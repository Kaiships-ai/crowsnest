"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleOff, RefreshCw, ShieldAlert } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  getIgStatusAction,
  igChallengeChooseAction,
  igChallengeCodeAction,
  igLoginAction,
  igLoginBySessionAction,
  igLoginWithCredentialsAction,
  igLogoutAction,
  igTwoFactorAction,
} from "@/server/actions/ig-actions";
import { setSecretAction } from "@/server/actions/secrets-actions";
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

/** Phase for the separate username/password form below, mirroring `Phase` above but
 *  scoped to that flow (it has no "connecting"/"error" phase of its own - failures
 *  surface inline via `credError` instead). */
type CredPhase = "idle" | "submitting" | "two_factor" | "challenge_choice" | "challenge_code";

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

/** Exported narrowly for unit testing the phase/status -> view derivation directly. */
export function viewStateOf(phase: Phase, statusResult: StatusResult, failure: Failure | null): ViewState {
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
  // A live session wins regardless of whether username/password are also stored: a
  // sessionid-only login has `loggedIn: true` but `credentialsConfigured: false`, and
  // that is still a connected account, not "no credentials".
  if (statusResult.status.loggedIn) return "connected";
  if (!statusResult.status.credentialsConfigured) return "no_credentials";
  return "logged_out";
}

/**
 * Tone maps to icon shape first, color second. `warn` (logged out, no credentials,
 * a cooldown) is the normal, expected state for this product — see the module doc —
 * so it reads in plain ink, not an alert hue. Only `bad` (the sidecar is actually
 * unreachable or a step actually failed) gets the destructive red; `ok` gets the
 * positive tone; `busy` stays muted while it spins.
 */
function StatusRow({
  tone,
  label,
  detail,
  testId,
  action,
}: {
  tone: "ok" | "warn" | "bad" | "busy";
  label: string;
  detail?: string;
  testId?: string;
  /** The one control that acts on the state this row reports (Connect, Disconnect),
   *  right-aligned in the row itself. Rows whose next step is a whole form or a choice
   *  of channels leave this empty and render that below instead. */
  action?: ReactNode;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? CircleOff : AlertTriangle;
  const color =
    tone === "ok" ? "text-[var(--success)]" : tone === "bad" ? "text-destructive" : tone === "busy" ? "text-muted-foreground" : "text-foreground";
  return (
    <Item size="sm" data-testid={testId}>
      <ItemMedia variant="icon" className={color}>
        {tone === "busy" ? <Spinner /> : <Icon aria-hidden />}
      </ItemMedia>
      {/* The clamps are off on purpose: in the `error` view the label *is* the failure
          message and the detail is its code, and a truncated error is a useless error. */}
      <ItemContent>
        <ItemTitle className="line-clamp-none">{label}</ItemTitle>
        {detail && <ItemDescription className="line-clamp-none">{detail}</ItemDescription>}
      </ItemContent>
      {action && <ItemActions>{action}</ItemActions>}
    </Item>
  );
}

/** One row of the connected-session detail table, in the same shape the Sync section's
 *  read-only config table uses: a muted label column and a value column. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell className="w-[12rem] align-top text-muted-foreground">{label}</TableCell>
      <TableCell className="align-top">{children}</TableCell>
    </TableRow>
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
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {/* The input keeps its own width cap rather than stretching to the field: six
          digits in a field as wide as the card reads as a text area, not a code. */}
      <div className="flex flex-wrap items-center gap-2">
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
        <ButtonGroup>
          <Button size="sm" variant="secondary" onClick={onSubmit} disabled={busy}>
            {busy ? "Submitting…" : "Submit"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </ButtonGroup>
      </div>
      <FieldDescription>{hint}</FieldDescription>
    </Field>
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
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credPhase, setCredPhase] = useState<CredPhase>("idle");
  const [credCode, setCredCode] = useState("");
  const [credError, setCredError] = useState<string | null>(null);

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

  /** Persists the credentials this component already holds - called once a login that
   *  started via `igLoginWithCredentialsAction` reaches a real "ok", whether immediately
   *  or after a 2FA/challenge code, since that action itself only persists on an
   *  *immediate* ok (see its own doc). */
  async function finishCredLogin() {
    await Promise.all([setSecretAction("IG_USERNAME", credUsername), setSecretAction("IG_PASSWORD", credPassword)]);
    setCredPhase("idle");
    setCredUsername("");
    setCredPassword("");
    await refreshStatus();
  }

  function handleCredLoginResult(result: LoginResult) {
    if (!result.ok) {
      setCredError(result.error);
      setCredPhase("idle");
      return;
    }
    setCredError(null);
    setCredCode("");
    if (result.status === "two_factor_required") setCredPhase("two_factor");
    else if (result.status === "challenge_required") setCredPhase("challenge_choice");
  }

  async function submitCredLogin() {
    setCredError(null);
    setCredPhase("submitting");
    const result = await igLoginWithCredentialsAction(credUsername.trim(), credPassword);
    if (result.ok && result.status === "ok") {
      await finishCredLogin();
      return;
    }
    handleCredLoginResult(result);
  }

  async function chooseCredChallengeChannel(choice: "email" | "sms") {
    setBusy(true);
    const result = await igChallengeChooseAction(choice);
    setBusy(false);
    if (!result.ok) {
      setCredError(result.error);
      setCredPhase("idle");
      return;
    }
    if (result.status === "challenge_required") {
      setCredCode("");
      setCredPhase("challenge_code");
    } else if (result.status === "ok") {
      await finishCredLogin();
    } else {
      setCredPhase("idle");
    }
  }

  async function submitCredCode(kind: "challenge" | "two_factor") {
    setBusy(true);
    setCredError(null);
    const result = kind === "challenge" ? await igChallengeCodeAction(credCode) : await igTwoFactorAction(credCode);
    setBusy(false);
    if (!result.ok) {
      setCredError(result.error);
      return;
    }
    if (result.status === "ok") await finishCredLogin();
    else setCredPhase(result.status === "two_factor_required" ? "two_factor" : "challenge_choice");
  }

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Instagram connection</CardTitle>
          <CardDescription>
            Sync talks to a local Python <code>instagrapi</code> sidecar that holds the authenticated session.
          </CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" onClick={recheck} disabled={busy || phase === "connecting"}>
              <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden />
              Re-check
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <SidecarControl health={statusResult} onHealthChange={refreshStatus} />

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
                Set <code>IG_USERNAME</code> and <code>IG_PASSWORD</code> in <code>.env.local</code> and restart the sidecar. They are read
                by the sidecar process only. This app never receives them, never renders them, and no form here submits a password.
              </p>
            </>
          )}

          {view === "logged_out" && (
            <>
              <StatusRow
                tone="warn"
                label="Not connected"
                detail="credentials configured, no active session"
                action={
                  <Button size="sm" variant="secondary" onClick={connect}>
                    Connect
                  </Button>
                }
              />
              <p className="text-xs text-muted-foreground">
                Connect signs in with the credentials already in the sidecar&apos;s environment. Instagram may answer with a two-factor
                prompt or a security challenge, and you&apos;ll finish that here.
              </p>
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
              <ButtonGroup>
                <Button size="sm" variant="secondary" onClick={() => void chooseChallengeChannel("email")} disabled={busy}>
                  Email
                </Button>
                <Button size="sm" variant="outline" onClick={() => void chooseChallengeChannel("sms")} disabled={busy}>
                  SMS
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void recheck()} disabled={busy}>
                  Cancel
                </Button>
              </ButtonGroup>
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
              <StatusRow
                testId="ig-connection-status-badge"
                tone="ok"
                label={status.username ? `Connected as @${status.username}` : "Connected"}
                action={
                  <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </Button>
                }
              />
              <Table>
                <TableBody>
                  <DetailRow label="instagrapi">
                    <span className="font-mono">{status.instagrapiVersion ?? "not reported by the service"}</span>
                  </DetailRow>
                  <DetailRow label="Session file">
                    <Badge variant={status.sessionLoaded ? "secondary" : "outline"}>
                      {status.sessionLoaded ? "loaded from disk" : "not loaded (fresh login this run)"}
                    </Badge>
                  </DetailRow>
                  <DetailRow label="Service">
                    <span className="font-mono">{serviceUrl}</span>
                  </DetailRow>
                  {status.cooldownUntil && (
                    <DetailRow label="Rate-limit cooldown">
                      <span className="font-mono">until {status.cooldownUntil}</span>
                    </DetailRow>
                  )}
                </TableBody>
              </Table>
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
              <ButtonGroup>
                <Button size="sm" variant="outline" onClick={() => void recheck()} disabled={busy}>
                  Re-check status
                </Button>
                {shownFailure.retryable && (
                  <Button size="sm" variant="secondary" onClick={() => void connect()} disabled={busy}>
                    Retry connect
                  </Button>
                )}
              </ButtonGroup>
            </>
          )}
        </CardContent>
      </Card>

      {view !== "connected" && (
        <>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Sign in with a session token
                <Badge variant="secondary">Recommended</Badge>
              </CardTitle>
              <CardDescription>
                Open <code>instagram.com</code> in a browser you&apos;re already signed into that account with, open DevTools, go to
                Application → Cookies, and copy the value of the <code>sessionid</code> cookie. This skips password login entirely, so it
                can&apos;t trip the failed-login count Instagram uses to checkpoint an account.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ig-sessionid">Session ID</FieldLabel>
                  <InputGroup className="max-w-sm">
                    <InputGroupInput
                      id="ig-sessionid"
                      data-testid="ig-session-input"
                      type="password"
                      value={sessionid}
                      onChange={(e) => setSessionid(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !busy && phase !== "connecting") void connectWithSession();
                      }}
                      autoComplete="off"
                      placeholder="paste the sessionid cookie value"
                      className="font-mono"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        variant="secondary"
                        data-testid="ig-session-connect-button"
                        onClick={() => void connectWithSession()}
                        disabled={busy || phase === "connecting" || sessionid.trim().length === 0}
                      >
                        {phase === "connecting" ? "Connecting…" : "Connect"}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Sign in with a username and password</CardTitle>
              <CardDescription>
                Validated against a real sidecar login before anything is saved - a wrong password is never stored as configured.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col items-start gap-4">
              {credPhase === "idle" && (
                <>
                  <FieldGroup className="max-w-sm">
                    <Field>
                      <FieldLabel htmlFor="ig-credentials-username">Username</FieldLabel>
                      <Input
                        id="ig-credentials-username"
                        data-testid="ig-credentials-username-input"
                        value={credUsername}
                        onChange={(e) => setCredUsername(e.target.value)}
                        autoComplete="off"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ig-credentials-password">Password</FieldLabel>
                      <Input
                        id="ig-credentials-password"
                        data-testid="ig-credentials-password-input"
                        type="password"
                        value={credPassword}
                        onChange={(e) => setCredPassword(e.target.value)}
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && credUsername.trim() && credPassword) void submitCredLogin();
                        }}
                      />
                    </Field>
                  </FieldGroup>
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="ig-credentials-submit-button"
                    onClick={() => void submitCredLogin()}
                    disabled={!credUsername.trim() || !credPassword}
                  >
                    Connect
                  </Button>
                  {/* A login failure belongs to the pair, not to one input, so it sits
                      under the button that submitted them rather than under a field. */}
                  {credError && <FieldError data-testid="ig-credentials-error">{credError}</FieldError>}
                </>
              )}
              {credPhase === "submitting" && <StatusRow tone="busy" label="Signing in…" />}
              {credPhase === "two_factor" && (
                <CodeForm
                  id="ig-credentials-2fa-code"
                  label="6-digit code"
                  hint="From your authenticator app or SMS."
                  value={credCode}
                  busy={busy}
                  onChange={setCredCode}
                  onSubmit={() => void submitCredCode("two_factor")}
                  onCancel={() => setCredPhase("idle")}
                />
              )}
              {credPhase === "challenge_choice" && (
                <ButtonGroup>
                  <Button size="sm" variant="secondary" onClick={() => void chooseCredChallengeChannel("email")} disabled={busy}>
                    Email
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void chooseCredChallengeChannel("sms")} disabled={busy}>
                    SMS
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCredPhase("idle")} disabled={busy}>
                    Cancel
                  </Button>
                </ButtonGroup>
              )}
              {credPhase === "challenge_code" && (
                <CodeForm
                  id="ig-credentials-challenge-code"
                  label="Verification code"
                  hint="The code Instagram just sent to the channel you picked."
                  value={credCode}
                  busy={busy}
                  onChange={setCredCode}
                  onSubmit={() => void submitCredCode("challenge")}
                  onCancel={() => setCredPhase("idle")}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* One line, not an Alert: the warning that earns a panel is the long one inside
          the disclosure below, and stacking two destructive panels would flatten both. */}
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
        Use a throwaway Instagram account - connecting one risks it being restricted or banned.
      </p>

      <Accordion>
        <AccordionItem value="ig-throwaway-risk">
          <AccordionTrigger>Why a throwaway account, and what&apos;s safe</AccordionTrigger>
          <AccordionContent>
            <Alert variant="destructive">
              <ShieldAlert aria-hidden />
              <AlertTitle>Risk: this uses Instagram&apos;s private API.</AlertTitle>
              <AlertDescription>
                <p>
                  <code>instagrapi</code> drives the same endpoints the mobile app uses. This violates Meta&apos;s Terms of Service. The
                  account you connect can be challenged, restricted, or permanently banned, and there is no appeal path that acknowledges
                  automated access. Use a burner account you can afford to lose, never your main one. Sync is rate-limited with jitter and
                  pins one device profile to reduce the odds, but nothing here removes the risk.
                </p>
              </AlertDescription>
            </Alert>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
