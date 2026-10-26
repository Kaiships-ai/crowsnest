# v2 visual baseline

Every Lead Studio v2 screen, light and dark, at 1440x900, on a fixed seed and a stopped clock, so a later UI PR can diff its screens against the same pictures. Architecture: `documents/architecture/boards.md` (board kit, Gate 1), `documents/architecture/connectors.md` (Settings > Sources), `documents/architecture/app.md` (shell).

## Sub-features

- Shell: `ls-nav-row` (`data-nav-id`) under Search, the list titled Workspaces, no Tasks, Automations, Orca Mobile or workspace kanban.
- Today (B2-02) and Funnel (B2-03): every step in one of its five data states (`kpi-value` `data-state`).
- Plan month (B3-05): one-line chips and the tooltip with the full title and state.
- Gate 1 (B4-01, B4-02): change list against the live version, side-by-side diff with the edited line yellow (`.lead-diff-modified-line`), live count, approve, approver, undo.
- Settings > Sources (B1-01): grouped cards and the Connect dialog; Settings lists only the creator panes.

## Driving it

```bash
until mkdir ~/.claude/orchestrate/lead-studio-beta/locks/app-lane 2>/dev/null; do sleep 30; done
.claude/skills/verify/scripts/baseline-lane.sh             # write the approved baseline (Kai approves it once)
.claude/skills/verify/scripts/baseline-lane.sh --compare   # a UI PR: shoot to data/verify/baseline-new and diff
.claude/skills/verify/scripts/app-down.sh
rmdir ~/.claude/orchestrate/lead-studio-beta/locks/app-lane
```

`baseline-lane.sh` sets `LEAD_STUDIO_CLOCK_START=2026-10-27T10:30:00` with `LEAD_STUDIO_CLOCK_FROZEN=1`, so the app clock and every `nowIso` write stay at that instant; `LEAD_STUDIO_READ_JOBS=0`, so no pull, sync or measure rewrites the seed; and `IG_GRAPH_HOST` to `127.0.0.1:9`, so a stray Graph call fails on the Mac. It starts `fake-sidecar.mjs` (as `IG_SERVICE_URL`) and `fake-umami.mjs` as `boards-lane.sh` does. It runs `app-up.sh --seed` headless once, then `baseline-v2`, `today-01`, `funnel-01`, `own-01`, `plan-01`, `cook-01`, `rivals-01`, `agents-01`, `sources-01` and `umami-01` on that one app, so one command proves the v2 screens. With `--compare` it then runs `baseline-diff.mjs`, which fails a shot when more than 0.5% of its pixels differ from the approved one (`BASELINE_DIFF_MAX` changes the share). With a stopped clock the seed also writes today's 05:00 pull: `instagram-graph` failed after 3 attempts, `ig-sidecar` complete, the rest skipped. The journey stops the renderer clock at the same instant (`page.clock.setFixedTime`) and closes the right sidebar.

`baseline-v2` prints `ok: 1440x900, renderer clock stopped with the app's, right sidebar closed`, `ok: shell: Lead Studio rows replace Orca's nav, ...`, `ok: Today (B2-02): every Kpi names its state; Instagram's failed 05:00 pull is marked on views` (states `view:pull-failed, comment_keyword:not-connected, dm:value, gift_page_visit:partial, checkout:not-connected, purchase:no-data`; DMs match the lane DB), `ok: Funnel (B2-03): ...`, `ok: Plan month (B3-05): ...`, `ok: Gate 1 (B4-01): ...` (changes `mcp5:remove, hooks:edit, sale2:add, mcp3:add` against live v1; the count follows a switch), `ok: Gate 1 approve (B4-02): the kept changes go live as v3, approved by kai and journaled; Undo restores v1` (`plan_versions` and `agent_actions` read back from the lane DB), and `ok: Settings keeps only the creator panes; Sources (B1-01) looks like Orca's Integrations`.

It writes `<screen>-<light|dark>.png` to `~/.claude/orchestrate/lead-studio-v2/baseline/` (`BASELINE_DIR` overrides): `shell-sidebar`, `B2-02-today`, `B2-03-funnel`, `B3-05-plan-month`, `B3-05-plan-month-tooltip`, `B4-01-gate`, `B4-01-gate-switch-off`, `B4-02-gate-approved`, `B1-01-sources`, `B1-01-sources-connect-dialog`. Journeys add shots with `snapAndCompare`: `plan-01` shoots `B3-06-plan-week`, `B3-07-plan-day` and `B3-08-plan-card`, and `cook-01` shoots `B5-01-cook-workspace`; `UPDATE_BASELINE=1 baseline-lane.sh --compare` approves them once without rewriting `baseline-v2`'s shots. Nobody edits a baseline shot by hand.

## Gotchas

- The journey approves and undoes on the lane DB, so a rerun needs a fresh lane (`app-down.sh`, then `baseline-lane.sh`).
- A shot's dates come from the stopped clock and the machine's time zone; the reference run is Asia/Ho_Chi_Minh.
