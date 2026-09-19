"use client";

/**
 * Minimal multi-account management (v0.3). Lists the Instagram accounts crowsnest syncs
 * under, and lets you add one, pause or resume it, or remove it. Each account has its own
 * session, cooldown, and proxy/device identity (see services/accounts.ts); channels are
 * assigned to an account on the Channels screen. Deliberately minimal, per the goal
 * ("minimal UI, polish later"). The header states the honest limit: sync runs accounts
 * sequentially with isolated per-account state today, not yet live-parallel.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addAccountAction,
  removeAccountAction,
  setAccountStatusAction,
} from "@/server/actions/account-actions";
import type { IgAccount } from "@/server/services/accounts";

function cooldownLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return null;
  const mins = Math.ceil(ms / 60000);
  return mins < 60 ? `cooldown ${mins}m` : `cooldown ${Math.ceil(mins / 60)}h`;
}

export function AccountsSection({ initialAccounts }: { initialAccounts: IgAccount[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [proxy, setProxy] = useState("");

  const canAdd = label.trim().length > 0 && username.trim().length > 0 && !pending;

  function add() {
    startTransition(async () => {
      const r = await addAccountAction({ label, username, password: password || undefined, proxy: proxy || undefined });
      if (r.ok) {
        toast.success(`Added ${r.account.label}`);
        setLabel("");
        setUsername("");
        setPassword("");
        setProxy("");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function toggle(a: IgAccount) {
    startTransition(async () => {
      const next = a.status === "active" ? "paused" : "active";
      const r = await setAccountStatusAction(a.id, next);
      if (r.ok) {
        toast.success(`${a.label} ${next === "paused" ? "paused" : "resumed"}`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function remove(a: IgAccount) {
    startTransition(async () => {
      await removeAccountAction(a.id);
      toast.success(`Removed ${a.label}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">Instagram accounts</h2>
        <p className="max-w-[64ch] text-xs text-muted-foreground">
          Each account syncs under its own session, cooldown, and proxy or device identity. Assign channels to an account
          on the Channels screen. Today sync runs accounts one at a time with isolated per-account state; a cooldown or
          failure on one account never stops the others.
        </p>
      </div>

      {initialAccounts.length > 0 ? (
        <div className="flex flex-col divide-y divide-border border border-border">
          {initialAccounts.map((a) => {
            const cd = cooldownLabel(a.cooldownUntil);
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-foreground">{a.label}</span>
                    {a.isDefault && (
                      <Badge variant="outline" className="rounded-none">
                        Default
                      </Badge>
                    )}
                    {a.status === "paused" && (
                      <Badge variant="secondary" className="rounded-none">
                        Paused
                      </Badge>
                    )}
                    {cd && (
                      <Badge variant="destructive" className="rounded-none">
                        {cd}
                      </Badge>
                    )}
                  </div>
                  <span className="truncate font-mono text-2xs text-muted-foreground">
                    @{a.username}
                    {a.proxy ? " · proxy set" : ""}
                  </span>
                </div>
                <Button variant="ghost" size="sm" className="rounded-none" disabled={pending} onClick={() => toggle(a)}>
                  {a.status === "active" ? "Pause" : "Resume"}
                </Button>
                {!a.isDefault && (
                  <Button variant="ghost" size="sm" className="rounded-none text-destructive" disabled={pending} onClick={() => remove(a)}>
                    Remove
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          No accounts yet. Add your first Instagram account below; it becomes the default that every channel syncs under
          until you assign channels to other accounts.
        </p>
      )}

      <div className="flex flex-col gap-3 border border-border p-4">
        <span data-lab className="font-mono text-2xs text-muted-foreground">
          Add an account
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input placeholder="Label (e.g. Burner A)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="IG username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input type="password" placeholder="IG password (optional)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input placeholder="Proxy URL (optional)" value={proxy} onChange={(e) => setProxy(e.target.value)} />
        </div>
        <div>
          <Button className="rounded-none" disabled={!canAdd} onClick={add}>
            {pending ? "Adding..." : "Add account"}
          </Button>
        </div>
      </div>
    </div>
  );
}
