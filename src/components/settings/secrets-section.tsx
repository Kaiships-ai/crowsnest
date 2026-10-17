"use client";

/**
 * Settings' secrets panel: one row per `MANAGED_SECRETS` entry (Task 1's db-backed
 * store), grouped LLM / Instagram sidecar / Graph. Replaces the old presence-only
 * `ApiKeyStatusCard` (Groq only) — this panel covers all seven secrets
 * and lets a value be set or cleared without touching `.env.local` or restarting.
 *
 * A secret value never round-trips back to the browser: the masked `<input
 * type="password">` is write-only, cleared right after a successful save, and every
 * action here returns `{ ok }` or a `SecretStatus[]` (configured/source only) — never a
 * value. See `src/server/actions/secrets-actions.ts` and `src/server/secrets/store.ts`.
 */

import { useState, useTransition } from "react";
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@/components/ui/item";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { clearSecretAction, getSecretStatusAction, regenerateServiceTokenAction, setSecretAction } from "@/server/actions/secrets-actions";
import type { ManagedSecret, SecretStatus } from "@/server/secrets/store";

type Group = "transcription" | "instagram" | "graph";

const GROUPS: { id: Group; title: string; description: string }[] = [
  { id: "transcription", title: "Transcription", description: "Used for transcription (Groq)." },
  {
    id: "instagram",
    title: "Instagram sidecar",
    description:
      "Shared with the local instagrapi sidecar. The service token authenticates requests between this app and the sidecar. Regenerating it invalidates the token a running sidecar is already using, so that sidecar has to be restarted.",
  },
  { id: "graph", title: "Graph API", description: "Powers My channel's own-account Insights (read-only, own account only)." },
];

const SECRET_META: Record<ManagedSecret, { label: string; group: Group }> = {
  GROQ_API_KEY: { label: "Groq API key", group: "transcription" },
  IG_SERVICE_TOKEN: { label: "Service token", group: "instagram" },
  IG_USERNAME: { label: "Username", group: "instagram" },
  IG_PASSWORD: { label: "Password", group: "instagram" },
  IG_SESSIONID: { label: "Session ID", group: "instagram" },
  IG_GRAPH_TOKEN: { label: "Graph token", group: "graph" },
  IG_GRAPH_USER_ID: { label: "Graph user ID", group: "graph" },
};

function testIdSlug(name: ManagedSecret): string {
  return name.toLowerCase().replace(/_/g, "-");
}

function sourceLabel(status: SecretStatus): string | null {
  if (status.source === "env") return "from .env.local";
  if (status.source === "db") return "set here";
  return null;
}

