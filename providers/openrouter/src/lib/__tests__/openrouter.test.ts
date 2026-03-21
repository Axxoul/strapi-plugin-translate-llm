import { http, HttpResponse, HttpResponseResolver, PathParams } from 'msw'
import { SetupServer } from 'msw/node'
import {
  InitializedProvider,
  TranslateProviderTranslationArguments,
} from 'strapi-plugin-translate-llm/shared'

import { OPENROUTER_API_URL } from '../constants'
import provider from '../'
import { getServer } from '../../__mocks__/server'
import setup from '../../__mocks__/initStrapi'

const testApiUrl = OPENROUTER_API_URL

function makeChatHandler(
  transformText: (text: string) => string = (t) => t
): HttpResponseResolver<PathParams> {
  return async ({ request }) => {
    const body = (await request.json()) as {
      model?: string
      messages?: { role: string; content: string }[]
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.includes('test-key')) {
      return HttpResponse.json(
        { error: { message: 'Invalid API key' } },
        { status: 401 }
      )
    }

    const userMessage = body.messages?.find((m) => m.role === 'user')
    if (!userMessage) {
      return HttpResponse.json(
        { error: { message: 'No user message' } },
        { status: 400 }
      )
    }

    let texts: string[]
    try {
      const parsed = JSON.parse(userMessage.content)
      texts = parsed.texts
    } catch {
      return HttpResponse.json(
        { error: { message: 'Invalid user message format' } },
        { status: 400 }
      )
    }

    const translations = texts.map(transformText)

    return HttpResponse.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ translations }),
          },
        },
      ],
    })
  }
}

