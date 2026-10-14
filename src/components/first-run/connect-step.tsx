"use client";

/**
 * "Give Crowsnest a read key" — the first-run Instagram step (docs/product/v1-scope.md §2
 * AC 5–8, §4 decision 1). Reframed from the older "Connect your own account": the sign-in
 * is not a personal-benchmark signup, it is the *read key* the sidecar needs before it can
 * read any Instagram data at all. Nothing before this step told Kai the sidecar has to be
 * logged in, and every downstream step (choosing channels, the first sync) reads Instagram
 * through this one session — so the step now shows that dependency (03/04 render locked
 * until the key is live) instead of leaving the user to discover it at a failed sync.
 *
 * Primary path is a pasted session ID (`igLoginBySessionAction`): with instagrapi's
 * `login_by_sessionid` there is no 2FA or challenge to clear, so it connects straight
 * through. Username + password stays as a collapsible fallback (`igLoginWithCredentialsAction`
 * plus the unchanged `igChallengeChooseAction`/`igChallengeCodeAction`/`igTwoFactorAction`
 * machinery — that path *can* still hit a challenge). If the sidecar already has credentials
 * from `kai kit init`, a one-click connect with them (`igLoginAction`) is offered too.
 *
 * Wired directly to the same server actions Settings' Instagram section already uses — no
 * new action. A wrong challenge code (AC 6) stays on the same code field with an inline
 * error and keeps focus, rather than falling through to a generic error view.
 *
 * "Skip for now" (AC 8) always advances regardless of connection state — the app has to
 * stay usable disconnected, and every sync control elsewhere renders its own disconnected
 * state off `getIgStatusAction`, so nothing here needs to remember the skip. Skipping is
 * framed as "watch without syncing" because that is the true consequence: no read key means
 * no sync.
 *
 * Follower/post counts for the connected account are NOT shown: `getIgStatusAction` carries
 * no such fields (only `igClient.profile(handle)` does, called for watched channels, not the
 * logged-in account). Per the no-fabricated-data rule, this screen shows the one real fact
 * it has — the connected handle — and stops there.
 */

import { useRef, useState, type RefObject } from "react";
import { Check, ChevronRight, Eye, KeyRound, Lock, LockOpen, Monitor, Shield } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import {
  getIgStatusAction,
  igChallengeChooseAction,
  igChallengeCodeAction,
  igLoginAction,
  igLoginBySessionAction,
  igLoginWithCredentialsAction,
  igTwoFactorAction,
} from "@/server/actions/ig-actions";
import { setSecretAction } from "@/server/actions/secrets-actions";

type StatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;
type LoginResult = Awaited<ReturnType<typeof igLoginAction>>;
type Failure = Extract<LoginResult, { ok: false }>;

type Phase = "idle" | "connecting" | "two_factor" | "challenge_choice" | "challenge_code";

