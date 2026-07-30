"use client";

/**
 * "Connect your own account" — docs/product/v1-scope.md §2 AC 5–8, and the reason this
 * whole flow exists per §4 decision 1: nothing before this pass told Kai the sidecar has
 * to be running and logged in before anything else works.
 *
 * Wired directly to the same server actions Settings' Instagram section already uses
 * (`getIgStatusAction`, `igLoginAction`, `igChallengeChooseAction`, `igChallengeCodeAction`,
 * `igTwoFactorAction`) — no new action. This component is not a copy of that section's
 * UI, though: a wrong code here (AC 6) has to stay on the same code field with an inline
 * error and keep focus on it, rather than fall through to a generic "error" view the way
 * Settings' section does, which would lose the very field the user needs to retry.
 *
 * "Skip for now" (AC 8) always advances regardless of connection state — the app has to
 * stay usable disconnected, and every sync control elsewhere already renders its own
 * disconnected state off `getIgStatusAction`, so nothing here needs to remember the skip.
 *
 * Follower count / post count for the connected account are NOT shown: `getIgStatusAction`
 * (and the sidecar's `/login`, `/health` responses behind it) carry no such fields — only
 * `igClient.profile(handle)` does, which is called for channels being watched, not for the
 * logged-in account itself. Showing them here would need a new server action, which this
 * pass is not allowed to add (WAVE2-BRIEF.md). Per the no-fabricated-data rule, a
 * capability the app does not have does not appear in the interface — so this screen
 * shows the one real fact it has, the connected handle, and stops there.
 */

import { useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getIgStatusAction,
  igChallengeChooseAction,
  igChallengeCodeAction,
  igLoginAction,
  igTwoFactorAction,
} from "@/server/actions/ig-actions";

type StatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;
type LoginResult = Awaited<ReturnType<typeof igLoginAction>>;
type Failure = Extract<LoginResult, { ok: false }>;

type Phase = "idle" | "connecting" | "two_factor" | "challenge_choice" | "challenge_code";

const REQUIREMENTS = [
  "Reads your posts through the sidecar's session — nothing here ever sees or stores a password.",
  "Read-only. Nothing this app does writes to Instagram or posts on your behalf.",
  "Every channel you watch next is measured against this account's own numbers.",
];

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
    <div className="mt-11 flex max-w-[430px] flex-col gap-2.5">
      <Label htmlFor="ig-code">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
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
          className="max-w-[10rem] font-mono"
          autoFocus
        />
        <Button size="sm" onClick={() => onSubmit(kind)} disabled={busy}>
          {busy ? "Submitting…" : "Submit"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {codeError && <p className="text-sm text-destructive">{codeError}</p>}
    </div>
  );
}

export interface ConnectStepProps {
  initialStatus: StatusResult;
  serviceUrl: string;
  onBack: () => void;
  onContinue: () => void;
}

export function ConnectStep({ initialStatus, serviceUrl, onBack, onContinue }: ConnectStepProps) {
  const [statusResult, setStatusResult] = useState<StatusResult>(initialStatus);
  const [phase, setPhase] = useState<Phase>("idle");
  const [loginFailure, setLoginFailure] = useState<Failure | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const status = statusResult.ok ? statusResult.status : null;

  async function refreshStatus(): Promise<StatusResult> {
    const next = await getIgStatusAction();
    setStatusResult(next);
    return next;
  }

  async function recheck() {
    setBusy(true);
    setLoginFailure(null);
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

  async function connect() {
    setLoginFailure(null);
    setPhase("connecting");
    const result = await igLoginAction();
    afterLogin(result);
    if (result.ok && result.status === "ok") await refreshStatus();
  }

  async function chooseChallengeChannel(choice: "email" | "sms") {
    setBusy(true);
    const result = await igChallengeChooseAction(choice);
    setBusy(false);
    if (!result.ok) {
      setLoginFailure(result);
      setPhase("idle");
      return;
    }
    if (result.status === "challenge_required") {
      setCode("");
      setCodeError(null);
      setPhase("challenge_code");
    } else {
      afterLogin(result);
      if (result.status === "ok") await refreshStatus();
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
    if (result.status === "ok") await refreshStatus();
  }

  const serviceDown = !statusResult.ok && statusResult.code === "IG_SERVICE_DOWN";

  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-faint">02 · INSTAGRAM</span>
      <h1 className="mt-4 text-xl leading-tight font-bold tracking-tight">Connect your own account</h1>
      <p className="mt-5 max-w-[48ch] text-sm leading-relaxed text-muted-foreground text-balance">
        Crowsnest signs in through a local Instagram sidecar. Yours is connected first so every channel you watch can
        be measured against it.
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
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void chooseChallengeChannel("email")} disabled={busy}>
              Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => void chooseChallengeChannel("sms")} disabled={busy}>
              SMS
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void recheck()} disabled={busy}>
              Cancel
            </Button>
          </div>
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
          <span className="font-mono text-xs whitespace-nowrap">Authorising</span>
          <div className="h-px flex-1 animate-pulse bg-primary" />
        </div>
      )}

      {phase === "idle" && status?.loggedIn && (
        <div className="mt-14">
          <span className="font-mono text-2xs text-primary">CONNECTED</span>
          <p className="mt-4 text-lg">{status.username ? `@${status.username}` : "—"}</p>
          <Button className="mt-12" onClick={onContinue}>
            Choose channels
          </Button>
        </div>
      )}

      {phase === "idle" && !status?.loggedIn && (
        <>
          <div className="mt-11 flex flex-col gap-5">
            {REQUIREMENTS.map((text, i) => (
              <div key={text} className="flex items-baseline gap-4">
                <span className="w-6 flex-none font-mono text-2xs tracking-wide text-faint">{`0${i + 1}`}</span>
                <span className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{text}</span>
              </div>
            ))}
          </div>

          {serviceDown && (
            <div className="mt-8 max-w-[460px] border border-border p-4">
              <p className="text-sm text-destructive">The local Instagram service isn&apos;t running.</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Nothing answered at <code>{serviceUrl}</code>. Start it in a second terminal, then Re-check:
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">npm run ig:service</pre>
            </div>
          )}

          {!serviceDown && statusResult.ok && !statusResult.status.credentialsConfigured && (
            <p className="mt-8 max-w-[460px] text-sm text-destructive">
              The service is running but has no Instagram credentials configured. Set <code>IG_USERNAME</code> and{" "}
              <code>IG_PASSWORD</code> in the sidecar&apos;s environment and Re-check.
            </p>
          )}

          {!serviceDown && loginFailure && (
            <p className="mt-8 max-w-[460px] text-sm text-destructive">{loginFailure.error}</p>
          )}

          <div className="mt-11 flex flex-wrap items-center gap-7">
            <Button variant="outline" onClick={onBack}>
              ← Back
            </Button>
            {!serviceDown && (
              <Button onClick={() => void connect()} disabled={busy || (statusResult.ok && !statusResult.status.credentialsConfigured)}>
                Connect Instagram
              </Button>
            )}
            {serviceDown && (
              <Button variant="outline" onClick={() => void recheck()} disabled={busy}>
                Re-check
              </Button>
            )}
            <Button variant="ghost" onClick={onContinue}>
              Skip for now
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
