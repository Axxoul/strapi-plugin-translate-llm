<p align="center">
  <img src="https://raw.githubusercontent.com/Fekide/strapi-plugin-translate/HEAD/assets/logo.svg" alt="Strapi-Translate" height="100" />
</p>

<div align="center">
  <h1>Strapi v5 - Translate plugin (LLM Fork)</h1>
  <p>Manage and automate the translation of content fields — now with LLM-powered translation via OpenRouter.</p>
  <a href="https://www.npmjs.org/package/strapi-plugin-translate-llm">
    <img alt="npm version" src="https://img.shields.io/npm/v/strapi-plugin-translate-llm?logo=npm">
  </a>
  <a href="https://www.npmjs.org/package/strapi-plugin-translate-llm">
    <img src="https://img.shields.io/npm/dm/strapi-plugin-translate-llm.svg" alt="Monthly download on NPM" />
  </a>
  <a href="https://github.com/Axxoul/strapi-plugin-translate-llm">
    <img src="https://img.shields.io/github/stars/Axxoul/strapi-plugin-translate-llm?style=social" alt="GitHub stars" />
  </a>
</div>

---

## How is this different from [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate)?

This is a fork of the excellent [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) by Felix Haase. Everything from the original plugin works the same — you can still use DeepL or LibreTranslate as providers. This fork adds:

