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
      // Ignore updates for certain content types (default: [])
      ignoreUpdatedContentTypes: ['api::category.category'],
      // Regenerate UIDs when batch updating (default: false)
      regenerateUids: true,
    },
  },
}
```

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
- A real-time status panel on the settings page shows progress and errors
- Errors are shown immediately (no silent failures, no automatic retry)
- Rapid saves are debounced (300ms) to avoid redundant translations
- Old translation logs are automatically cleaned up after 7 days

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
- Relations without a target locale translation are removed — use tiered batch translation to translate in the correct order
- LLM translation costs vary by model and text volume — monitor via the admin UI or your provider's dashboard

## Credits

This fork is based on [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) by Felix Haase and contributors. The OpenRouter LLM provider, tiered dependency UI, HTTP keep-alive, and retry logic were added by [Axel Erwast](https://github.com/Axxoul).

## License

[MIT](./LICENSE)