function SecretRow({ status, onChanged }: { status: SecretStatus; onChanged: (next: SecretStatus[]) => void }) {
  const meta = SECRET_META[status.name];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  // A typo in a masked field only ever shows up later as a connection failure — this
  // just flips the input between password and text so it can be read before saving.
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();
  // Set only by a regenerate that happened while the sidecar was answering — see
  // regenerate() below for why the check has to run before the token is replaced.
  const [sidecarStale, setSidecarStale] = useState(false);

  async function refresh() {
    onChanged(await getSecretStatusAction());
  }

  function save() {
    if (!value.trim()) {
      toast.error("Enter a value first.");
      return;
    }
    startTransition(async () => {
      const result = await setSecretAction(status.name, value);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setValue("");
      setEditing(false);
      setRevealed(false);
      toast.success(`${meta.label} saved.`);
      await refresh();
    });
  }

  function clear() {
    startTransition(async () => {
      const result = await clearSecretAction(status.name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${meta.label} cleared.`);
      await refresh();
    });
  }

  function regenerate() {
    startTransition(async () => {
      // Ask the sidecar whether it's up *before* the token changes. Afterwards the app
      // is sending a token the running process has never seen, so a health ping fails
      // and "not running" and "running with the old token" stop being distinguishable
      // — the second one is the whole reason this warning exists.
      const sidecarWasRunning = (await getIgStatusAction()).ok;
      const result = await regenerateServiceTokenAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Stays until the page is reloaded: nothing in this component ever learns that
      // the sidecar was restarted, so clearing it on a timer would only be a guess.
      setSidecarStale(sidecarWasRunning);
      toast.success(sidecarWasRunning ? "Service token regenerated. The running sidecar needs a restart." : "Service token regenerated.");
      await refresh();
    });
  }

  const isServiceToken = status.name === "IG_SERVICE_TOKEN";

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>
          {meta.label}
          <Badge data-testid={`secrets-${testIdSlug(status.name)}-badge`} variant={status.configured ? "secondary" : "outline"}>
            {status.configured ? "Configured" : "Not set"}
          </Badge>
        </ItemTitle>
        {status.configured && sourceLabel(status) && <ItemDescription>{sourceLabel(status)}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        {isServiceToken ? (
          <Button size="sm" variant="outline" onClick={regenerate} disabled={pending}>
            {pending ? "Regenerating…" : "Regenerate"}
          </Button>
        ) : (
          <>
            {!editing && (
              <Button size="sm" variant="outline" data-testid={`secrets-${testIdSlug(status.name)}-edit`} onClick={() => setEditing(true)}>
                {status.configured ? "Replace" : "Set"}
              </Button>
            )}
            {status.source === "db" && (
              <Button size="sm" variant="ghost" onClick={clear} disabled={pending}>
                Clear
              </Button>
            )}
          </>
        )}
      </ItemActions>

      {sidecarStale && (
        <ItemFooter>
          <Alert variant="destructive">
            <ShieldAlert aria-hidden />
            <AlertTitle>The running sidecar still has the old token.</AlertTitle>
            <AlertDescription>
              This app switched to the new one immediately, but the sidecar process read its token when it started and won&apos;t pick this
              up. Until it restarts, syncing fails with <code>IG_SERVICE_UNAUTHORIZED</code> and no channels come back. Restart it from{" "}
              <a href="#instagram">Instagram</a> with Stop, then Start.
            </AlertDescription>
          </Alert>
        </ItemFooter>
      )}

      {editing && !isServiceToken && (
        <ItemFooter className="justify-start">
          <InputGroup className="max-w-sm">
            <InputGroupInput
              type={revealed ? "text" : "password"}
              autoComplete="off"
              placeholder={`New ${meta.label} value`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) save();
              }}
              aria-label={`${meta.label} value`}
              data-testid={`secrets-${testIdSlug(status.name)}-input`}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => setRevealed((r) => !r)}
                aria-label={revealed ? `Hide ${meta.label} value` : `Show ${meta.label} value`}
                aria-pressed={revealed}
              >
                {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button size="sm" variant="secondary" data-testid={`secrets-${testIdSlug(status.name)}-save`} onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setValue("");
              setRevealed(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </ItemFooter>
      )}
    </Item>
  );
}

export function SecretsSection({ initialStatus }: { initialStatus: SecretStatus[] }) {
  const [statuses, setStatuses] = useState<SecretStatus[]>(initialStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys &amp; secrets</CardTitle>
        <CardDescription>
          Values set here are stored in the local database. For the Groq key this takes effect on the very next call, no app
          restart needed. A value from <code>.env.local</code> is used until something is set here. No value is ever shown once saved. The
          Instagram sidecar is the one exception: it reads its username, password, and service token once at startup, so a change here takes
          effect the next time the sidecar restarts, not immediately.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {GROUPS.map((group) => {
          const rows = statuses.filter((s) => SECRET_META[s.name].group === group.id);
          if (rows.length === 0) return null;
          return (
            // gap-3 rather than the FieldSet default: the legend, its description and the
            // rows are one group, and the stock 24px rhythm reads as three separate blocks.
            <FieldSet key={group.id} className="gap-3">
              <FieldLegend variant="label">{group.title}</FieldLegend>
              <FieldDescription>{group.description}</FieldDescription>
              <ItemGroup>
                {rows.map((status) => (
                  <SecretRow key={status.name} status={status} onChanged={setStatuses} />
                ))}
              </ItemGroup>
            </FieldSet>
          );
        })}
      </CardContent>
    </Card>
  );
}