describe('openrouter provider', () => {
  let server: SetupServer

  beforeAll(async () => {
    server = getServer()
    await setup()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  describe('translate', () => {
    beforeEach(() => {
      server.use(
        http.post(`${testApiUrl}/chat/completions`, makeChatHandler())
      )
    })

    describe('succeeds', () => {
      let openrouterProvider: InitializedProvider

      beforeAll(() => {
        openrouterProvider = provider.init({
          apiKey: 'test-key',
          model: 'anthropic/claude-sonnet-4',
        })
      })

      it('with single text', async () => {
        const params = {
          sourceLocale: 'en',
          targetLocale: 'de',
          text: 'Some text',
        }
        const result = await openrouterProvider.translate(params)
        expect(result).toEqual([params.text])
      })

      it('with multiple texts', async () => {
        const params = {
          sourceLocale: 'en',
          targetLocale: 'de',
          text: ['Some text', 'Some more text', 'Even more text'],
        }
        const result = await openrouterProvider.translate(params)
        expect(result).toEqual(params.text)
      })

      it('with missing text', async () => {
        const params = {
          sourceLocale: 'en',
          targetLocale: 'de',
        } as any
        const result = await openrouterProvider.translate(params)
        expect(result).toEqual([])
      })

      it('with markdown texts', async () => {
        const params: TranslateProviderTranslationArguments = {
          sourceLocale: 'en',
          targetLocale: 'de',
          text: [
            '# Heading\n\nSome text',
            '## Subheading\n\nSome more text',
          ],
          format: 'markdown',
        }
        const result = await openrouterProvider.translate(params)
        // Markdown is sent as-is to the LLM (no conversion)
        expect(result).toEqual(params.text)
      })

      it('with html texts', async () => {
        const params: TranslateProviderTranslationArguments = {
          sourceLocale: 'en',
          targetLocale: 'de',
          text: [
            '<p>Hello <strong>world</strong></p>',
            '<a href="https://example.com">Click here</a>',
          ],
          format: 'html',
        }
        const result = await openrouterProvider.translate(params)
        // HTML is sent as-is to the LLM (no conversion)
        expect(result).toEqual(params.text)
      })

      it('with more than maxTextsPerRequest texts', async () => {
        const textLength = 50
        const params = {
          sourceLocale: 'en',
          targetLocale: 'de',
          text: Array.from({ length: textLength }, (_v, i) => `text ${i}`),
        }
        const result = await openrouterProvider.translate(params)
        expect(result).toEqual(params.text)
      })
    })

    describe('fails', () => {
      it('with missing target language', async () => {
        const openrouterProvider = provider.init({
          apiKey: 'test-key',
          model: 'anthropic/claude-sonnet-4',
        })
        const params = {
          text: 'Some text',
        } as any
        await expect(
          async () => openrouterProvider.translate(params)
        ).rejects.toThrow('source and target locale must be defined')
      })

      it('with invalid api key', async () => {
        const openrouterProvider = provider.init({
          apiKey: 'invalid-key',
          model: 'anthropic/claude-sonnet-4',
        })
        const params = {
          sourceLocale: 'en',
          targetLocale: 'de',
          text: 'Some text',
        }
        await expect(
          async () => openrouterProvider.translate(params)
        ).rejects.toThrow()
      })
    })
  })

  describe('locale mapping', () => {
    it('uses localeMap for locale names in prompts', async () => {
      let capturedSystemPrompt = ''
      server.use(
        http.post(`${testApiUrl}/chat/completions`, async ({ request }) => {
          const body = (await request.json()) as {
            messages?: { role: string; content: string }[]
          }
          const systemMessage = body.messages?.find(
            (m) => m.role === 'system'
          )
          capturedSystemPrompt = systemMessage?.content || ''

          const userMessage = body.messages?.find((m) => m.role === 'user')
          const { texts } = JSON.parse(userMessage!.content)

          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({ translations: texts }),
                },
              },
            ],
          })
        })
      )

      const openrouterProvider = provider.init({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-4',
        localeMap: {
          nb: 'Norwegian Bokmal',
        },
      })

      await openrouterProvider.translate({
        sourceLocale: 'en',
        targetLocale: 'nb',
        text: 'Hello',
      })

      expect(capturedSystemPrompt).toContain('Norwegian Bokmal')
    })
  })

  describe('custom prompt', () => {
    it('includes custom prompt in system message', async () => {
      let capturedSystemPrompt = ''
      server.use(
        http.post(`${testApiUrl}/chat/completions`, async ({ request }) => {
          const body = (await request.json()) as {
            messages?: { role: string; content: string }[]
          }
          const systemMessage = body.messages?.find(
            (m) => m.role === 'system'
          )
          capturedSystemPrompt = systemMessage?.content || ''

          const userMessage = body.messages?.find((m) => m.role === 'user')
          const { texts } = JSON.parse(userMessage!.content)

          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({ translations: texts }),
                },
              },
            ],
          })
        })
      )

      const openrouterProvider = provider.init({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-4',
        customPrompt: 'Do not translate brand names like "EpicTrails".',
      })

      await openrouterProvider.translate({
        sourceLocale: 'en',
        targetLocale: 'de',
        text: 'Visit EpicTrails today',
      })

      expect(capturedSystemPrompt).toContain(
        'Do not translate brand names like "EpicTrails".'
      )
    })
  })

  describe('fallback on malformed response', () => {
    it('falls back to one-at-a-time when batch response count mismatches', async () => {
      let callCount = 0
      server.use(
        http.post(`${testApiUrl}/chat/completions`, async ({ request }) => {
          callCount++
          const body = (await request.json()) as {
            messages?: { role: string; content: string }[]
          }
          const authHeader = request.headers.get('authorization')
          if (!authHeader || !authHeader.includes('test-key')) {
            return HttpResponse.json(
              { error: { message: 'Invalid API key' } },
              { status: 401 }
            )
          }

          const userMessage = body.messages?.find((m) => m.role === 'user')
          const { texts } = JSON.parse(userMessage!.content)

          // First call (batch): return wrong count to trigger fallback
          if (texts.length > 1) {
            return HttpResponse.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      translations: ['only one'],
                    }),
                  },
                },
              ],
            })
          }

          // Individual calls: return correctly
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translations: [texts[0]],
                  }),
                },
              },
            ],
          })
        })
      )

      const openrouterProvider = provider.init({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-4',
      })

      const params = {
        sourceLocale: 'en',
        targetLocale: 'de',
        text: ['Text 1', 'Text 2'],
      }
      const result = await openrouterProvider.translate(params)
      expect(result).toEqual(params.text)
      // 1 batch call + 2 individual fallback calls = 3
      expect(callCount).toBe(3)
    })
  })

  describe('setup', () => {
    describe('provider options', () => {
      it('uses api key from provider options', () => {
        const openrouterProvider = provider.init({
          apiKey: 'test-key',
          model: 'anthropic/claude-sonnet-4',
        })
        expect(openrouterProvider).toBeDefined()
        expect(openrouterProvider.translate).toBeDefined()
        expect(openrouterProvider.usage).toBeDefined()
      })

      it('uses env var api key', () => {
        process.env.OPENROUTER_API_KEY = 'env-test-key'
        const openrouterProvider = provider.init({
          model: 'anthropic/claude-sonnet-4',
        })
        expect(openrouterProvider).toBeDefined()
        delete process.env.OPENROUTER_API_KEY
      })

      it('uses env var api url', () => {
        process.env.OPENROUTER_API_URL = 'https://custom.api.com/v1'
        const openrouterProvider = provider.init({
          apiKey: 'test-key',
          model: 'anthropic/claude-sonnet-4',
        })
        expect(openrouterProvider).toBeDefined()
        delete process.env.OPENROUTER_API_URL
      })
    })
  })

  describe('usage', () => {
    it('returns usage data when available', async () => {
      server.use(
        http.get(`${testApiUrl}/auth/key`, ({ request }) => {
          const authHeader = request.headers.get('authorization')
          if (!authHeader || !authHeader.includes('test-key')) {
            return HttpResponse.json(
              { error: 'Unauthorized' },
              { status: 401 }
            )
          }
          return HttpResponse.json({
            data: {
              usage: 1500,
              limit: 10000,
            },
          })
        })
      )

      const openrouterProvider = provider.init({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-4',
      })

      const result = await openrouterProvider.usage()
      expect(result).toEqual({
        count: 1500,
        limit: 10000,
      })
    })

    it('returns undefined when usage endpoint fails', async () => {
      server.use(
        http.get(`${testApiUrl}/auth/key`, () => {
          return new HttpResponse(null, { status: 500 })
        })
      )

      const openrouterProvider = provider.init({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-4',
      })

      const result = await openrouterProvider.usage()
      expect(result).toBeUndefined()
    })
  })
})
