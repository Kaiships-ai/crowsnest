# Multi-account sync

Crowsnest can track more than one Instagram account, each with its own login session,
cooldown clock, and proxy or device identity. This page describes what the v0.3 slice
ships, how to operate it, and the safety limits it deliberately keeps.

## Model

An account is a row in `ig_accounts` (see `src/server/db/schema.ts`). Each row carries its
own identity so accounts stay isolated from each other:

- `username`, `label`, and `isDefault`. Exactly one account is the default, enforced by a
  partial unique index.
- `sessionPath`, `proxy`, `deviceSeed`, `port`. The hooks that let an account run under its
  own session file, network route, device fingerprint, and sidecar port.
- `cooldownUntil` and `status` (active or paused). Per account, never shared.

The password is not stored on the row. It lives in the secrets table under
`IG_PASSWORD::<accountId>`, the same plaintext-local, never-returned-to-the-browser
handling as every other secret (`src/server/secrets/store.ts`).

Channels are assigned to an account stickily through `channels.accountId`
(`src/server/db/schema.ts`). Null means the default account. A channel always syncs under
the account it is pinned to, never another. Because the column is nullable and defaults to
null, every channel on a single-account install keeps syncing exactly as before.

## Scheduler

`planAccountSync` in `src/server/services/accounts.ts` is a pure function that takes the
channels to sync, the accounts, and the current time, and returns:

- `groups`: one runnable group per available account, each with its own channel ids.
- `skipped`: groups whose account is paused or inside a live cooldown, kept (not dropped)
  so the caller can report why.
- `unassignedChannelIds`: channels with no resolvable account (only possible when there is
  no default account).

The isolation guarantee the slice is built around: a cooldown or failure on one account
sets only that account's `cooldownUntil`, and the planner skips that account while every
other account's group still runs. One account cooling down never stops its siblings. This
is covered by unit tests in `src/server/services/accounts.test.ts` (grouping, cooldown
skip, paused skip, sticky assignment, deterministic order).

## Operating it

In Settings, open the Accounts section (under Connections):

- Add an account with a label and an Instagram username. The first account you add becomes
  the default. A password and a proxy are optional.
- Pause or resume an account. A paused account is skipped by the scheduler.
- Remove a non-default account. Its channels fall back to the default account.

Assign a channel to an account on the Channels screen (sticky assignment).

## Safety limits (read this)

- Within an account, sync stays serialized behind that account's own sidecar lock, exactly
  as the single-account path always has. This is the rate-limit safety the goal requires,
  and it is preserved, not weakened.
- Across accounts, v0.3 runs accounts one at a time with isolated per-account state. It
  does not yet run bounded-parallel live IG traffic across separate sidecars. Nothing in
  the product calls the current behavior parallel IG sync, because it is not.

## The next step, and why it is a separate step

True bounded-parallel-across-accounts sync means launching one live sidecar per account
(each on its own `port` with its own `sessionPath`, `proxy`, and `deviceSeed`) and routing
each account's channels to its own sidecar. The plumbing for that is already in place:
`accountChildEnv` in `src/server/services/accounts.ts` builds the isolated env for a
per-account sidecar, and the account row carries the port and session path.

What is missing is not code structure but verification. Running and proving real parallel
IG traffic across two or more accounts needs live per-account Instagram credentials, which
are the operator's to provide, and a live environment to watch for rate-limit behavior.
Shipping unverified sync-execution code that could mislabel or corrupt synced data would be
worse than the honest sequential-with-isolation behavior shipped here. So the live
multi-sidecar step is gated on those credentials and is intentionally not claimed as done.
