---
status: active
components: [app, server, verify, packaging]
backlog: none
owner: null
shipped: null
---

# Lead Studio v1 plan

> **For agentic workers:** run with `/poteto-mode` (Orchestrate). The way of work, risk tiers, and merge rules are in `.agents/playbooks/lead-studio-v1.md`. Every item below names its tier. Docs and small items merge as soon as their gate is green. Complex items get an owner, one independent review, and live lanes, and Kai merges them.

## Goal

Lead Studio v1 is the whole approved proposal (`data/handoff/ui-ux-refactor/lead-studio/proposal/`), shipped as one macOS Electron app that Kai sells through Polar. It includes P4 packaging. The beta loop in proposal chapter 8 (pull numbers, read insight, plan November, approve, cook one reel, publish and see the funnel) is the first milestone, not the end.

## Shape

```
NOW (after #186, #188)                      TARGET (v1)
crowsnest/                                  crowsnest/
├── studio/   Orca app (pnpm, node 24)       ├── src/main, src/renderer, src/preload   Orca, at the root
├── src/server/  engine, runs in the app     │   └── src/renderer/src/boards/          Lead Studio boards
├── src/app, src/components  old Next.js     ├── src/server/   engine (data, IG, MCP)
└── two toolchains (npm + pnpm)              └── one toolchain (pnpm, node 24)
```

PR-R moves the repo from NOW to TARGET.

## Scope census

Four read-only agents classified about 70 proposal items against the code on 2026-10-25.

| Area | Orca has it | Engine has the logic, board missing | New |
| --- | --- | --- | --- |
| Workspace and agents (13) | 11 | 0 | 2 to 3 |
| Vault, Data, Brain (17) | 0 | 8 | 9 |
| Insight boards (16) | 1 | 10 | 5 |
| Plan, Studio, packaging (about 24) | 3 | 14 | 7 |
| Total (about 70) | about 15 | about 32 | about 24 |

The new items cluster in five workstreams: external connectors, the data backbone, gates and the journal, boards with no engine behind them, and packaging. These decide the ship date. The "board missing" items are small and merge in batches.

## Workstreams

Items keep proposal ids (FR, NFR, DoD). Tier is `docs`, `small`, or `complex` per the playbook.

### W0. Foundation

| Item | Tier | Depends on |
| --- | --- | --- |
| PR-R: delete Next.js, move Orca to the root, one toolchain, drop the Instagram read guard, app opens `data/crowsnest.db` | complex | #188 |
| Verify maintenance after PR-R: app-only features, journeys `shell-01`, `media-01` | docs and small | PR-R |
| IPC bridge: generated `ipcMain` channels and a typed renderer client for every `src/server/actions` and `queries` export | complex | PR-R |
| Lead Studio menu and board tab kind, rename Orca strings in the UI, board states (loading, empty, error) | small | IPC bridge |

### W1. Data backbone (complex)

| Item | Proposal ids |
| --- | --- |
| Snapshot result type: a partial pull is never stored as success | DA-01, NFR-09, B1-07, G-06 |
| Metric ledger: each metric defined once, read by boards and MCP | DA-04, B2-01 |
| Connector registry (manifest plus adapter) and Keychain secrets through Orca's `SecretStore` | VA-01, VA-02 |
| Persist the hourly Graph budget; daily 05:00 pull with catch-up | VA-03, B1-06 |
| Canonical entities, starting with Contact, Order, Session, Checkout | DA-02 |
| Campaign key across reel, comment, DM, `/get`, checkout, order (with the website repo) | DA-03, B6-05 |

Coordinate with `documents/plans/2026-10-14-ig-sync-split-sync-engine.md`, which already splits `sync-engine.ts`.

### W2. Connectors (complex, external)

| Item | Proposal ids | Can be tested locally |
| --- | --- | --- |
| Umami (port `ksa_sync.py`) | B1-02, IN-07 | Partly |
| Polar orders and metadata | B1-03, IN-06 | No |
| ChatbotX contacts, keywords, DMs per person, error and backfill | B1-04, IN-05 | No, needs hermes-mac |
| Instagram own metrics through the registry | B1-01, IN-03 | Yes, read only |
| Discord, Lark, Drive, GitHub | LAYERS Vault row | Later in v1 |