// A module-level component, not one declared inside ConnectStep: a component created
// during render remounts (and loses focus) on every parent re-render, which is exactly
// wrong for a code field whose whole job is to keep focus after an error (AC 6).
function CodeForm({
  kind,
  label,
  hint,
  code,
  setCode,
  busy,
  codeError,
  codeInputRef,
  onSubmit,
  onCancel,
}: {
  kind: "challenge" | "two_factor";
  label: string;
  hint: string;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  codeError: string | null;
  codeInputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (kind: "challenge" | "two_factor") => void;
  onCancel: () => void;
}) {
  return (
    <FieldGroup className="mt-11 max-w-[430px]">
      <Field>
        <FieldLabel htmlFor="ig-code">{label}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="w-[11rem]">
            <InputGroupInput
              id="ig-code"
              ref={codeInputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) onSubmit(kind);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="123456"
              className="font-mono"
              autoFocus
              aria-invalid={codeError !== null || undefined}
            />
          </InputGroup>
          <ButtonGroup>
            <Button size="sm" onClick={() => onSubmit(kind)} disabled={busy}>
              {busy ? "Submitting…" : "Submit"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </ButtonGroup>
        </div>
        <FieldDescription>{hint}</FieldDescription>
        {codeError && <FieldError>{codeError}</FieldError>}
      </Field>
    </FieldGroup>
  );
}

/** The two downstream steps both read Instagram through this session, so they can't run
 *  until the read key is live. Showing that here turns a silent dependency (a sync that
 *  cancels with no data) into a visible cause-and-effect. */
function DependencyStrip({ live }: { live: boolean }) {
  const rows = [
    { n: "03", label: "Choose channels" },
    { n: "04", label: "First sync" },
  ];
  const Icon = live ? LockOpen : Lock;
  return (
    <Card className="mt-8 max-w-[460px]">
      <CardContent>
        <ItemGroup>
          {rows.map((r) => (
            <Item key={r.n} size="sm">
              <ItemMedia>
                <Icon aria-hidden className={`size-4 flex-none ${live ? "text-success" : "text-muted-foreground"}`} />
              </ItemMedia>
              <ItemContent className="flex-row items-center gap-3.5">
                <span className="w-5 flex-none font-mono text-2xs tracking-wide text-muted-foreground">{r.n}</span>
                <ItemTitle className={`flex-1 font-normal ${live ? "text-foreground" : "text-muted-foreground"}`}>
                  {r.label}
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Badge variant="outline" className={live ? "text-success" : "text-muted-foreground"}>
                  {live ? "READY" : "NEEDS KEY"}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
      <CardFooter>
        <p className={`text-xs ${live ? "text-success" : "text-muted-foreground"}`}>
          {live
            ? "The read key is live — both steps can read Instagram now."
            : "Both steps read Instagram through the read key, so they stay locked until it’s connected."}
        </p>
      </CardFooter>
    </Card>
  );
}

const REASSURANCES = [
  { Icon: Eye, text: "Read-only, never posts" },
  { Icon: Monitor, text: "Runs on your machine" },
  { Icon: Shield, text: "Use a throwaway, not your main" },
];

export interface ConnectStepProps {
  initialStatus: StatusResult;
  serviceUrl: string;
  onBack: () => void;
  /** Carries the live status this screen ends on (not just whether it was pressed) so
   *  the sources step next door — which needs to know whether a typed handle can
   *  actually be checked against Instagram — doesn't have to re-derive it from a stale
   *  page-load snapshot. */
  onContinue: (status: StatusResult) => void;
}

export function ConnectStep({ initialStatus, serviceUrl, onBack, onContinue }: ConnectStepProps) {
  const [statusResult, setStatusResult] = useState<StatusResult>(initialStatus);
  const [phase, setPhase] = useState<Phase>("idle");
  const [loginFailure, setLoginFailure] = useState<Failure | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [sessionId, setSessionId] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  // Set only while a credentials-path login is mid-flow (2FA/challenge not yet resolved)
  // - tells submitCode/chooseChallengeChannel below whether a final "ok" should also
  // persist IG_USERNAME/IG_PASSWORD, since igLoginWithCredentialsAction only persists on
  // an *immediate* ok (see that action's own doc).
  const [credentialsPending, setCredentialsPending] = useState<{ username: string; password: string } | null>(null);
  const [credError, setCredError] = useState<string | null>(null);

  const status = statusResult.ok ? statusResult.status : null;

  async function refreshStatus(): Promise<StatusResult> {
    const next = await getIgStatusAction();
    setStatusResult(next);
    return next;
  }

  async function recheck() {
    setBusy(true);
    setLoginFailure(null);
    setSessionError(null);
    // Cancelling a mid-flow 2FA/challenge abandons any credentials-path attempt too, so
    // nothing stale is left for a later, unrelated login to silently persist.
    setCredentialsPending(null);
    setCredUsername("");
    setCredPassword("");
    setCredError(null);
    setPhase("idle");
    await refreshStatus();
    setBusy(false);
  }

  function afterLogin(result: LoginResult) {
    if (!result.ok) {
      setLoginFailure(result);
      setPhase("idle");
      return;
    }
    setLoginFailure(null);
    setCode("");
    setCodeError(null);
    if (result.status === "two_factor_required") setPhase("two_factor");
    else if (result.status === "challenge_required") setPhase("challenge_choice");
    else setPhase("idle");
  }

  // Primary path: paste a session ID. instagrapi's login_by_sessionid connects straight
  // through (no 2FA/challenge), so this either lands "ok" or fails — there is no code branch.
  async function connectBySession() {
    const sid = sessionId.trim();
    if (!sid) return;
    setSessionError(null);
    setLoginFailure(null);
    setPhase("connecting");
    const result = await igLoginBySessionAction(sid);
    if (!result.ok) {
      setSessionError(result.error);
      setPhase("idle");
      return;
    }
    setSessionId("");
    afterLogin(result);
    if (result.status === "ok") await refreshStatus();
  }

  // Convenience path: sidecar already has IG_USERNAME/IG_PASSWORD from `kai kit init`.
  async function connect() {
    setLoginFailure(null);
    setPhase("connecting");
    const result = await igLoginAction();
    afterLogin(result);
    if (result.ok && result.status === "ok") await refreshStatus();
  }

  async function connectWithCredentials() {
    const user = credUsername.trim();
    if (!user || !credPassword) return;
    setCredError(null);
    setLoginFailure(null);
    setPhase("connecting");
    const result = await igLoginWithCredentialsAction(user, credPassword);
    if (!result.ok) {
      // Surfaced through ig-credentials-error only - afterLogin's failure branch would
      // also set the generic loginFailure banner, rendering the same error twice.
      setCredError(result.error);
      setPhase("idle");
      return;
    }
    if (result.status === "ok") {
      await Promise.all([setSecretAction("IG_USERNAME", user), setSecretAction("IG_PASSWORD", credPassword)]);
      setCredUsername("");
      setCredPassword("");
      afterLogin(result);
      await refreshStatus();
      return;
    }
    setCredentialsPending({ username: user, password: credPassword });
    afterLogin(result);
  }

  async function chooseChallengeChannel(choice: "email" | "sms") {
    setBusy(true);
    const result = await igChallengeChooseAction(choice);
    setBusy(false);
    if (!result.ok) {
      setLoginFailure(result);
      setCredentialsPending(null);
      setPhase("idle");
      return;
    }
    if (result.status === "challenge_required") {
      setCode("");
      setCodeError(null);
      setPhase("challenge_code");
    } else {
      afterLogin(result);
      if (result.status === "ok") {
        if (credentialsPending) {
          await Promise.all([
            setSecretAction("IG_USERNAME", credentialsPending.username),
            setSecretAction("IG_PASSWORD", credentialsPending.password),
          ]);
          setCredentialsPending(null);
        }
        await refreshStatus();
      }
    }
  }

  async function submitCode(kind: "challenge" | "two_factor") {
    setBusy(true);
    setCodeError(null);
    const result = kind === "challenge" ? await igChallengeCodeAction(code) : await igTwoFactorAction(code);
    setBusy(false);
    if (!result.ok) {
      // Stays on this same code form (AC 6): a wrong code is not the same failure as the
      // sidecar being unreachable, and re-showing the field with its error, focused, is
      // what lets the user just try again.
      setCodeError(result.error);
      codeInputRef.current?.focus();
      return;
    }
    afterLogin(result);
    if (result.status === "ok") {
      if (credentialsPending) {
        await Promise.all([
          setSecretAction("IG_USERNAME", credentialsPending.username),
          setSecretAction("IG_PASSWORD", credentialsPending.password),
        ]);
        setCredentialsPending(null);
      }
      await refreshStatus();
    }
  }

  const serviceDown = !statusResult.ok && statusResult.code === "IG_SERVICE_DOWN";
  const credentialsConfigured = statusResult.ok && statusResult.status.credentialsConfigured;

  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-muted-foreground">02 · INSTAGRAM ACCESS</span>
      <h1 className="mt-4 text-xl leading-tight font-bold tracking-tight">Give Crowsnest a read key</h1>
      <p className="mt-5 max-w-[50ch] text-sm leading-relaxed text-muted-foreground text-balance">
        Crowsnest can&apos;t read Instagram on its own. Sign it in to a <span className="text-foreground">throwaway account</span>{" "}
        once — that sign-in becomes the read key every channel you watch and every sync uses.
      </p>

      {phase === "two_factor" && (
        <CodeForm
          kind="two_factor"
          label="6-digit code"
          hint="From your authenticator app or SMS."
          code={code}
          setCode={setCode}
          busy={busy}
          codeError={codeError}
          codeInputRef={codeInputRef}
          onSubmit={(kind) => void submitCode(kind)}
          onCancel={() => void recheck()}
        />
      )}

      {phase === "challenge_choice" && (
        <div className="mt-11 flex flex-col gap-4 max-w-[460px]">
          <p className="text-sm text-muted-foreground">Instagram issued a security challenge. Where should it send the code?</p>
          <ButtonGroup>
            <Button size="sm" onClick={() => void chooseChallengeChannel("email")} disabled={busy}>
              Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => void chooseChallengeChannel("sms")} disabled={busy}>
              SMS
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void recheck()} disabled={busy}>
              Cancel
            </Button>
          </ButtonGroup>
        </div>
      )}

      {phase === "challenge_code" && (
        <CodeForm
          kind="challenge"
          label="Verification code"
          hint="The code Instagram just sent to the channel you picked."
          code={code}
          setCode={setCode}
          busy={busy}
          codeError={codeError}
          codeInputRef={codeInputRef}
          onSubmit={(kind) => void submitCode(kind)}
          onCancel={() => void recheck()}
        />
      )}

      {phase === "connecting" && (
        <div className="mt-14 flex max-w-[460px] items-center gap-6">
          <span className="font-mono text-xs whitespace-nowrap">Reading the session</span>
          {/* Indeterminate on purpose: the sidecar reports no percentage while it reads
              the session, so a bar with a number on it would be invented. */}
          <Progress value={null} aria-label="Reading the session" className="flex-1" />
        </div>
      )}

      {phase === "idle" && status?.loggedIn && (
        <div className="mt-12">
          <span className="inline-flex items-center gap-2 font-mono text-2xs tracking-wide text-success">
            <Check aria-hidden className="size-3.5" /> READ KEY LIVE
          </span>
          <p className="mt-4 text-lg leading-tight">{status.username ? `@${status.username}` : "—"}</p>
          <p className="mt-1 font-mono text-2xs text-muted-foreground">read-only session · revoke anytime in Settings</p>
          <DependencyStrip live />
          <Button className="mt-10" onClick={() => onContinue(statusResult)}>
            Choose channels <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      )}

      {phase === "idle" && !status?.loggedIn && (
        <>
          {!serviceDown && (
            <>
              {/* Reassurance up front — the three things a buyer worries about when handing
                  over any Instagram sign-in, answered before the input. */}
              <div className="mt-7 flex flex-wrap gap-2">
                {REASSURANCES.map(({ Icon, text }) => (
                  <Badge key={text} variant="outline" className="text-muted-foreground">
                    <Icon aria-hidden />
                    {text}
                  </Badge>
                ))}
              </div>

              {/* Primary path: paste a session ID. */}
              <Card className="mt-6 max-w-[460px]">
                <CardHeader>
                  <span className="grid size-8 flex-none place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
                    <KeyRound aria-hidden className="size-4" />
                  </span>
                  <CardTitle>Paste a session ID</CardTitle>
                  <CardDescription>Recommended — connects straight away, no 2FA or login challenges.</CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="ig-session-id">Session ID</FieldLabel>
                      <Input
                        id="ig-session-id"
                        data-testid="ig-session-id-input"
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        placeholder="sessionid=IGSC%3A…"
                        autoComplete="off"
                        className="font-mono"
                        aria-invalid={sessionError !== null || undefined}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && sessionId.trim()) void connectBySession();
                        }}
                      />
                      {sessionError && <FieldError data-testid="ig-session-id-error">{sessionError}</FieldError>}
                    </Field>
                  </FieldGroup>

                  <Accordion className="mt-4">
                    <AccordionItem value="where">
                      <AccordionTrigger>Where do I get a session ID?</AccordionTrigger>
                      <AccordionContent className="leading-relaxed text-muted-foreground">
                        Sign in to your throwaway account in a browser, then open developer tools → Application → Cookies,
                        and copy the value of the <code>sessionid</code> cookie for instagram.com. Crowsnest stores it
                        locally and uses it read-only.
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
                <CardFooter>
                  <Button
                    data-testid="ig-session-id-submit-button"
                    onClick={() => void connectBySession()}
                    disabled={busy || !sessionId.trim()}
                  >
                    <KeyRound aria-hidden className="size-4" /> Get the read key
                  </Button>
                </CardFooter>
              </Card>

              {/* Convenience: sidecar already has credentials from `kai kit init`. */}
              {credentialsConfigured && (
                <div className="mt-4 max-w-[460px]">
                  <Button variant="outline" size="sm" onClick={() => void connect()} disabled={busy}>
                    Use the Instagram credentials from setup
                  </Button>
                </div>
              )}

              {/* Fallback: username + password (this path can still hit a challenge). */}
              <div className="mt-4 max-w-[460px]">
                <Button variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? "Hide password sign-in" : "Or sign in with a username and password"}
                </Button>
                {showPassword && (
                  <Card className="mt-3">
                    <CardHeader>
                      <CardDescription>Checked against a real login before anything is saved.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
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
                            aria-invalid={credError !== null || undefined}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && credUsername.trim() && credPassword) void connectWithCredentials();
                            }}
                          />
                        </Field>
                        {credError && <FieldError data-testid="ig-credentials-error">{credError}</FieldError>}
                      </FieldGroup>
                    </CardContent>
                    <CardFooter>
                      <Button
                        size="sm"
                        data-testid="ig-credentials-submit-button"
                        onClick={() => void connectWithCredentials()}
                        disabled={busy || !credUsername.trim() || !credPassword}
                      >
                        Connect
                      </Button>
                    </CardFooter>
                  </Card>
                )}
              </div>

              <DependencyStrip live={false} />
            </>
          )}

          {serviceDown && (
            <Alert variant="destructive" className="mt-8 max-w-[460px]">
              <AlertTitle>The local Instagram service isn&apos;t running.</AlertTitle>
              <AlertDescription>
                <p>
                  Nothing answered at <code>{serviceUrl}</code>. Start it in a second terminal, then Re-check:
                </p>
                <pre className="overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">npm run ig:service</pre>
              </AlertDescription>
            </Alert>
          )}

          {!serviceDown && loginFailure && (
            <p className="mt-8 max-w-[460px] text-sm text-destructive">{loginFailure.error}</p>
          )}

          <div className="mt-11 flex flex-wrap items-center gap-7">
            <ButtonGroup>
              <Button variant="outline" onClick={onBack}>
                ← Back
              </Button>
              {serviceDown && (
                <Button variant="outline" onClick={() => void recheck()} disabled={busy}>
                  Re-check
                </Button>
              )}
              <Button variant="ghost" onClick={() => onContinue(statusResult)}>
                Skip — watch without syncing
              </Button>
            </ButtonGroup>
          </div>
        </>
      )}
    </div>
  );
}
