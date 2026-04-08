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

This is a fork of [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) that adds **LLM-powered translation** and **tiered batch translation**.

For full documentation, see the [main README on GitHub](https://github.com/Axxoul/strapi-plugin-translate-llm#readme).

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

## What's different from the original?

| Feature | Original | This fork |
|---------|----------|-----------|
| **LLM translation** (Claude, GPT, Gemini, etc.) | Not available | via [strapi-provider-translate-openrouter](https://www.npmjs.com/package/strapi-provider-translate-openrouter) |
| **Auto-translate on save/publish** | Not available | Automatic background translation when master locale is saved |
| **Custom translation instructions** | Not available | `customPrompt` option |
| **Tiered batch translation** | Flat list | Grouped by dependency tier |
| **Continue-on-error batch jobs** | One failure aborts the whole job | Failing entities are skipped and logged; the job runs to completion |
| **HTTP timeout protection** | None | Keep-alive heartbeat for slow providers |
| **Field maxLength enforcement** | Not available | Auto-truncates translations exceeding field character limits |
| **Retry logic** | Provider-specific | Built-in exponential backoff |

## Available Providers

- [strapi-provider-translate-openrouter](https://www.npmjs.com/package/strapi-provider-translate-openrouter) — LLM translation (OpenRouter, OpenAI, Ollama, etc.)
- [strapi-provider-translate-deepl](https://www.npmjs.com/package/strapi-provider-translate-deepl) — DeepL machine translation
- [strapi-provider-translate-libretranslate](https://www.npmjs.com/package/strapi-provider-translate-libretranslate) — self-hosted machine translation

## Auto-Translate

Automatically translate content when saving or publishing in the master locale — no manual action needed.

1. Go to **Settings → Translate** in Strapi admin
2. Enable **Auto-translate on save**
3. Select your **master locale** (e.g. English)

When you save or publish content in the master locale, all other locales are translated in the background. A real-time status panel in the Settings page shows translation progress and any errors.

## Resilient Batch Translation

When you run a batch translation job from **Plugins → Translate**, a single failing entity no longer aborts the whole job. Each failure is:

- skipped so the job continues with the remaining entities
- recorded in a dedicated log with the content type, entry, source/target locales, and error message
- surfaced in a **RECENT BATCH-TRANSLATIONS** panel on the **Settings → Translate** page (next to the auto-translate log), with a direct link to the failing entry

The batch job ends as `finished` with an accurate progress count, and old log entries are pruned automatically after 7 days.

## Credits

Fork of [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) by Felix Haase. LLM provider, auto-translate, and tiered UI by [Axel Erwast](https://github.com/Axxoul).

## License

[MIT](./LICENSE)
