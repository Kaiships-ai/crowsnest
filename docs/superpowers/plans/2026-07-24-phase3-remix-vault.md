# Crowsnest Phase 3 — Remix + Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Runs AFTER phases 2A+2B are merged (single builder, no parallel zones).

**Goal:** The AI half of the product: Claude-powered video analysis (hook/structure/why-it-worked), Vault (hook/style template library), Similar-outliers, the 5-stage Remix Studio, and Copy-as-Prompt export.

**Architecture:** All LLM access through one thin wrapper (`src/server/llm/`) so services inject a fake in tests — no live API calls in CI, ever. Structured outputs via the SDK's `parse()` + zod schemas (guaranteed-shape JSON, no hand-rolled JSON parsing). Services stay framework-free; server actions thin. UI per DESIGN.md §2.5 (v0.2 stepper) + §2.6 (Vault).

**Tech Stack:** `@anthropic-ai/sdk` (latest) · `zod` (already present via shadcn form deps) · existing Drizzle/queries layers.

## Global Constraints

- Model: `process.env.CLAUDE_MODEL ?? "claude-sonnet-5"` (spec §7 pins this default — Kai's cost decision; do not hardcode another model). Key: `ANTHROPIC_API_KEY` via zero-arg `new Anthropic()`.
- **Claude Sonnet 5 API rules (current, verified):** do NOT send `temperature`/`top_p`/`top_k` (400 on non-default values); do NOT send `thinking` config (adaptive is the default when omitted — leave it omitted); no assistant-message prefills (400); structured outputs via `output_config: { format: zodOutputFormat(Schema) }` with `client.messages.parse()` — the deprecated top-level `output_format` param must not appear.
- Error handling: typed SDK classes, most-specific-first (`Anthropic.AuthenticationError` → `RateLimitError` → `APIStatusError` → `APIConnectionError`); never string-match error messages. Missing key → feature-level `NoApiKeyError` surfaced as Alert (DESIGN.md §6), never a crash.
- Keyless mode: every page still renders; AI features show the key-missing Alert. Seeded demo data untouched.
- No live API calls in tests — services accept an injected `LlmClient`; tests pass fakes. One optional smoke script (`scripts/smoke-llm.ts`) may call live when key present; never wired into `npm test`.
- Shell PATH: `export PATH="/Users/kienbeovl/.local/bin:/opt/homebrew/bin:$PATH"` starts every bash block. Anti-stall: chunk long commands, `| tail -20` on installs/builds, one-line status between steps.
- Every task: `npm run build && npm test` green → commit (conventional + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- Terminology: user-visible surface is "Remix Studio"; stages Prompt → Research → Hook → Style → Script (DESIGN.md §2.5 v0.2 is authoritative for layout).

---

### Task 1: LLM wrapper + schemas

**Files:**
- Create: `src/server/llm/client.ts`, `src/server/llm/schemas.ts`, `src/server/llm/client.test.ts`
- Modify: `package.json` (`npm i @anthropic-ai/sdk`)

**Interfaces (produces — every later task consumes):**

```ts
// client.ts
export class NoApiKeyError extends Error {}
export interface LlmClient {
  generateText(opts: { system: string; user: string; maxTokens?: number }): Promise<string>;
  generateParsed<T>(opts: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T>;
}
export function getLlm(): LlmClient            // throws NoApiKeyError if !process.env.ANTHROPIC_API_KEY
export function hasLlmKey(): boolean
// implementation notes: lazy singleton `new Anthropic()`; model from CLAUDE_MODEL ?? "claude-sonnet-5";
// generateText → client.messages.create({model, max_tokens: opts.maxTokens ?? 2048, system, messages:[{role:"user",content:user}]})
//   then concat text blocks (narrow block.type === "text").
// generateParsed → client.messages.parse({..., output_config: { format: zodOutputFormat(schema) }})
//   return response.parsed_output; if null → throw LlmParseError (retry ONCE inside generateParsed, then throw).

// schemas.ts
export const VideoAnalysisSchema = z.object({
  hookType: z.string(),                        // e.g. "negative-warning", "curiosity-gap"
  structureSegments: z.array(z.object({ label: z.string(), startSec: z.number(), endSec: z.number(), note: z.string() })),
  formatTags: z.array(z.string()),
  styleTags: z.array(z.string()),
  whyItWorked: z.string(),
});
export const HookOptionsSchema = z.object({ hooks: z.array(z.string()).min(3).max(7) });
export const OutlineSchema = z.object({ beats: z.array(z.object({ label: z.string(), content: z.string(), targetSec: z.number() })) });
```

- [ ] **Step 1:** `npm i @anthropic-ai/sdk` (chunked call, `| tail -5`). Import check: `zodOutputFormat` comes from `@anthropic-ai/sdk/helpers/zod`.
- [ ] **Step 2:** Failing tests: `getLlm()` throws `NoApiKeyError` when env key absent; `generateText` concatenates only text blocks (fake Anthropic instance injected via a test-only constructor seam `_createLlm(client)` — export it); `generateParsed` retries once on null `parsed_output` then throws `LlmParseError`; model resolution honors `CLAUDE_MODEL`.
- [ ] **Step 3:** Implement → PASS → commit: `feat(llm): claude client wrapper with structured-output helper`.

### Task 2: Analyze service + Video Detail wiring

**Files:**
- Create: `src/server/services/analyze.ts`, `src/server/services/analyze.test.ts`, `src/server/services/prompts/analyze-prompt.ts`, `src/server/actions/analyze-actions.ts`
- Modify: `src/app/(shell)/feed/[videoId]/page.tsx` + video-detail components (enable the two placeholder tabs)

**Interfaces:**
```ts
export async function getOrCreateAnalysis(videoId: string, llm?: LlmClient): Promise<VideoAnalysis | null>
// null = no transcript available yet (analysis requires transcript text; caption-only is not enough)
export async function analyzeVideoAction(videoId: string): Promise<{ ok: true } | { ok: false; error: string }>
```
- [ ] **Step 1:** `analyze-prompt.ts`: exported `ANALYZE_SYSTEM` (role: short-form video strategist; instructs analysis of hook/structure/format/style/why-it-worked grounded ONLY in given transcript+metrics, timestamps within duration) + `buildAnalyzeUser(video, transcript)` (caption, duration, views, multiplier, full transcript text). Keep prompts in this file — versioned, editable.
- [ ] **Step 2:** Failing tests (fake llm): cache hit returns existing row without llm call (spy count 0); cache miss calls `generateParsed` with VideoAnalysisSchema and upserts `video_analyses` (model column = resolved model string); no transcript → returns null, no llm call; llm throw propagates as typed error.
- [ ] **Step 3:** Implement service + thin action (try/catch → `{ok:false,error}`; `NoApiKeyError` → friendly "Add ANTHROPIC_API_KEY in Settings to enable analysis").
- [ ] **Step 4:** Wire Video Detail: Hook & Structure tab renders `structureSegments` as a labeled timeline list (Hook 0–3s etc, per DESIGN.md §2.4) + format/style tag Badges; Why-it-worked tab renders text; when `!hasAnalysis`: primary "Analyze this video" button (calls action, refreshes) or key-missing Alert. Transcript-missing state: quiet copy "Transcript needed first — import/sync provides it".
- [ ] **Step 5:** Gate → commit: `feat(analyze): claude video analysis with cached structured output`.

### Task 3: Similar service

**Files:**
- Create: `src/server/services/similar.ts`, `src/server/services/similar.test.ts`
- Modify: Video Detail (Similar section), `src/server/queries/video.ts` (expose analysis tags on `VideoDetail`)

**Interfaces:**
```ts
export function scoreSimilarity(a: TagSet, b: TagSet): number   // hookType match=3, each shared structure label=1, each shared format/style tag=1
export async function getSimilarOutliers(videoId: string, limit?: number): Promise<FeedItem[]>  // only videos WITH analyses, sorted by score desc then outlierScore desc, excludes self
```
- [ ] **Step 1:** TDD `scoreSimilarity` (exact weights above; empty overlap → 0) + `getSimilarOutliers` on in-memory DB with hand-inserted analyses (3 videos, known overlaps → deterministic order).
- [ ] **Step 2:** Video Detail: "Similar outliers" section under tabs — compact OutlierCard row; empty state "Analyze more videos to see patterns" when <1 result.
- [ ] **Step 3:** Gate → commit: `feat(similar): tag-overlap outlier recommendations`.

### Task 4: Vault

**Files:**
- Create: `src/server/queries/vault.ts` (+ test), `src/server/actions/vault-actions.ts`, `src/components/vault/template-card.tsx`, `src/components/vault/save-to-vault-dialog.tsx`, `src/components/vault/new-template-dialog.tsx`
- Modify: `src/app/(shell)/vault/page.tsx`, Video Detail (Save to Vault enabled), Channel Detail ("Vaulted" tab wired)

**Interfaces:**
```ts
// queries/vault.ts
export async function getVaultItems(type?: "hook" | "style"): Promise<VaultItemRow[]>   // VaultItemRow = row + sourceVideo chip data
export async function getScripts(): Promise<ScriptRow[]>
// actions
export async function createVaultItemAction(input: { type: "hook"|"style"; title: string; templateText: string; tags: string[]; sourceVideoId?: string }): Promise<ActionResult>
export async function deleteVaultItemAction(id: string): Promise<ActionResult>
```
- [ ] **Step 1:** Queries + tests (seeded: 6 items, filter by type, source chip join; scripts list).
- [ ] **Step 2:** Vault page per DESIGN.md §2.6 v0.2: Tabs Hooks/Styles/Scripts; template cards (title, templateText with `{topic}` slots rendered as Badge-styled inline chips, tags, source-video chip → detail, "Use in Remix" → `/feed/[sourceVideoId]/remix?hook=<id>` or `?style=<id>`; no source → ⌘K hint toast), New-template Dialog, delete via overflow + confirm.
- [ ] **Step 3:** Save-to-Vault dialog on Video Detail (enabled when analysis exists): choice Hook/Style/Both, prefilled from analysis (hook: hookType + first segment note → editable template with `{topic}` slot suggestion; style: structure labels + styleTags summary), editable before save.
- [ ] **Step 4:** Channel Detail "Vaulted" tab: videos having ≥1 vault item (template-count chip per DESIGN.md §2.3 v0.2).
- [ ] **Step 5:** Gate → commit: `feat(vault): template library with save-from-analysis flow`.

### Task 5: Remix engine

**Files:**
- Create: `src/server/services/remix.ts`, `src/server/services/remix.test.ts`, `src/server/services/prompts/remix-prompts.ts`, `src/server/actions/remix-actions.ts`

**Interfaces:**
```ts
export async function getOrCreateSession(videoId: string): Promise<RemixSessionRow>       // latest non-final or new
export async function updateStage(id: string, patch: Partial<StagePatch>): Promise<void>  // topic/niche/targetLengthSec/chosenHook/styleVaultItemId/stage — persists on every stage move
export async function buildResearch(id: string): Promise<ResearchNotes>                   // NO llm: source analysis + transcript excerpt + top-5 similar (title/caption/multiplier) + empty facts box; stored to researchNotes
export async function generateHooks(id: string, opts?: { vaultItemId?: string; llm?: LlmClient }): Promise<string[]>          // 1 call, HookOptionsSchema, 5 hooks; template from vault item else source hookType; persists hookOptions
export async function generateOutline(id: string, opts?: { llm?: LlmClient }): Promise<Outline>                                // OutlineSchema; style = vault style item else source structureSegments; persists outline
export async function generateVariants(id: string, opts?: { count?: number; llm?: LlmClient }): Promise<(string | { error: string })[]>  // default 3, Promise.allSettled — per-variant isolation; persists successes in variants[]
export async function saveScript(id: string, content: string, title: string): Promise<{ scriptId: string }>
export async function quickRemix(id: string, llm?: LlmClient): Promise<void>              // research → hooks (auto-pick first) → outline → variants, sequential
```
- [ ] **Step 1:** `remix-prompts.ts`: `HOOK_SYSTEM` (write 5 scroll-stopping hooks ≤15 words for topic X in niche Y, mirroring given hook pattern; no hashtags/emojis unless pattern has them), `OUTLINE_SYSTEM` (beat outline for targetLengthSec, following given structure), `SCRIPT_SYSTEM` (full spoken-word script from outline+hook, conversational, timed to target ±10%, [VISUAL] cues per beat) + user-builders pulling niche from `app_settings.niche_profile`.
- [ ] **Step 2:** Failing tests (fake llm + in-memory DB): session reuse vs create; buildResearch makes zero llm calls and embeds top-5 similar; generateHooks persists 5; generateVariants with a fake where call #2 rejects → result[1] is `{error}` while [0],[2] are strings and DB `variants` holds 2; quickRemix end-state stage="script" with all fields populated; saveScript links hook/style/source ids.
- [ ] **Step 3:** Implement + thin actions (one per stage + `quickRemixAction`). Gate → commit: `feat(remix): staged generation engine with variant isolation`.

### Task 6: Remix Studio UI

**Files:**
- Create: `src/components/remix/stepper.tsx`, `src/components/remix/stage-{prompt,research,hook,style,script}.tsx`, `src/components/remix/context-rail.tsx`
- Modify: `src/app/(shell)/feed/[videoId]/remix/page.tsx`

- [ ] **Step 1:** Layout per DESIGN.md §2.5 v0.2: left collapsed context rail (thumbnail, multiplier badge, channel, transcript Sheet trigger), main = 5-step stepper header (steps clickable when reachable; state from remix_sessions.stage) + stage body. "Quick Remix" primary button on stage 1 (runs quickRemixAction with progress line per stage, lands on stage 5).
- [ ] **Step 2:** Stage bodies: Prompt (topic Input prefilled `"<source topic> — for my niche"`, niche readonly chip from settings + link to Settings, length Select 30/45/60/90); Research (auto-built on entry if empty; editable facts Textarea; similar-outliers list readonly); Hook (5 option Cards, click selects, edit-in-place Textarea, "save as template" per option, Vault-hook Select to regenerate with template); Style (source-structure default Card vs Vault-style Select, outline beats editable list, regenerate button); Script (variant Tabs, editable Textareas, per-variant regenerate + copy, failed variant inline destructive Alert + retry per DESIGN.md §6, "Save script" → title Dialog → toast + link to Vault Scripts tab).
- [ ] **Step 3:** Loading/error per DESIGN.md §6 (skeleton Textareas, "Writing variant 2 of 3…" progress, key-missing Alert gates every generate button). Keyless: whole studio renders, generates disabled w/ Alert.
- [ ] **Step 4:** Gate + click-through on seed (analyze a planted outlier first if key present; else verify keyless states) → commit: `feat(remix): 5-stage studio UI with quick remix`.

### Task 7: Copy-as-Prompt + wrap

**Files:**
- Create: `src/server/services/export.ts` (+ test)
- Modify: Video Detail (visible "Create Prompt" button per designer v0.2 + overflow entry), Script stage/Vault scripts (copy-as-prompt per script), README (env: ANTHROPIC_API_KEY, CLAUDE_MODEL rows if missing)

- [ ] **Step 1:** TDD `buildVideoPrompt(videoId)` / `buildScriptPrompt(scriptId)` → structured markdown block (spec §8: topic framing, hook strategy, structure beats, style notes, research facts, source metrics) — snapshot tests on seeded+analyzed fixture; graceful degradation when analysis absent (metrics+transcript only, note line "analysis pending").
- [ ] **Step 2:** Wire buttons (clipboard + toast "Prompt copied — paste into any LLM"). 
- [ ] **Step 3:** Full gate `npm run build && npm test`; ledger-ready summary. Commit: `feat(export): copy-as-prompt builder`. 
