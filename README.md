<p align="center">
  <img src="https://raw.githubusercontent.com/Fekide/strapi-plugin-translate/HEAD/assets/logo.svg" alt="Strapi-Translate" height="100" />
</p>

<div align="center">
  <h1>Strapi v5 - Translate plugin (LLM Fork)</h1>
  <p>Manage and automate the translation of content fields — now with LLM-powered translation via OpenRouter.</p>
  <a href="https://www.npmjs.org/package/strapi-plugin-translate">
    <img alt="GitHub package.json version" src="https://img.shields.io/github/package-json/v/fekide/strapi-plugin-translate?filename=plugin%2Fpackage.json&label=npm&logo=npm">
  </a>
  <a href="https://www.npmjs.org/package/strapi-plugin-translate">
    <img src="https://img.shields.io/npm/dm/strapi-plugin-translate.svg" alt="Monthly download on NPM" />
  </a>
  <a href="http://commitizen.github.io/cz-cli/">
    <img src="https://img.shields.io/badge/commitizen-friendly-brightgreen.svg" alt="Commitizen friendly" />
  </a>
</div>

![plugin showcase](https://raw.githubusercontent.com/Fekide/strapi-plugin-translate/HEAD/assets/showcase.gif)

## What's different in this fork?

This fork extends [Fekide/strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) with two features:

1. **OpenRouter LLM Translation Provider** — translate content using any LLM (Claude, GPT, Gemini, Llama, etc.) via OpenRouter or any OpenAI-compatible API, instead of being limited to machine translation services like DeepL
2. **Tiered Dependency UI for Batch Translation** — content types are grouped by dependency tier in the batch translation view, so users translate independent types first and dependent types after, preventing silently dropped relations

---

## OpenRouter LLM Provider

### Why LLMs for translation?

- **Context-aware**: LLMs understand domain terminology, brand names, and tone — producing more natural translations than pure machine translation
- **Customizable**: inject custom instructions (e.g., "keep UCPA untranslated", "use informal register") via `customPrompt`
- **Any language pair**: not limited to the language pairs a specific translation API supports
- **Model flexibility**: choose any model on OpenRouter — trade cost for quality as needed

### Installation

```bash
npm install strapi-plugin-translate strapi-provider-translate-openrouter
```

### Configuration

Add to `config/plugins.js`:

```js
module.exports = ({ env }) => ({
  translate: {
    enabled: true,
    config: {
      provider: 'openrouter',
      providerOptions: {
        // Required: set via env var or directly here
        apiKey: env('OPENROUTER_API_KEY'),

        // Optional (defaults shown)
        model: 'anthropic/claude-sonnet-4',  // any OpenRouter model ID
        temperature: 0.3,                       // 0.1-0.3 = literal, 0.5-0.7 = creative
        customPrompt: '',                       // appended to the system prompt
        localeMap: {},                          // maps Strapi locale codes to language names
        maxTextsPerRequest: 20,                 // texts batched per LLM call
        maxConcurrent: 3,                       // parallel LLM requests
        apiUrl: 'https://openrouter.ai/api/v1', // or set OPENROUTER_API_URL env var
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

### Provider Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `OPENROUTER_API_KEY` env var | **Required.** Your OpenRouter API key |
| `model` | `string` | `anthropic/claude-sonnet-4` | Model ID from [OpenRouter models](https://openrouter.ai/models) |
| `temperature` | `number` | `0.3` | Controls translation creativity. Lower = more literal |
| `customPrompt` | `string` | — | Additional instructions appended to the system prompt |
| `localeMap` | `object` | `{}` | Maps locale codes to human-readable names (e.g., `{ sv: 'Swedish' }`) |
| `maxTextsPerRequest` | `number` | `20` | Max texts per LLM call. Reduce if hitting context limits |
| `maxConcurrent` | `number` | `3` | Max parallel requests. Reduce if rate-limited |
| `apiUrl` | `string` | `https://openrouter.ai/api/v1` | API endpoint URL |

### Custom Prompt Examples

The `customPrompt` is appended to the system prompt after the base translation rules. Use it for domain-specific instructions:

```js
// Preserve brand names
customPrompt: 'Keep "UCPA" and "MyBrand" untranslated.'

// Control tone
customPrompt: 'Use informal "du" in Swedish, not "ni". Use a friendly, conversational tone.'

// Terminology consistency
customPrompt: 'Translate "activité" as "activity" not "event". Use "destination" not "resort".'

// Combine multiple rules
customPrompt: `
  Keep "UCPA" untranslated.
  Use informal register in all languages.
  Translate ski terminology naturally for the target audience.
`
```

### Locale Map

By default, the raw Strapi locale code (e.g., `sv`, `en`) is sent to the LLM. While most models handle this fine, explicit language names reduce ambiguity for less common locales:

```js
localeMap: {
  en: 'English',
  fr: 'French',
  sv: 'Swedish',
  nb: 'Norwegian Bokmal',
  'pt-BR': 'Brazilian Portuguese',
}
```

### Recommended Models

| Model | Best for | Approximate cost |
|-------|----------|-----------------|
| `anthropic/claude-sonnet-4` | Best quality/cost balance | ~$3/1M tokens |
| `anthropic/claude-haiku-4-5` | Fast, cheap, good for simple content | ~$0.80/1M tokens |
| `google/gemini-2.5-flash` | Very cheap, fast | ~$0.15/1M tokens |
| `openai/gpt-4o` | Strong alternative | ~$2.50/1M tokens |
| `openai/gpt-4o-mini` | Budget OpenAI option | ~$0.15/1M tokens |

Check [openrouter.ai/models](https://openrouter.ai/models) for the full list and current pricing.

### Using Other OpenAI-Compatible APIs

The provider uses the OpenAI SDK internally, so it works with **any OpenAI-compatible endpoint** — not just OpenRouter:

```js
// OpenAI directly
providerOptions: {
  apiKey: env('OPENAI_API_KEY'),
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
}

// Local Ollama
providerOptions: {
  apiKey: 'ollama',  // any non-empty string
  apiUrl: 'http://localhost:11434/v1',
  model: 'llama3',
}

// LM Studio
providerOptions: {
  apiKey: 'lmstudio',
  apiUrl: 'http://localhost:1234/v1',
  model: 'local-model',
}
```

### Reliability Features

- **Retry with backoff**: transient errors (429, 500, 502, 503) are retried up to 2 times with exponential backoff
- **Rate limiting**: Bottleneck-based concurrency and rate control prevents overwhelming the API
- **Batch fallback**: if the LLM returns a malformed batch response, texts are automatically re-sent one-at-a-time
- **HTTP keep-alive heartbeat**: `POST /translate/entity` writes periodic heartbeat bytes to the response stream, preventing reverse proxy timeouts (Heroku 30s, AWS ALB 60s) during slow LLM calls. This is transparent to all providers — fast providers like DeepL complete before any heartbeat fires

### Format Support

The provider handles all format types natively:

| Format | How it works |
|--------|-------------|
| `plain` | Direct text translation |
| `markdown` | LLM preserves all Markdown syntax (headings, lists, links, code blocks) |
| `html` | LLM preserves HTML tags and attributes, translates only text content |
| `jsonb` (Blocks) | Converted to HTML before translation, converted back after — same as other providers |

---

## Tiered Dependency UI for Batch Translation

When batch-translating, content types that reference other localized content types can lose relations if the referenced type hasn't been translated yet. This fork groups content types into **dependency tiers**:

- **Tier 0**: content types with no localized dependencies — translate these first
- **Tier 1+**: content types that depend on lower tiers — translate after their dependencies
- **Circular**: mutually dependent content types are flagged with a warning

This ordering is displayed in the batch translation admin UI with clear tier headers, so users know what to translate first.

---

## Requirements

This plugin requires the following, in order to work correctly:

- Strapi v5 (this plugin is not compatible with v3, for v4 use the 1.x releases)
  - Plugin tested for `v5.6` to `v5.8`
- The plugin **i18n** installed and enabled (`@strapi/i18n` [[npm](https://www.npmjs.com/package/@strapi/i18n)])
  - This should be enabled by default in strapi v5
- The content type to have internationalization enabled (advanced settings in the content type builder)
- In the internationalization settings at least **two** locales
- A translation provider that executes the actual translation (see [Configuration](#configuration))

Unless you have the previous set up, the field on the right where you can translate will not show up. Also it will not show up when editing the currently only available translation of an entry.

## Installation

```bash
# with npm
$ npm install strapi-plugin-translate
# or with yarn
$ yarn add strapi-plugin-translate
```

Then install a translation provider:

```bash
# OpenRouter LLM provider (this fork)
$ npm install strapi-provider-translate-openrouter

# Or DeepL
$ npm install strapi-provider-translate-deepl

# Or LibreTranslate
$ npm install strapi-provider-translate-libretranslate
```

After successful installation you have to build a fresh package that includes plugin UI:

```bash
# with npm
$ npm run build && npm run develop
# or with yarn
$ yarn build && yarn develop
```

## Configuration

### Overall plugin configuration

> The overall plugin configuration is done through `config[/env]/plugins.js` or environment variables

```js
module.exports = {
  // ...
  translate: {
    enabled: true,
    config: {
      // Add the name of your provider here (for example 'deepl' for strapi-provider-translate-deepl or the full package name)
      provider: '[name]',
      providerOptions: {
        // Your provider might define some custom options like an apiKey
      },
      // Which field types are translated (default string, text, richtext, components and dynamiczones)
      // Either string or object with type and format
      // Possible formats: plain, markdown, html, jsonb (default plain)
      translatedFieldTypes: [
        'string',
        { type: 'blocks', format: 'jsonb' },
        { type: 'text', format: 'plain' },
        { type: 'richtext', format: 'markdown' },
        'component',
        'dynamiczone',
      ],
      // If relations should be translated (default true)
      translateRelations: true,
      // ignore updates for certain content types (default [], i.e. no content types are ignored)
      ignoreUpdatedContentTypes: ['api::category.category'],
      // wether to regenerate uids when batch updating (default false)
      regenerateUids: true,
    },
  },
  // ...
}
```

#### Available providers

- [strapi-provider-translate-openrouter](https://www.npmjs.com/package/strapi-provider-translate-openrouter) — LLM translation via OpenRouter (or any OpenAI-compatible API)
- [strapi-provider-translate-deepl](https://www.npmjs.com/package/strapi-provider-translate-deepl)
- [strapi-provider-translate-libretranslate](https://www.npmjs.com/package/strapi-provider-translate-libretranslate)

### Configure translation of individual fields/attributes

There are two options to configure translation of individual fields. Both are configured either in the Content-Type Builder in the admin interface in development mode, or in the `pluginOptions` property in the schema file.

#### Disable localization completely

This is part of the `i18n`-plugin and available in all field types except `relation`, `uid` under the name `Enable localization for this field`.

Set this value to false, and the field will not be translated. However it will be copied and have the same value for all localizations.

#### Configure behavior of automated translation

For the field types `component`, `dynamiczone`, `media`, `relation`, `richtext`, `string`, `text`, you can additionally configure the behavior when translating automatically under the name `Configure automated translation for this field?`. There are three options:

- `translate`: The field is automatically translated using the provider
- `copy`: The original value of the source localization is copied
- `delete`: The field is let empty after translation

> Relations are again little bit different. The `translate` option works as described [below](#schema-for-translating-relations), the `copy` option only works when the related content type is not localized and is one way or if bothWays is either `manyToOne` or `manyToMany`

> If you have other fields (e.g. custom fields) for which you want to configure the translation, this cannot be done through the Content-Type Builder, but only in the schema file:

```json
{
  "attributes": {
    "customField": {
      "type": "customField",
      "pluginOptions": {
        "translate": {
          "translate": "copy"
        },
        "i18n": {
          "localized": true
        }
      }
    }
  }
}
```

## Features

This plugin allows you to automatically translate content types. This can be done either on a single entity, or for all entities of a content type.

The following features are included:

- Fill in and translate any locale from another already defined locale
- Translation is restricted by permissions to avoid misuse of api quota
- Configure which field types are translated in the [plugin configuration](#configuration)
- Fields that are marked as not localized in the content-type settings will not be translated
- Components and Dynamic zones are translated recursively
- Relations are translated (if enabled in the [configuration](#configuration)) [if possible](#schema-for-translating-relations)

### Translate a single entity

- Open the entity that you want to translate
- Select a different (possibly unconfigured) locale in the `Internationalization` section on the right sidebar
- Click the link for `Translate from another locale` in the `Translate` section on the right sidebar
- Select the desired source to translate from
- Press the confirmation button

### Translate all entities of a content type

![Batch translation showcase](https://raw.githubusercontent.com/Fekide/strapi-plugin-translate/HEAD/assets/batch-translation.gif)

- Open the Translate plugin section in the left menu
- You now see an overview of all localized content types, grouped by dependency tier
- For each language and each content type you have 4 actions: `translate`, `cancel`, `pause` and `resume`. Most actions are disabled, since no job is running.
- Translate tier 0 (independent) content types first, then tier 1+, to ensure relations resolve correctly
- Press the `translate` button, select the source locale and if already published entries should be published as well (Auto-Publish option)
- Start the translation.

Additional remarks:

- If a batch translation is running and the server is stopped, the translation will be resumed on a restart
- If entities are added after the starting the translation, they will not be translated
- UIDs are automatically translated in batch translation mode, since otherwise the entities could not be created/published
- If an error occurs, this will be shown in the logs or the message can be accessed by hovering over the `Job failed` badge

### Retranslating updated entities

If a localized entity is updated, an entry is added to the batch update section of the admin page. This allows easy retranslation of updated entities.
By default, uids will be ignored. You can opt to regenerate them by setting the `translate.config.regenerateUids` key of the plugin options to `true`.
The `translate.config.ignoreUpdatedContentTypes` key of the plugin options can be used to define an array of content types for which such updates should not be recorded.

Note that updates are only considered if they trigger the `afterUpdate` lifecycle hook provided by strapi.

### Schema for translating relations

_The related objects are not translated directly, only the relation itself is translated_

#### the related content type **is localized**

- if a localization of the relation with the targetLocale exists -> it is used
- else the relation is removed

#### the related content type **is not localized**

- the relation goes both ways and would be removed from another object or localization if it was used (the case with oneToOne or oneToMany) -> it is removed
- otherwise the relation is kept

## Permissions

Since RBAC was moved to the community edition in Strapi v4.8.0, permissions for endpoints of direct translation, batch translation and api usage can now be granted to other roles than super admins:

![Permissions for Translate plugin](https://github.com/Fekide/strapi-plugin-deepl/blob/main/assets/permissions.png)

## Creating your own translation provider

A translation provider should have the following:

- be a npm package that starts with `strapi-provider-translate` and then your provider name (for example `google`)
- a main file declared in the package.json, that exports a provider object:

```js
module.exports = {
  provider: 'google',
  name: 'Google',
  /**
   * @param {object} providerOptions all config values in the providerOptions property
   * @param {object} pluginOptions all config values from the plugin
   */
  init(providerOptions = {}, pluginConfig = {}) {
    // Do some setup here

    return {
      /**
       * @param {{
       *  text:string|string[],
       *  sourceLocale: string,
       *  targetLocale: string,
       *  priority: number,
       *  format?: 'plain'|'markdown'|'html'
       * }} options all translate options
       * @returns {string[]} the input text(s) translated
       */
      async translate(options) {
        // Implement translation
      },
      /**
       * @returns {{count: number, limit: number}} count for the number of characters used, limit for how many can be used in the current period
       */
      async usage() {
        // Implement usage
      },
    }
  },
}
```

If your provider has some limits on how many texts or how many bytes can be submitted at once, you can use the `chunks` service to split it:

```js
const { chunks, reduceFunction } = strapi
  .service('plugin::translate.chunks')
  .split(textArray, {
    // max length of arrays
    maxLength: 100,
    // maximum byte size the request should have, if a single text is larger it is split on new lines
    maxByteSize: 1024 * 1000 * 1000,
  })
// The reduceFunction combines the split text array and possibly split texts back together in the right order
return reduceFunction(
  await Promise.all(
    chunks.map(async (texts) => {
      // Execute the translation here
      return providerClient.translateTexts(texts)
    })
  )
)
```

The translate function receives the format of the text as `plain`, `markdown`, `html` or `jsonb` (Blocks Content Type). If your translation provider supports only html, but no markdown, you can use the `format` service to change the format before translating to `html` and afterwards back to `markdown`. Similarly you can convert `jsonb` to `html`:

```js
const { markdownToHtml, htmlToMarkdown, blocksToHtml, htmlToBlocks } = strapi.service(
  'plugin::translate.format'
)

if (format === 'markdown') {
  return htmlToMarkdown(providerClient.translateTexts(markdownToHtml(text)))
}

if (format === 'jsonb') {
  return htmlToBlocks(providerClient.translateTexts(blocksToHtml(text)))
}

return providerClient.translateTexts(texts)
```

## Limitations

- The translation of Markdown and HTML may vary between different providers
- Relations that do not have a translation of the desired locale will not be translated. To keep the relation you will need to translate both in succession (use the tiered batch translation UI to translate in the correct order)
- LLM translation costs vary by model and text volume — monitor usage via the admin UI or OpenRouter dashboard

## Credits

This fork is based on [strapi-plugin-translate](https://github.com/Fekide/strapi-plugin-translate) by Felix Haase and contributors. The OpenRouter LLM provider and tiered dependency UI were added by Axel Erwast.
