import OpenAI from 'openai'
import Bottleneck from 'bottleneck'
import { TranslateProvider } from 'strapi-plugin-translate-llm/shared'

import {
  OPENROUTER_API_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_TEMPERATURE,
  OPENROUTER_DEFAULT_MAX_TEXTS_PER_REQUEST,
  OPENROUTER_DEFAULT_MAX_CONCURRENT,
  OPENROUTER_ROUGH_MAX_REQUEST_SIZE,
  OPENROUTER_PRIORITY_DEFAULT,
} from './constants'
import { buildSystemPrompt } from './prompt'
import { getService } from './get-service'
import { withRetry } from './retry'

export type OpenRouterProviderOptions = {
  apiKey?: string
  model?: string
  customPrompt?: string
  localeMap?: Record<string, string>
  maxConcurrent?: number
  maxTextsPerRequest?: number
  temperature?: number
  apiUrl?: string
}

function resolveLocaleName(
  locale: string,
  localeMap: Record<string, string>
): string {
  return localeMap[locale] || locale
}

function parseTranslations(
  content: string,
  expectedCount: number
): string[] | null {
  try {
    const parsed = JSON.parse(content)
    const translations: string[] = parsed.translations
    if (Array.isArray(translations) && translations.length === expectedCount) {
      return translations
    }
    return null
  } catch {
    return null
  }
}

export default {
  provider: 'openrouter',
  name: 'OpenRouter',

  init(providerOptions: OpenRouterProviderOptions = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY || providerOptions.apiKey
    if (!apiKey) {
      throw new Error(
        'OpenRouter API key is required. Set OPENROUTER_API_KEY env var or pass apiKey in providerOptions.'
      )
    }
    const model = providerOptions.model || OPENROUTER_DEFAULT_MODEL
    const temperature =
      providerOptions.temperature ?? OPENROUTER_DEFAULT_TEMPERATURE
    const customPrompt = providerOptions.customPrompt || undefined
    const localeMap =
      typeof providerOptions.localeMap === 'object'
        ? providerOptions.localeMap
        : {}
    const maxTextsPerRequest =
      providerOptions.maxTextsPerRequest ||
      OPENROUTER_DEFAULT_MAX_TEXTS_PER_REQUEST
    const maxConcurrent =
      providerOptions.maxConcurrent || OPENROUTER_DEFAULT_MAX_CONCURRENT
    const apiUrl =
      process.env.OPENROUTER_API_URL ||
      providerOptions.apiUrl ||
      OPENROUTER_API_URL

    const client = new OpenAI({
      apiKey,
      baseURL: apiUrl,
    })

    const limiter = new Bottleneck({
      minTime: process.env.NODE_ENV == 'test' ? 10 : 500,
      maxConcurrent,
    })

    async function callLLM(
      texts: string[],
      sourceLocale: string,
      targetLocale: string,
      format: string,
      chunkMaxLengths?: (number | undefined)[]
    ): Promise<string[]> {
      const hasMaxLengths = chunkMaxLengths?.some((ml) => ml != null)
      const systemPrompt = buildSystemPrompt(
        resolveLocaleName(sourceLocale, localeMap),
        resolveLocaleName(targetLocale, localeMap),
        format as any,
        customPrompt,
        hasMaxLengths
      )

      const userPayload: Record<string, unknown> = { texts }
      if (hasMaxLengths) {
        userPayload.maxLengths = chunkMaxLengths
      }
      const userMessage = JSON.stringify(userPayload)

      const response = await withRetry(() =>
        client.chat.completions.create({
          model,
          temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        })
      )

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('OpenRouter returned empty response')
      }

      const translations = parseTranslations(content, texts.length)
      if (translations) {
        return translations
      }

      // Fallback: one-at-a-time if batch response was malformed
      if (texts.length === 1) {
        throw new Error(
          `Failed to parse translation response: ${content.substring(0, 200)}`
        )
      }

      const results: string[] = []
      for (const text of texts) {
        const singleResponse = await withRetry(() =>
          client.chat.completions.create({
            model,
            temperature,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: JSON.stringify({ texts: [text] }) },
            ],
          })
        )

        const singleContent = singleResponse.choices[0]?.message?.content
        if (!singleContent) {
          throw new Error('OpenRouter returned empty response for single text')
        }

        const singleTranslations = parseTranslations(singleContent, 1)
        if (!singleTranslations) {
          throw new Error(
            `Failed to parse single translation response: ${singleContent.substring(0, 200)}`
          )
        }
        results.push(singleTranslations[0])
      }
      return results
    }

    const rateLimitedCallLLM = limiter.wrap(callLLM)

    return {
      async translate({
        text,
        priority,
        sourceLocale,
        targetLocale,
        format,
        maxLengths,
      }) {
        if (!text) {
          return []
        }
        if (!sourceLocale || !targetLocale) {
          throw new Error('source and target locale must be defined')
        }

        const chunksService = getService('chunks')
        const formatService = getService('format')

        const effectiveFormat = format || 'plain'

        let input: string | string[]
        if (typeof text === 'string' || typeof text[0] === 'string') {
          input = text as string | string[]
        } else {
          if (effectiveFormat === 'jsonb') {
            input = await formatService.blockToHtml(
              text as Parameters<typeof formatService.blockToHtml>[0]
            )
          } else {
            throw new Error(
              `Unsupported format ${effectiveFormat} with non text/text-array input ${typeof text}`
            )
          }
        }

        // For jsonb format, content is already converted to HTML above.
        // For markdown/html/plain, LLMs handle them natively — no conversion needed.

        const textArray = Array.isArray(input) ? input : [input]

        const { chunks, reduceFunction } = chunksService.split(textArray, {
          maxLength: maxTextsPerRequest,
          maxByteSize: OPENROUTER_ROUGH_MAX_REQUEST_SIZE,
        })

        // Split maxLengths in parallel with text chunks
        let maxLengthChunks: ((number | undefined)[] | undefined)[] | undefined
        if (maxLengths?.length) {
          maxLengthChunks = []
          let offset = 0
          for (const chunk of chunks) {
            maxLengthChunks.push(maxLengths.slice(offset, offset + chunk.length))
            offset += chunk.length
          }
        }

        const result = reduceFunction(
          await Promise.all(
            chunks.map((texts: string[], chunkIndex: number) =>
              rateLimitedCallLLM.withOptions(
                {
                  priority:
                    typeof priority == 'number'
                      ? priority
                      : OPENROUTER_PRIORITY_DEFAULT,
                },
                texts,
                sourceLocale,
                targetLocale,
                effectiveFormat,
                maxLengthChunks?.[chunkIndex]
              )
            )
          )
        )

        if (effectiveFormat === 'jsonb') {
          return formatService.htmlToBlock(result)
        }

        return result
      },

      async usage() {
        try {
          const response = await fetch(`${apiUrl}/auth/key`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          })
          if (!response.ok) {
            return undefined as any
          }
          const data = (await response.json()) as {
            data?: {
              usage?: number
              limit?: number
              limit_remaining?: number
            }
          }
          if (data.data) {
            return {
              count: data.data.usage ?? 0,
              limit: data.data.limit ?? 0,
            }
          }
          return undefined as any
        } catch {
          return undefined as any
        }
      },
    }
  },
} satisfies TranslateProvider<OpenRouterProviderOptions>
