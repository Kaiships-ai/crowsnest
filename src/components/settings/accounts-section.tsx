"use client";

/**
 * Minimal multi-account management (v0.3). Lists the Instagram accounts crowsnest syncs
 * under, and lets you add one, pause or resume it, or remove it. Each account has its own
 * session, cooldown, and proxy/device identity (see services/accounts.ts); channels are
 * assigned to an account on the Channels screen. Deliberately minimal, per the goal
 * ("minimal UI, polish later"). The header states the honest limit: sync runs accounts
 * sequentially with isolated per-account state today, not yet live-parallel.
 */

import { Users } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
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
      <Card>
        <CardHeader>
          <CardTitle>Instagram accounts</CardTitle>
          <CardDescription>
            Each account syncs under its own session, cooldown, and proxy or device identity. Assign channels to an account
            on the Channels screen. Today sync runs accounts one at a time with isolated per-account state; a cooldown or
            failure on one account never stops the others.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {initialAccounts.length > 0 ? (
            <ItemGroup>
              {initialAccounts.map((a) => {
                const cd = cooldownLabel(a.cooldownUntil);
                return (
                  <Item key={a.id} size="sm">
                    <ItemContent>
                      <ItemTitle>
                        {a.label}
                        {a.isDefault && <Badge variant="outline">Default</Badge>}
                        {a.status === "paused" && <Badge variant="secondary">Paused</Badge>}
                        {cd && <Badge variant="destructive">{cd}</Badge>}
                      </ItemTitle>
                      <ItemDescription>
                        @{a.username}
                        {a.proxy ? " · proxy set" : ""}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggle(a)}>
                        {a.status === "active" ? "Pause" : "Resume"}
                      </Button>
                      {!a.isDefault && (
                        <Button variant="destructive" size="sm" disabled={pending} onClick={() => remove(a)}>
                          Remove
                        </Button>
                      )}
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No accounts yet.</EmptyTitle>
                <EmptyDescription>
                  Add your first Instagram account below; it becomes the default that every channel syncs under until you
                  assign channels to other accounts.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add an account</CardTitle>
        </CardHeader>

        <CardContent>
          {/* The labels are visually hidden, not absent: every input already carries its
              wording in the placeholder, and a real `<label for>` is what actually names
              the control for a screen reader. Duplicating the text on screen would be new
              copy this form never had. */}
          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="account-label" className="sr-only">
                Label (e.g. Burner A)
              </FieldLabel>
              <Input
                id="account-label"
                placeholder="Label (e.g. Burner A)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-username" className="sr-only">
                IG username
              </FieldLabel>
              <Input
                id="account-username"
                placeholder="IG username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-password" className="sr-only">
                IG password (optional)
              </FieldLabel>
              <Input
                id="account-password"
                type="password"
                placeholder="IG password (optional)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-proxy" className="sr-only">
                Proxy URL (optional)
              </FieldLabel>
              <Input
                id="account-proxy"
                placeholder="Proxy URL (optional)"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
              />
            </Field>
          </FieldGroup>
        </CardContent>

        <CardFooter>
          <Button disabled={!canAdd} onClick={add}>
            {pending ? "Adding..." : "Add account"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
