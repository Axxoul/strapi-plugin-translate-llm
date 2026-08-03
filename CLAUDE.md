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
- **auto-translate** — Automatic translation on save/publish. Uses a document service middleware to intercept create/update/publish on localized content types. When the saved locale matches the configured master locale, fires sequential `translateEntity()` calls for all other locales in the background. Uses an in-memory guard set to prevent infinite loops and a debounce to collapse rapid saves.
- **translate** — Orchestrates single-entity and batch translation; groups fields by format, calls provider, maps results back
- **batch-translate/** — `BatchTranslateManager` + `BatchTranslateJobExecutor` handle DB-persisted, pause/resume-capable batch jobs that survive server restarts
- **chunks** — Splits text arrays respecting provider max length/byte limits; returns a reduce function to reassemble results
- **format/** — Converts between markdown, HTML, and Strapi Blocks (JSONB) using showdown and jsdom
- **untranslated** — Queries for content missing target locale translations
- **updated-entry** — Tracks modified localizations for re-translation suggestions

### Shared Types (`plugin/shared/`)
TypeScript interfaces and contracts shared between server and admin. Contains API request/response types (`contracts/`), service interfaces (`services/`), and domain types (`types/`).

### Content Types
Three hidden collection types: `batch-translate-job` (job state/progress/status), `updated-entry` (modification tracking for re-translation), and `auto-translate-log` (status/error tracking for automatic translations).

### Admin UI (`plugin/admin/src/`)
React frontend using `@strapi/design-system` v2 and `react-intl`. Key views: collection list with batch job status, content manager header action for direct translation (`CMHeaderActions.tsx`), usage quota display, settings page with provider config and auto-translate controls. The settings page includes a `StatusPanel` component that polls for auto-translate log entries (5s interval) and displays real-time translation progress/errors. Request validation uses Zod on the server side.

### Routes
- `POST /translate/entity` — Direct single-entity translation
- `POST /translate/batch` — Start batch translation
- `POST /translate/batch/pause|resume|cancel/:id` — Job control
- `POST /translate/estimate` — Usage estimation
- `GET /provider/usage` — Provider API quota
- `GET /auto-translate/settings` — Get auto-translate settings (enabled, master locale)
- `PUT /auto-translate/settings` — Update auto-translate settings
- `GET /auto-translate/logs` — List recent auto-translate log entries (supports `?status=` and `?limit=` query params)
- `DELETE /auto-translate/logs` — Clear all auto-translate log entries

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
1. A document service middleware (`plugin/server/src/middlewares/auto-translate.ts`) intercepts `create`, `update`, and `publish` actions on localized content types
2. If the saved locale matches the configured master locale and auto-translate is enabled, the `auto-translate` service fires in the background (non-blocking)
3. Translations run sequentially for each target locale via the existing `translateEntity()` flow
4. An in-memory `Set<string>` guard prevents infinite loops — translated writes are flagged so the middleware skips them
5. A 300ms debounce collapses rapid saves into a single translation trigger
6. Results (pending/translating/success/failed) are logged to the `auto-translate-log` content type
7. The admin Settings page shows a real-time status panel that polls for log entries

**Key files:**
- `plugin/server/src/middlewares/auto-translate.ts` — document service middleware registration
- `plugin/server/src/services/auto-translate.ts` — core orchestration: guard, debounce, settings CRUD, log CRUD, `triggerAutoTranslate()`
- `plugin/server/src/controllers/auto-translate.ts` — API handlers for settings and logs
- `plugin/server/src/routes/auto-translate.ts` — 4 route definitions
- `plugin/server/src/content-types/auto-translate-log/schema.json` — log entry content type
- `plugin/shared/contracts/auto-translate.ts` — shared TypeScript types
- `plugin/admin/src/components/AutoTranslate/StatusPanel.tsx` — real-time status UI with polling
- `plugin/admin/src/services/auto-translate.ts` — RTK Query hooks for admin API

**Configuration:** Enable in Strapi admin → Settings → Translate. Set "Enable auto-translate on save" toggle and select the master locale. Settings are stored in the Strapi DB store (`plugin::translate::auto_translate_settings`).

**Error handling:** Fails loudly — errors are logged to the auto-translate-log content type and displayed in the Settings page status panel. No automatic retry. Old logs are cleaned up on bootstrap (>7 days).

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
