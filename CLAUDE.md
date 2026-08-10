# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Strapi v5 translation plugin monorepo (npm workspaces). Provides content translation with pluggable providers. Forked from [Fekide/strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) (upstream `next` branch).

**Workspaces:**
- `plugin/` — Main Strapi plugin (`strapi-plugin-translate-llm`)
- `providers/deepl/` — DeepL translation provider (`strapi-provider-translate-deepl`)
- `providers/libretranslate/` — LibreTranslate provider (`strapi-provider-translate-libretranslate`)
- `providers/openrouter/` — OpenRouter LLM provider (`strapi-provider-translate-openrouter`)
- `playground/` — Strapi v5 test app for E2E testing

## Commands

```bash
npm install                     # Install all workspace dependencies
npm test                        # Run unit tests across all workspaces
npm run lint                    # ESLint
npm run lint:prettier           # Prettier check
npm run commit                  # Commitizen conventional commit prompt

# Plugin-specific
cd plugin
npm run build                   # Build plugin (strapi-plugin build)
npm run watch                   # Watch mode for development
npm run watch:link              # Watch with symlink for local Strapi dev
npm test                        # Plugin unit tests only
npm run test:ts:front           # TypeScript check for admin code
npm run test:ts:back            # TypeScript check for server code

# Single test file
npx jest path/to/test.ts

# Publish plugin (build, bump patch, publish to npm)
cd plugin && npm run build && npm version patch && npm publish

# E2E (from playground/)
cd playground
npm run e2e
```

## Architecture

### Plugin Lifecycle
Strapi v5 standard: `register` → `bootstrap` → `destroy`. Bootstrap (`plugin/server/src/bootstrap.ts`) loads the configured translation provider, registers the auto-translate document service middleware, cleans up stale auto-translate logs, subscribes to `afterUpdate` lifecycle hooks for tracking content modifications, registers RBAC actions, and resumes paused batch jobs.

### Provider Interface
Providers are npm packages named `strapi-provider-translate-{name}`. Each exports `init(providerOptions, pluginConfig)` returning `{ translate({ text, sourceLocale, targetLocale, priority, format }), usage() }`. A built-in dummy provider copies values without translating. Both real providers use Bottleneck for rate limiting.

