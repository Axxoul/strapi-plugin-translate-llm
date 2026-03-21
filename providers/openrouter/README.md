# OpenRouter LLM provider for Strapi Translate Plugin

Translate your Strapi content using any LLM via [OpenRouter](https://openrouter.ai) or any OpenAI-compatible API (OpenAI, Ollama, LM Studio, etc.).

This provider is part of [strapi-plugin-translate-llm](https://github.com/Axxoul/strapi-plugin-translate-llm).

## Installation

```bash
npm install strapi-plugin-translate-llm strapi-provider-translate-openrouter
```

## Configuration

Configure the provider through the plugin options in `config/plugins.js`:

```js
module.exports = ({ env }) => ({
  // ...
  translate: {
    enabled: true,
    config: {
      provider: 'openrouter',
      providerOptions: {
        // Your API key - required (or set OPENROUTER_API_KEY env var)
        apiKey: env('OPENROUTER_API_KEY'),
        // Model to use (default: 'anthropic/claude-sonnet-4')
        model: 'anthropic/claude-sonnet-4',
        // Temperature: 0.1-0.3 = literal, 0.5-0.7 = creative (default: 0.3)
        temperature: 0.3,
        // Custom instructions appended to the translation prompt
        customPrompt: 'Keep "MyBrand" untranslated. Use informal register.',
        // Map Strapi locale codes to human-readable language names
        localeMap: {
          en: 'English',
          fr: 'French',
          sv: 'Swedish',
        },
        // Use a different OpenAI-compatible API (default: 'https://openrouter.ai/api/v1')
        // apiUrl: 'https://api.openai.com/v1',
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
  // ...
})
```

Or use the default environment variables:

- `OPENROUTER_API_KEY` - required, your OpenRouter API key
- `OPENROUTER_API_URL` - optional, override the API endpoint

To get an API key, register at [openrouter.ai/keys](https://openrouter.ai/keys).

## Provider Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `OPENROUTER_API_KEY` env var | **Required.** API key |
| `model` | `string` | `anthropic/claude-sonnet-4` | Any [OpenRouter model](https://openrouter.ai/models) |
| `temperature` | `number` | `0.3` | Controls translation creativity |
| `customPrompt` | `string` | — | Additional translation instructions |
| `localeMap` | `object` | `{}` | Maps locale codes to language names |
| `maxTextsPerRequest` | `number` | `20` | Max texts batched per LLM call |
| `maxConcurrent` | `number` | `3` | Max parallel API requests |
| `apiUrl` | `string` | `https://openrouter.ai/api/v1` | API endpoint URL |

## Recommended Models

| Model | Best for | Approximate cost |
|-------|----------|-----------------|
| `anthropic/claude-sonnet-4` | Best quality/cost balance | ~$3/1M tokens |
| `anthropic/claude-haiku-4-5` | Fast, cheap, simple content | ~$0.80/1M tokens |
| `google/gemini-2.5-flash` | Very cheap, fast | ~$0.15/1M tokens |
| `openai/gpt-4o` | Strong alternative | ~$2.50/1M tokens |
| `openai/gpt-4o-mini` | Budget option | ~$0.15/1M tokens |

## Using Other OpenAI-Compatible APIs

The provider uses the OpenAI SDK internally, so it works with any compatible endpoint:

```js
// OpenAI directly
providerOptions: {
  apiKey: env('OPENAI_API_KEY'),
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
}

// Local Ollama
providerOptions: {
  apiKey: 'ollama',
  apiUrl: 'http://localhost:11434/v1',
  model: 'llama3',
}
```

## Custom Prompt

The `customPrompt` option appends additional instructions to the system prompt. The base prompt already handles format preservation (HTML tags, Markdown syntax, JSON structure), so focus on domain-specific rules:

```js
// Preserve brand names
customPrompt: 'Keep "UCPA" and "MyBrand" untranslated.'

// Control tone
customPrompt: 'Use informal "du" in Swedish, not "ni".'

// Combine rules
customPrompt: `
  Keep "UCPA" untranslated.
  Use informal register in all languages.
  Translate ski terminology naturally for the target audience.
`
```

## Reliability

- **Retry with backoff** — transient errors (429, 500, 502, 503) are retried up to 2 times with exponential backoff
- **Rate limiting** — Bottleneck-based concurrency control prevents overwhelming the API
- **Batch fallback** — if the LLM returns a malformed batch response, texts are automatically re-sent one at a time
- **HTTP keep-alive** — the plugin writes periodic heartbeat bytes during slow translations, preventing reverse proxy timeouts (Heroku 30s, AWS ALB 60s)

## Supported Formats

| Format | How it works |
|--------|-------------|
| `plain` | Direct text translation |
| `markdown` | LLM preserves all Markdown syntax |
| `html` | LLM preserves HTML tags and attributes, translates only text content |
| `jsonb` (Blocks) | Converted to HTML before translation, converted back after |

## Limitations

- LLM translation costs vary by model and text volume — monitor usage via the admin UI or your OpenRouter dashboard
- Translation quality depends on the chosen model; larger models produce better results for nuanced content
- Very long texts may be split into chunks, which can occasionally affect cross-paragraph context