### W3. Gates and journal (complex)

| Item | Proposal ids |
| --- | --- |
| Remove `crowsnest_approve_plan` and `crowsnest_undo_plan` from MCP; approve and undo are UI actions with an approver | B3-04, B4-02, G-05 |
| Gate levels on MCP tools (read, gate 1, gate 2) | BR-02 |
| Gate 2 for every outbound write: publish, DM, discount, ChatbotX flow, website deploy | VA-05, B6-01, B6-06 |
| Journal of agent actions | BR-04 |
| MCP token per agent | NFR-03 |

### W4. Boards (small, batched)

Each board is a renderer view over engine data through the IPC bridge. A batch merges together, then the post-merge smoke runs.

| Batch | Boards | Proposal ids |
| --- | --- | --- |
| B1 | Vault (sources, state, Sửa with inline secret entry, per-source errors), Agents | B1-01..07, VA-04 |
| B2 | Hôm nay, Phễu, Kênh tôi with Sau reel, Đối thủ with add-channel | B2-02..05, IN-01..04, IN-08, IN-10 |
| B3 | Kế hoạch month, week, day, reel card, empty-slot add | B3-02..11, PL-01..05 |
| B4 | Cổng 1 two-pane diff, approve once, undo, goal on Hôm nay | B4-01..03, PL-03 |
| B5 | Studio board (job.json progress, outputs, feedback), Cổng 2 | B5-02..07, B6-01 |
| B6 | Leads, Tiền, Web | IN-05, IN-06, IN-07 |
| B7 | ⌘K over boards, Hỏi with context pack | WS-08, WS-09, B2-06 |

Leads, Tiền, and the context pack have no engine behind them, so their engine parts are complex even when the board is small.

### W5. Cook a reel (complex)

| Item | Proposal ids |
| --- | --- |
| Nấu from a slot: write `workspace/scripts/<slug>.md`, open a Reel workspace, run `/make-reel` | B5-01, CO-01 |
| Read `films/<slug>/job.json` (studio-reel #20 writes it) and watch it | B5-02, CO-02 |
| Bundle a pinned studio-reel engine in the app | PK-01 |

### W6. Packaging P4 (complex)

| Item | Proposal ids | Needs from Kai |
| --- | --- | --- |
| Code signing and notarization | P4, PK-02 | Apple Developer ID |
| Auto-update and rollback that keep data | PK-02 | none |
| Signed licence checked against Polar | P4 | Polar product for Lead Studio |
| Third-party notices (Orca, Lemo, edge-tts) | PK-03, NFR-18 | none |
| Instagram and Anthropic terms review | P4 | Kai reads and decides |
| i18n string layer | NFR-16 | none |
| Eight journey e2e specs | NFR-14, G-04 | none |

## Order

```
W0 ──► W1 data backbone ──► W2 connectors ──────────────► M-beta ──► W6 packaging ──► v1
   ├─► W3 gates (parallel with W1)                          ▲
   └─► W4 boards, batch by batch as their data lands ───────┤
                                     W5 cook (after B3) ────┘
```

- W1 and W3 start together after W0. They touch different files.
- A W4 batch starts as soon as the engine data it shows exists. B1 and B2 can start right after the board tab kind lands, on the data that exists today.
- W6 starts last, but Kai's Apple Developer ID and the Polar product should exist before it.

## Milestones

- **M-beta.** Kai runs the six-step loop of proposal chapter 8 on real @kaiships.ai data, with a video, and every DoD id B1-01 to B6-06 and G-01 to G-08 maps to merged work.
- **v1.** Every FR and NFR in the proposal maps to merged work or to a backlog issue Kai accepted, and a clean Mac installs, updates, and rolls back Lead Studio without losing data.

## Kai's actions

| Action | Needed by |
| --- | --- |
| Merge complex PRs | Each complex item |
| Apple Developer ID | W6 |
| Polar product for Lead Studio | W6 licence |
| hermes-mac on during ChatbotX lanes | W2 ChatbotX |
| Read the Instagram and Anthropic terms review | W6 |