| Feature | Original | This fork |
|---------|----------|-----------|
| **LLM translation** (Claude, GPT, Gemini, Llama, etc.) | Not available | [strapi-provider-translate-openrouter](https://www.npmjs.com/package/strapi-provider-translate-openrouter) — works with OpenRouter or any OpenAI-compatible API |
| **Auto-translate on save** | Not available | Save in the master locale and all other locales are translated automatically in the background — like Strapi AI, but free and provider-agnostic |
| **Custom translation instructions** | Not available | `customPrompt` option: tell the LLM to preserve brand names, use informal tone, handle domain terminology, etc. |
| **Tiered batch translation** | Flat list — relations can silently break if you translate in the wrong order | Content types grouped by dependency tier, so you translate independent types first |
| **HTTP timeout protection** | No protection for slow providers | Keep-alive heartbeat prevents Heroku/ALB timeouts during slow LLM calls |
| **Retry logic** | Provider-specific | Built-in retry with exponential backoff for transient errors (429, 5xx) |

**npm package names:**
- Plugin: [`strapi-plugin-translate-llm`](https://www.npmjs.com/package/strapi-plugin-translate-llm) (this replaces `strapi-plugin-translate`)
- OpenRouter provider: [`strapi-provider-translate-openrouter`](https://www.npmjs.com/package/strapi-provider-translate-openrouter)

---

## Quick Start

```bash
npm install strapi-plugin-translate-llm strapi-provider-translate-openrouter
```

Add to `config/plugins.js`:

```js
module.exports = ({ env }) => ({
  translate: {
    enabled: true,
    config: {
      provider: 'openrouter',
      providerOptions: {
        apiKey: env('OPENROUTER_API_KEY'),
        model: 'anthropic/claude-sonnet-4',
        temperature: 0.3,
        customPrompt: 'Keep "MyBrand" untranslated.',
        localeMap: {
          en: 'English',
          fr: 'French',
        },
      },
      translatedFieldTypes: [
        'string',
        { type: 'text', format: 'plain' },
        { type: 'richtext', format: 'html' },
        'component',
        'dynamiczone',
      ],
    },
  },
})
```

Set `OPENROUTER_API_KEY` in your `.env` and restart Strapi:

```bash
npm run build && npm run develop
```

For full provider documentation, see the [strapi-provider-translate-openrouter README](https://www.npmjs.com/package/strapi-provider-translate-openrouter).

---

## Requirements

- Strapi v5 (`v5.6` to `v5.8` tested)
- The **i18n** plugin installed and enabled (`@strapi/i18n` — enabled by default in Strapi v5)
- Content types with internationalization enabled (advanced settings in content type builder)
- At least **two** locales configured
- A translation provider installed (see below)

## Available Providers

| Provider | Package | Description |
|----------|---------|-------------|
| **OpenRouter** | [`strapi-provider-translate-openrouter`](https://www.npmjs.com/package/strapi-provider-translate-openrouter) | LLM translation via OpenRouter, OpenAI, Ollama, or any OpenAI-compatible API |
| **DeepL** | [`strapi-provider-translate-deepl`](https://www.npmjs.com/package/strapi-provider-translate-deepl) | Machine translation via DeepL API |
| **LibreTranslate** | [`strapi-provider-translate-libretranslate`](https://www.npmjs.com/package/strapi-provider-translate-libretranslate) | Self-hosted machine translation |

## Configuration

### Plugin configuration

> Configure through `config[/env]/plugins.js` or environment variables

```js
module.exports = {
  translate: {
    enabled: true,
    config: {
      provider: '[name]', // 'openrouter', 'deepl', or 'libretranslate'
      providerOptions: {
        // Provider-specific options (see provider README)
      },
      // Which field types are translated (default: string, text, richtext, components, dynamiczones)
      translatedFieldTypes: [
        'string',
        { type: 'blocks', format: 'jsonb' },
        { type: 'text', format: 'plain' },
        { type: 'richtext', format: 'markdown' },
        'component',
        'dynamiczone',
      ],
      // Translate relations (default: true)
      translateRelations: true,
      // After writing an entry in a target locale, re-link everything that referenced it
      // in the source locale. Repairs relations the forward mapping had to drop because
      // the related localization did not exist yet. Additive only. (default: true)
      relinkIncomingRelations: true,
      // Ignore updates for certain content types (default: [])
      ignoreUpdatedContentTypes: ['api::category.category'],
      // Regenerate UIDs when batch updating (default: false)
      regenerateUids: true,

      // --- Auto-translate trigger and dependency cascade ---
      // Every default below reproduces the behaviour of releases before the
      // cascade existed, so upgrading without touching config changes nothing.
      // These are defaults: the Settings page overrides them per environment.
      translateOn: 'save',        // 'save' | 'publish'
      cascade: 'off',             // 'off' | 'missing-only'
      autoPublish: 'trigger',     // 'draft' | 'publish' | 'mirror' | 'trigger'
      updatedEntryAutoPublish: 'draft', // 'draft' | 'publish' | 'mirror'
      onSourceUnpublish: 'ignore',      // 'ignore' | 'unpublish'
      cascadeMaxEntries: 50,      // total per trigger, across all target locales
      cascadeMaxDepth: 5,         // relation hops the cascade may follow
      cascadeLocales: null,       // null = every locale, or e.g. ['en', 'de']
      cascadeIgnoreContentTypes: [],
    },
  },
}
```

#### Auto-translate options

Each of these can also be set in **Settings > Translate**, which overrides the file
config. The file config supplies the default; the UI shows what it falls back to.

| Option | Values | Default | What it does |
|---|---|---|---|
| `translateOn` | `save`, `publish` | `save` | Which editor action starts a translation. `publish` waits for a publish — but only for content types that *have* draft & publish; for the rest, saving is publishing and they keep firing on save. |
| `cascade` | `off`, `missing-only` | `off` | `missing-only` translates the related entries an entry depends on **before** the entry itself, but only those with no target-locale version yet. Existing translations are never re-translated or overwritten. |
| `autoPublish` | `draft`, `publish`, `mirror`, `trigger` | `trigger` | Publish policy for the entry that was saved. `trigger` = publish iff the triggering action published (the historical behaviour). `mirror` = publish iff the source document has a published version. Cascaded dependencies always use `mirror` on **their own** source, whatever this is set to. |
| `updatedEntryAutoPublish` | `draft`, `publish`, `mirror` | `draft` | Publish policy for the "re-translate updated entries" path. `trigger` is rejected here — there is no triggering action. |
| `onSourceUnpublish` | `ignore`, `unpublish` | `ignore` | `unpublish` takes the translations of an unpublished entry offline with it. Applies to that entry only; it is **never** cascaded to related content, because unpublishing a shared category because one article went offline would be destructive. |
| `cascadeMaxEntries` | integer ≥ 1 | `50` | Hard ceiling on entries one trigger may queue, counted **in total across all target locales**, not per locale. One entry per target locale is reserved for the trigger itself; the rest is the dependency budget. Hitting the ceiling is logged with the locales that were cut short. |
| `cascadeMaxDepth` | integer ≥ 1 | `5` | Relation hops the cascade walk may follow. |
| `cascadeLocales` | `string[]` or `null` | `null` | Target locales to translate into. `null` means every locale. |
| `cascadeIgnoreContentTypes` | `string[]` | `[]` | Content type UIDs the cascade never walks into. |

**Recommended production combination:**

```js
translateOn: 'publish',
cascade: 'missing-only',
autoPublish: 'mirror',
```

> ⚠️ **This publishes machine output without human review.** With `translateOn: 'publish'`
> the editor's publish is the signal, and the translation goes straight to the published
> row in every target locale. That is a deliberate trade for teams with no multilingual
> staff — but it is a trade, and you should make it knowingly. If you want review in the
> loop, set `autoPublish: 'draft'` and drive publication yourself: the plugin emits Strapi
> webhooks for every write it makes, so a webhook consumer can queue translations for a
> reviewer and publish them once approved.

### Per-field translation settings

Configure in the Content-Type Builder or in the schema file's `pluginOptions`:

**Disable localization** (i18n setting): set `Enable localization for this field` to false — the field is copied, not translated.

**Translation behavior** (for `component`, `dynamiczone`, `media`, `relation`, `richtext`, `string`, `text`):
- `translate` — automatically translated using the provider
- `copy` — original value is copied as-is
- `delete` — field is left empty

```json
{
  "attributes": {
    "customField": {
      "type": "customField",
      "pluginOptions": {
        "translate": { "translate": "copy" },
        "i18n": { "localized": true }
      }
    }
  }
}
```

## Features

### Auto-translate on save (new)

Automatically translate content to all locales when you save or publish in the master locale — similar to Strapi AI's paid feature, but open-source and works with any provider.

1. Go to **Settings > Translate** in the Strapi admin panel
2. Scroll to the **Auto-Translate on Save** section
3. Toggle **Enable auto-translate on save** to on
4. Select your **Master Locale** (e.g., Swedish)
5. Click **Save Auto-Translate Settings**

**How it works:**
- When you save or publish content in the master locale, all other locales are translated in the background
- Save returns immediately — translations happen asynchronously
- Published content produces published translations; drafts produce draft translations
- Work is written to a **persisted queue before anything starts**, so it survives a
  restart: a translation interrupted mid-flight is picked up again on the next boot
- A real-time status panel on the settings page shows queue depth, progress and errors,
  and offers a **Stop queue** button that drops pending work without a restart
- Errors are shown immediately (no silent failures, no automatic retry beyond 3 attempts)
- Rapid saves collapse into a single translation of the latest content
- Finished log entries are cleaned up after 7 days. Queued and in-progress rows are
  **never** removed by age — a stuck translation stays visible instead of disappearing

### Dependency cascade (new)

Set `cascade: 'missing-only'` and publishing an entry also translates the entries it
depends on, in dependency order, if they have no version in the target locale yet.

This exists because of a specific, long-standing failure: `translateRelations()` maps each
related document to its target-locale localization, and when that localization does not
exist the relation is simply dropped. Nothing revisited it, so a one-time ordering accident
was permanent. Translating dependencies first means the mapping has something to resolve.

- **Ordered by dependency tier**, computed from the content-type relation graph — the same
  graph the tiered batch-translation UI uses. Dependencies are translated before dependents.
- **Cycles are not solved by ordering** (they cannot be); whichever member goes first has an
  unresolvable relation, which the reverse relink pass repairs after the write.
- **Missing-only, always.** An entry that already has a target-locale version is never
  re-translated and never overwritten. Shared taxonomy referenced by hundreds of entries is
  translated once. Repeated publishes converge instead of looping.
- **Bounded.** See `cascadeMaxEntries`, `cascadeMaxDepth`, `cascadeLocales` and
  `cascadeIgnoreContentTypes` above. Hitting a bound is logged, never silent.
- **Cascaded entries mirror their own source's publish status**, not the trigger's. A
  published parent may therefore reference an unpublished dependency — see *Known limits*.

### Translate a single entity

1. Open the entity you want to translate
2. Select a different locale in the **Internationalization** section (right sidebar)
3. Click **Translate from another locale** in the **Translate** section
4. Select the source locale and confirm

### Batch translate all entities of a content type

1. Open the **Translate** plugin in the left menu
2. Content types are grouped by **dependency tier** — translate tier 0 (independent) first, then tier 1+
3. Press **translate**, select source locale and Auto-Publish option
4. Start the translation

Notes:
- Jobs survive server restarts (paused jobs resume automatically)
- UIDs are regenerated automatically in batch mode
- Errors are shown in logs or by hovering the `Job failed` badge

### Retranslating updated entities

Updated entities appear in the batch update section for easy re-translation. Configure with:
- `regenerateUids: true` — regenerate UIDs on retranslation
- `ignoreUpdatedContentTypes` — exclude content types from update tracking

### Relation translation

Relations are translated by reference, not by content:

- **Localized** related type: uses the target locale version if it exists, otherwise removes the relation
- **Non-localized** related type: kept unless it's a one-to-one/one-to-many that would be stolen from another localization

## Permissions

Permissions for direct translation, batch translation, and API usage can be granted to any role via the Strapi admin permissions panel.

## Creating your own translation provider

A provider is an npm package named `strapi-provider-translate-{name}` that exports:

```js
module.exports = {
  provider: 'my-provider',
  name: 'My Provider',
  init(providerOptions = {}, pluginConfig = {}) {
    return {
      async translate({ text, sourceLocale, targetLocale, priority, format }) {
        // Return translated text(s)
      },
      async usage() {
        // Return { count, limit } or undefined
      },
    }
  },
}
```

Use the `chunks` service for splitting large requests and the `format` service for converting between markdown/html/jsonb. See the [OpenRouter provider source](https://github.com/Axxoul/strapi-plugin-translate-llm/tree/main/providers/openrouter) for a complete example.

## Limitations

- Markdown/HTML translation quality varies between providers
- Relations without a target locale translation are removed — use the dependency cascade, or tiered batch translation, to translate in the correct order
- LLM translation costs vary by model and text volume — monitor via the admin UI or your provider's dashboard

### Known limits of the dependency cascade

These are stated rather than papered over. Each one is a real case you can hit.

- **A draft-only target-locale dependency still loses the link on the parent's published
  row.** `missing-only` skips it, because a localization *does* exist; the parent then
  publishes and Strapi resolves the relation against the dependency's published row, which
  is not there. Two shapes, and they are not equally bad:
  - *Cascade-created* — the dependency's own source is a draft too, so the cascade left it a
    draft. The source locale should have the identical gap for the identical reason, so this
    reproduces the source rather than inventing a worse shape. Logged at debug.
  - *Legacy* — the source is fully published but the target-locale dependency exists as a
    draft-only entry from a pre-cascade translation. This gap exists **only** in the target
    locale, and the plugin **warns loudly** about it before every such publish. The cascade
    does not repair it by design: publishing an existing draft to satisfy a parent's link
    would both violate never-touch-existing and push unreviewed content live. Publish that
    entry, or run a backfill.
- **A relation changed after the target-locale entry was last published stays on the draft
  row** until that entry is republished. Ordinary Strapi draft & publish behaviour.
- **Cycles depend on the reverse relink pass**, which runs *after* the write, so there is a
  brief window in which the back-link does not exist.
- **Depth and entry count are bounded.** A very deep or very wide graph is not fully covered
  in one pass; the bound is logged with what was dropped, and the next publish makes progress.
- **A dependency reachable only through an already-translated document is out of scope.**
  The walk does not descend through entries that already have the target locale.
- **Documents reachable only through a polymorphic (morph) relation are invisible** — morph
  attributes carry no `target`, so neither the type graph nor the document walk can see them.
- **Single types are excluded from the cascade.** `translateEntity`'s single-type branch
  creates unconditionally, so cascading into one would add a duplicate document every pass.
- **`discardDraft` and `delete` are not propagated.** Deleting a document removes its
  localizations with it, so there is nothing to do. Discarding a draft is an unpublished edit
  to the source; it is picked up by the next save or publish like any other edit.
- **Re-publishing an entry re-translates that entry** (unchanged auto-translate behaviour),
  even though it queues no new *cascade* work.

## Credits

This fork is based on [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) by Felix Haase and contributors. The OpenRouter LLM provider, tiered dependency UI, HTTP keep-alive, and retry logic were added by [Axel Erwast](https://github.com/Axxoul).

## License

[MIT](./LICENSE)