### Key Services (`plugin/server/src/services/`)
- **auto-translate** — Automatic translation on save/publish, plus the dependency cascade. A document service middleware intercepts create/update/publish/unpublish on localized content types and resolves the locales the action touched. When a resolved locale matches the master locale, the service plans the work (optionally cascading into untranslated dependencies, tier-ordered), writes `pending` rows to a **persisted queue**, and a single sequential executor drains it via `translateEntity()`. An in-memory guard set prevents infinite loops; a separate depth counter suppresses `updated-entry` tracking for plugin-originated writes.
- **translate** — Orchestrates single-entity and batch translation; groups fields by format, calls provider, maps results back
- **batch-translate/** — `BatchTranslateManager` + `BatchTranslateJobExecutor` handle DB-persisted, pause/resume-capable batch jobs that survive server restarts
- **chunks** — Splits text arrays respecting provider max length/byte limits; returns a reduce function to reassemble results
- **format/** — Converts between markdown, HTML, and Strapi Blocks (JSONB) using showdown and jsdom
- **untranslated** — Queries for content missing target locale translations
- **updated-entry** — Tracks modified localizations for re-translation suggestions

### Shared Types (`plugin/shared/`)
TypeScript interfaces and contracts shared between server and admin. Contains API request/response types (`contracts/`), service interfaces (`services/`), and domain types (`types/`).

### Content Types
Three hidden collection types: `batch-translate-job` (job state/progress/status), `updated-entry` (modification tracking for re-translation), and `auto-translate-log` (**the auto-translate queue as well as its log** — status, plan id, tier, attempts and publish mode per row).

### Admin UI (`plugin/admin/src/`)
React frontend using `@strapi/design-system` v2 and `react-intl`. Key views: collection list with batch job status, content manager header action for direct translation (`CMHeaderActions.tsx`), usage quota display, settings page with provider config and auto-translate controls. The settings page includes a `StatusPanel` component that polls for auto-translate log entries (5s interval) and displays real-time translation progress/errors. Request validation uses Zod on the server side.

### Routes
- `POST /translate/entity` — Direct single-entity translation
- `POST /translate/batch` — Start batch translation
- `POST /translate/batch/pause|resume|cancel/:id` — Job control
- `POST /translate/estimate` — Usage estimation
- `GET /provider/usage` — Provider API quota
- `GET /auto-translate/settings` — Effective auto-translate settings plus the file-config defaults
- `PUT /auto-translate/settings` — Update auto-translate settings (partial; an omitted field is left alone)
- `GET /auto-translate/logs` — List recent queue/log rows (supports `?status=` and `?limit=`)
- `DELETE /auto-translate/logs` — Clear all rows
- `GET /auto-translate/queue` — Queue status: pending/translating/failed counts, oldest live row, stale count, whether the executor is running
- `DELETE /auto-translate/queue` — Kill switch: cancel pending rows without a restart

## Code Style

- **TypeScript** throughout (server and admin)
- Prettier: 2-space indent, single quotes, no semicolons, ES5 trailing commas
- ESLint: import ordering, no circular dependencies, max 120 char lines (admin)
- Conventional commits required (`npm run commit` or commitizen)
- Multi-semantic-release for independent workspace versioning

## Testing

- **Unit**: Jest with SWC transpilation, pattern `**/__tests__/**/*.{js,ts,jsx,tsx}`
- **E2E**: Cypress 13 in playground against Strapi v5
- **Type checking**: Separate `tsc --noEmit` for admin (`-p admin`) and server (`-p server`)
- Coverage collected from `plugin/server/src/**/*.ts`
- Reports output to `reports/jest-junit.xml`

## Pulling Upstream Updates

```bash
git fetch upstream
git merge upstream/next
```

The `upstream` remote points to `Fekide/strapi-plugin-translate`. This fork's `main` tracks upstream's `next` branch (Strapi v5).

## In-Progress Features (uncommitted)

### 1. Tiered Dependency UI for Batch Translation
Content types are now grouped by dependency tier in the batch translation UI, so users translate independent types first and dependent types after. This addresses the upstream limitation where relations without a target-locale translation are silently dropped.

**Key files:**
- `plugin/server/src/utils/content-type-graph.ts` — builds a dependency graph of localized content types, uses Tarjan's algorithm (SCC detection), and computes tiers (0 = no deps, 1+ = depends on lower tiers, `'circular'` = mutual dependency)
- `plugin/server/src/utils/__tests__/content-type-graph.test.ts` — unit tests for the graph utility
- `plugin/shared/types/report.ts` — new types: `TierGroup`, `CircularGroup`, `TieredReportData`; `ContentTypeTranslationReport` now has a `tier` field
- `plugin/shared/contracts/translate.ts` — report endpoint returns `TieredReportData` instead of `ReportData`
- `plugin/server/src/services/translate.ts` — `contentTypesTranslationReport` now computes tiers and groups results
- `plugin/admin/src/components/Collection/TierHeader.tsx` — tier section header with warning icon for circular deps
- `plugin/admin/src/components/Collection/TierTable.tsx` — table component for a single tier group
- `plugin/admin/src/components/Collection/CollectionTable.tsx` — refactored to render tier groups instead of a flat table
- `plugin/admin/src/Hooks/useCollection.ts` — exposes `tiers` and `circularGroup` alongside flat `collections`

### 2. Auto-Translate on Save/Publish
Automatic background translation when content is saved or published in the master locale. Comparable to Strapi AI's paid auto-translate feature but open-source and provider-agnostic.

**How it works:**
1. A document service middleware (`plugin/server/src/middlewares/auto-translate.ts`) intercepts `create`, `update`, `publish` and `unpublish` on localized content types
2. It resolves the **source locales the action touched** — `undefined` → the i18n default, `'*'` → every locale, arrays element-wise. This is load-bearing: `@strapi/core` fills `locale` in *inside* the repository, after middlewares run, so a plain `publish({documentId})` arrives here with `locale === undefined` and reading the raw value made the feature silently do nothing on the commonest publish shape.
3. `publishedNow = action === 'publish' || (create|update with `params.status === 'published'`)`. `update({status:'published'})` does **not** emit a separate `publish` action — `repository.js` calls the module-local `publish()`, which never re-enters the middleware chain.
4. `translateOn: 'publish'` gates on `publishedNow` **only for draft-and-publish types**, read off `options.draftAndPublish`. A type without D&P has no publish event and one row, so for it save *is* publish.
5. If the resolved locale matches the master locale, the `auto-translate` service plans the work and writes `pending` rows to the queue — **before** anything runs, so a restart in the window is visible rather than lost
6. A single sequential executor drains the queue via the existing `translateEntity()` flow. Results (pending/translating/success/failed/cancelled) live on the same rows
7. An in-memory `Set<string>` guard prevents infinite loops; a separate depth counter (`isPluginWrite()`) suppresses `updated-entry` tracking for *all* plugin-originated writes, including the relink pass writing to other documents
8. The admin Settings page shows a real-time status panel with queue depth, stale-row warnings and a kill switch

**The queue** (`auto-translate-log` doubles as it):
- Rows are keyed `(contentType, entryDocumentId, targetLocale)` — the dedupe key. A live row (`pending`/`translating`) is the **authoritative** lock; the in-memory map is a fast path only, so a two-dyno race resolves itself (lowest row id wins, the loser cancels itself).
- **The dedupe merges signals, it never just drops.** The admin panel's publish button is update-then-publish through the document service (Strapi's CM controller saves the draft, then publishes — two middleware passes ms apart), so the publish trigger routinely meets the update's live row. A duplicate upgrades that row monotonically: `triggerPublished` false→true, `isTrigger` false→true (a direct trigger absorbing a cascade `mirror` row also brings its `publishMode` and `displayName`). Upgrades land via a **conditional `updateMany` on `(id, status: 'pending')`** — one SQL statement, so they can never hit a row the executor already picked up. The executor re-reads the row *after* flipping it to `translating` (the drain loop fetched it before the settle sleep, so its copy is stale by design); a stronger trigger arriving after that flip inserts a follow-up row instead, and the sequential executor re-translates with the flag. Dropping the publish flag here was the 1.1.1 production bug: under `autoPublish: 'trigger'` every admin publish produced a draft translation.
- Rows are inserted in **plan order** (dependencies by ascending tier, then the trigger entry) and consumed by ascending `id`. That gives tier ordering *within* a plan without a global tier barrier — a later plan never blocks on an earlier plan's tier.
- `SETTLE_MS` (300 ms) delays *execution*, not row creation. It still collapses a rapid create-then-update into one translation of the latest content, which is what the old debounce did, without the old debounce's window of invisible loss.
- `resumeQueue()` runs on bootstrap: `translating` → `pending` (attempt already counted, `MAX_ATTEMPTS` 3), in-flight set rebuilt, drain kicked.
- `cleanupOldLogs()` deletes **only** `success`/`failed`/`cancelled` rows by age. Deleting a live row would silently drop the translation it stands for; a stuck row stays and is surfaced by `getQueueStatus()`.

**Key files:**
- `plugin/server/src/middlewares/auto-translate.ts` — trigger detection + locale resolution
- `plugin/server/src/services/auto-translate.ts` — settings merge/cache, planning, queue, executor, guard, unpublish handling
- `plugin/server/src/utils/cascade-plan.ts` — **pure** planner (injected lookups), ordering + bounds
- `plugin/server/src/utils/related-documents.ts` — deep-populated relation walk (components + dynamic zones)
- `plugin/server/src/utils/tier-map.ts` — memoized `uid → tier`, 60 s TTL + explicit invalidator
- `plugin/server/src/utils/resolve-publish.ts` — the one place `draft|publish|mirror|trigger` is resolved
- `plugin/server/src/controllers/auto-translate.ts` / `routes/auto-translate.ts` — settings, logs, queue status, kill switch (6 routes)
- `plugin/server/src/content-types/auto-translate-log/schema.json` — queue/log rows
- `plugin/shared/contracts/auto-translate.ts`, `plugin/shared/types/auto-translate-options.ts` — shared types and the single definition of each option vocabulary
- `plugin/admin/src/components/AutoTranslate/StatusPanel.tsx` — status UI, queue summary, Stop queue
- `plugin/admin/src/pages/SettingsPage.tsx` — all auto-translate options
- Tests: `services/__tests__/auto-translate.test.ts` (38), `middlewares/__tests__/auto-translate.test.ts` (21), `utils/__tests__/cascade-plan.test.ts` (16), `utils/__tests__/resolve-publish.test.ts` (13), `utils/__tests__/warn-unpublished-dependencies.test.ts` (7), plus the config validator cases. Harness: `server/src/__mocks__/auto-translate-harness.ts`

**Configuration:** file config supplies the defaults (`plugin/server/src/config/index.ts`), the DB store overrides them (Settings → Translate), exactly like `getMergedProviderOptions()`. See the README's *Auto-translate options* table.

**Rule 0 — defaults are behaviour-preserving.** `translateOn: 'save'`, `cascade: 'off'`, `autoPublish: 'trigger'`, `updatedEntryAutoPublish: 'draft'`. `'trigger'` is a verbatim pass-through of the triggering action's publish flag — it deliberately does *not* branch on draft-and-publish, so an app that upgrades without touching config writes byte-identical parameters. Asserted by test, not by inspection.

**Watch out:** `'@shared/…'` is a **tsc-only** alias. Type-only imports work (SWC elides them); a runtime *value* import from `@shared` resolves under `tsc` and then fails under Jest and the build. Use a relative path for values — `config/index.ts`, `services/auto-translate.ts` and `BatchTranslateJobExecutor.ts` all do.

**Error handling:** Fails loudly — errors are logged to the row and displayed in the Settings page status panel. Up to 3 attempts, no backoff. Old *finished* rows are cleaned up on bootstrap (>7 days).

### 3. Reverse Relation Relink (incoming pass)

Fixes the long-standing defect where translated entries came out with **relation fields silently
null**. `translateRelations()` maps each related document to its target-locale localization; when
that localization does not exist *yet*, `findOne` returns `null` and the relation is dropped
(`compact()` for to-many, `undefined` for to-one). Nothing ever revisited the link, so a one-time
ordering accident was permanent — in the EPIC Trails production DB this left ~600 broken EN links
(`product.product_options` and `product.product_category`).

**How it works:** after an entry is written in the target locale, a *reverse* pass re-links from the
other side — every document that referenced it in the source locale gets the same link on its
target-locale localization. Forward mapping alone can never link to something that does not exist;
the reverse pass runs when the missing side finally appears.

- **Additive only.** `connect` for to-many; to-one is only filled when empty, so editor-made links
  are never overwritten or disconnected. No `set`/`disconnect` anywhere.
- **Never fatal.** Every step is try/catch + `strapi.log.warn`; a relink failure cannot fail the
  translation.
- Passes **documentIds**, so Strapi resolves the correct locale and both draft + published rows of
  draft-and-publish targets.
- Referrers per (contentType, attribute) are capped at `MAX_REFERRERS_PER_ATTRIBUTE` (500) with a
  warning when the cap is hit.

**The forward pass writes documentIds too (1.0.14).** `cleanData()` used to flatten every resolved
relation to its numeric `id` before the target-locale write. A numeric id addresses exactly one row
and, per `@strapi/core/.../transform/relations/transform/data-ids.js`, short-circuits Strapi's
relation transform entirely — no locale resolution, no draft/published resolution, just "link this
row". Since `getRelevantLocalization()` returns the target's *draft*, an already-published target
locale never received the link on its published row, which is the "published-row gap" the backfill
script kept sweeping. The branch now emits `e.documentId ?? e.id`, so the write goes through the
transform and Strapi resolves the right locale and status itself. The `id` fallback keeps relations
to non-document targets (e.g. `admin::user`) working; the **media** branch stays on numeric ids
because files are not documents. A bare array still means `set` (replace), so the to-many shape is
unchanged.

**…but as longhand objects, never bare strings (1.1.1).** Strapi's relation shorthand parser
(`map-relation.js`) classifies a bare string with `parseInt`, so a documentId that *starts with a
digit* (`'8z2qq…'` → `8`) is misparsed as a numeric-id shorthand, skips the documentId→id
transform, and either throws `N relation(s) of type … do not exist` in the entity validator or
silently links whatever row the digit prefix coerces to. Real production hit: 3 of 9 theme
documentIds on one product were digit-leading. Both write paths — `cleanData()` forward and
`relinkIncomingRelations()` reverse — therefore emit `{ documentId }` (or `{ id }` fallback)
objects, which always take `mapRelation`'s object branch. Regression tests use a digit-leading
documentId. Upstream bug drafted in `tasks/upstream-issues.md`.

**Key files:**
- `plugin/server/src/utils/clean-data.ts` — relation branch emits `documentId ?? id`
- `plugin/server/src/utils/relink-relations.ts` — memoized incoming-relation index
  (`targetUid → [{ uid, attr, attribute }]`, both sides of bidirectional relations, localized types
  only, `translate: 'delete'` excluded) + `relinkIncomingRelations()`
- `plugin/server/src/utils/__tests__/relink-relations.test.ts` — 12 unit tests
- `plugin/server/src/services/translate.ts` — calls the relink pass after the target-locale write
- `plugin/server/src/utils/translate-relations.ts` — now logs dropped unresolved relations
  (`[translate] dropped N unresolved <attr> relation(s) …`); the loss used to be completely silent
- `plugin/server/src/config/index.ts` — `relinkIncomingRelations` flag (default `true`), gated
  additionally on the existing `translateRelations`

**Backfilling existing data:** the reverse pass only fires on new translations. Historical breakage
is repaired by `scripts/backfill-localized-relations.js` in the `strapi-travl` repo (dry-run by
default) — see `strapi-travl/docs/TRANSLATION_RELATIONS.md`.

### 4. OpenRouter LLM Translation Provider (WIP)
A new provider (`providers/openrouter/`) that uses OpenRouter's OpenAI-compatible API to translate content via LLMs instead of DeepL.

**Key files:**
- `providers/openrouter/src/lib/index.ts` — provider init, uses OpenAI SDK pointed at OpenRouter, Bottleneck rate limiting
- `providers/openrouter/src/lib/prompt.ts` — system prompt builder for translation instructions
- `providers/openrouter/src/lib/constants.ts` — default model, API URL, rate limits
- `providers/openrouter/src/lib/get-service.ts` — Strapi service accessor helper

**Config (when ready):** set `provider: 'openrouter'` in plugins config, provide `OPENROUTER_API_KEY` env var. Optional: `OPENROUTER_API_URL`, `model`, `temperature`, `customPrompt`, `localeMap` in `providerOptions`.

**Tests:** 16/16 passing. Run with `npx jest providers/openrouter`.

**npm link for local development:**
```bash
cd providers/openrouter && npm run build
npm link -w providers/openrouter           # from monorepo root
cd C:\jsapps\strapi-ucpa && npm link strapi-provider-translate-openrouter
```

### 5. Published-row gap check (`utils/warn-unpublished-dependencies.ts`)

Runs before any write with `status: 'published'`. It catches a failure that
`logDroppedRelations` structurally **cannot** see: `getRelevantLocalization()` calls
`findOne({documentId, locale})` with no status, which defaults to the draft, so a draft-only
dependency *resolves successfully* and is never dropped by `translateRelation`. The loss
happens one layer later, silently, inside Strapi's relation transform — `dp.js` resolves the
write against the target's published row, which does not exist.

Two cases, deliberately at different log levels:
- **legacy** (source published, target-locale twin draft-only) → `warn`, naming parent and
  dependency. Target-only gap; repair belongs to a backfill, not the cascade.
- **mirrored** (the dependency is unpublished in the source too) → `debug`. Believed a
  faithful mirror of the source, **conditional on the source-parity assertion** in the
  playground spec (`9.7`). If parity does not hold, this case must be promoted to `warn` and
  the "faithful mirror" wording in the README's *Known limits* is wrong.

The check is never fatal and never blocks a translation.

### 6. Playground additions for the cascade E2E

`api::topic.topic` and `api::dossier.dossier` were added because the pre-existing fixtures
could not exercise the feature: `api::category.category` is localized but **not** draft &
publish, `api::writer.writer` is not localized, leaving exactly one localized edge to a
non-D&P target. The additions give a localized **D&P** dependency (`topic`), a **to-many**
relation (`article.topics`), and a genuine **SCC** (`dossier.topics` owns one edge,
`topic.featuredDossier` the other — a single bidirectional pair is *not* a cycle in the graph,
because `buildDependencyGraph` skips the `mappedBy` side).

`playground/cypress/e2e/publish-cascade.cy.js` drives the admin API rather than the content
manager UI: the cascade is background work behind a persisted queue, so the spec queues,
polls `GET /translate/auto-translate/queue` via `cy.waitForQueue()`, then asserts. Published-row
assertions read the **public REST API**, which only ever sees published rows — the exact
surface where the relation used to vanish.

## Local Development with strapi-ucpa

To test the plugin locally against `C:\jsapps\strapi-ucpa`:

```bash
cd plugin && npm run build       # Build plugin
npm link -w plugin               # Create global symlink (from monorepo root)
cd C:\jsapps\strapi-ucpa && npm link strapi-plugin-translate  # Link into Strapi app
cd plugin && npm run watch:link  # Watch for changes during development
```

The strapi-ucpa `config/plugins.js` has the translate plugin configured with OpenRouter (DeepL config commented out for easy switching). Set `OPENROUTER_API_KEY` in strapi-ucpa `.env`.

### HTTP Keep-Alive Heartbeat

`POST /translate/entity` uses a chunked heartbeat (`plugin/server/src/utils/keep-alive.ts`) that writes space characters every 15s to prevent reverse proxy timeouts (Heroku 30s, ALB 60s). The final JSON response is appended after the spaces — `JSON.parse` tolerates leading whitespace by spec. For fast providers like DeepL (1-3s), zero heartbeats fire — behavior is identical to before.

### Gotchas with npm link

- **Provider resolution:** When the plugin is symlinked, `require.resolve` for provider packages (e.g. `strapi-provider-translate-deepl`) runs from the plugin's source directory, not the Strapi app's `node_modules`. Fixed by passing `{ paths: [process.cwd(), __dirname] }` to `require.resolve` in `plugin/server/src/bootstrap.ts` so it searches the Strapi app root too.
- **Rollup native module:** On Windows, `@rollup/rollup-win32-x64-msvc` may be missing after `npm install`. Fix: `npm install @rollup/rollup-win32-x64-msvc`.
- **Strapi Vite cache:** After rebuilding the plugin, Strapi may serve stale admin bundles. Clear the cache before restarting:
  ```bash
  rm -rf C:\jsapps\strapi-ucpa\.strapi\client C:\jsapps\strapi-ucpa\node_modules\.strapi
  ```
- **TooltipProvider:** Strapi Design System v2's `Tooltip` requires a `TooltipProvider` ancestor (Radix). The `TierTable` component wraps its content in `<TooltipPrimitive.Provider>` from `@radix-ui/react-tooltip` to satisfy this requirement for `Tooltip` used inside `CollectionRow`.
