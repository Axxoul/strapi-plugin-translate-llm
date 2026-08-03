import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { registerAutoTranslateMiddleware } from '../auto-translate'

const ARTICLE = 'api::article.article'
const CATEGORY = 'api::category.category' // localized, no draft & publish
const WRITER = 'api::writer.writer' // not localized

const originalStrapi = (global as any).strapi

type Middleware = (context: any, next: () => Promise<any>) => Promise<any>

function setup({
  translateOn = 'save',
  locales = ['sv', 'en', 'de'],
  defaultLocale = 'sv',
  guarded = () => false,
}: {
  translateOn?: string
  locales?: string[]
  defaultLocale?: string
  guarded?: (...args: any[]) => boolean
} = {}) {
  const triggerAutoTranslate = jest.fn(async () => {})
  const handleSourceUnpublish = jest.fn(async () => {})

  const autoTranslate = {
    isGuarded: jest.fn(guarded as any),
    triggerAutoTranslate,
    handleSourceUnpublish,
    getEffectiveSettings: jest.fn(async () => ({ translateOn })),
  }

  let middleware: Middleware

  ;(global as any).strapi = {
    contentTypes: {
      [ARTICLE]: {
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
      },
      [CATEGORY]: {
        options: { draftAndPublish: false },
        pluginOptions: { i18n: { localized: true } },
      },
      [WRITER]: { options: { draftAndPublish: true }, pluginOptions: {} },
    },
    documents: { use: (fn: Middleware) => (middleware = fn) },
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    plugin: jest.fn((name: string) => {
      if (name === 'i18n') {
        return {
          service: () => ({
            find: async () => locales.map((code) => ({ code })),
            getDefaultLocale: async () => defaultLocale,
          }),
        }
      }
      return { service: () => autoTranslate }
    }),
  }

  registerAutoTranslateMiddleware((global as any).strapi)

  const run = (context: any, result: any = {}) =>
    middleware!(context, async () => result)

  return { run, autoTranslate, triggerAutoTranslate, handleSourceUnpublish }
}

const triggeredLocales = (mock: any) =>
  mock.mock.calls.map((c: any[]) => c[2]).sort()

afterEach(() => {
  jest.clearAllMocks()
  ;(global as any).strapi = originalStrapi
})

describe('locale resolution', () => {
  it('a publish with no locale falls back to the i18n default', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run(
      { action: 'publish', contentType: ARTICLE, params: { documentId: 'a1' } },
      { documentId: 'a1', entries: [] }
    )

    expect(triggerAutoTranslate).toHaveBeenCalledWith(ARTICLE, 'a1', 'sv', true)
  })

  it("locale: '*' expands to every configured locale", async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'publish',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: '*' },
    })

    expect(triggeredLocales(triggerAutoTranslate)).toEqual(['de', 'en', 'sv'])
  })

  it('an array of locales triggers once per element', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'publish',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: ['sv', 'de'] },
    })

    expect(triggeredLocales(triggerAutoTranslate)).toEqual(['de', 'sv'])
  })

  it('deduplicates an array that also contains a wildcard', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'publish',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: ['sv', '*'] },
    })

    expect(triggeredLocales(triggerAutoTranslate)).toEqual(['de', 'en', 'sv'])
  })

  it('falls back to the result locale when params has none', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run(
      { action: 'update', contentType: ARTICLE, params: { documentId: 'a1' } },
      { documentId: 'a1', locale: 'de' }
    )

    expect(triggerAutoTranslate).toHaveBeenCalledWith(ARTICLE, 'a1', 'de', false)
  })
})

describe('publishedNow', () => {
  it("update({ status: 'published' }) counts as a publish", async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'update',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv', status: 'published' },
    })

    expect(triggerAutoTranslate).toHaveBeenCalledWith(ARTICLE, 'a1', 'sv', true)
  })

  it("create({ status: 'published' }) counts as a publish", async () => {
    const { run, triggerAutoTranslate } = setup()

    await run(
      {
        action: 'create',
        contentType: ARTICLE,
        params: { locale: 'sv', status: 'published' },
      },
      { documentId: 'a1', locale: 'sv' }
    )

    expect(triggerAutoTranslate).toHaveBeenCalledWith(ARTICLE, 'a1', 'sv', true)
  })

  it('a plain draft save does not', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'update',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).toHaveBeenCalledWith(ARTICLE, 'a1', 'sv', false)
  })
})

describe("translateOn: 'publish'", () => {
  it('ignores a draft save of a draft-and-publish type', async () => {
    const { run, triggerAutoTranslate } = setup({ translateOn: 'publish' })

    await run({
      action: 'update',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).not.toHaveBeenCalled()
  })

  it('fires on publish', async () => {
    const { run, triggerAutoTranslate } = setup({ translateOn: 'publish' })

    await run({
      action: 'publish',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).toHaveBeenCalledWith(ARTICLE, 'a1', 'sv', true)
  })

  it('still fires on save for a type without draft & publish — save is publish there', async () => {
    const { run, triggerAutoTranslate } = setup({ translateOn: 'publish' })

    await run({
      action: 'update',
      contentType: CATEGORY,
      params: { documentId: 'c1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).toHaveBeenCalledWith(CATEGORY, 'c1', 'sv', false)
  })
})

describe('unpublish', () => {
  it('routes to the unpublish handler, not to a translation', async () => {
    const { run, triggerAutoTranslate, handleSourceUnpublish } = setup()

    await run({
      action: 'unpublish',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
    })

    expect(handleSourceUnpublish).toHaveBeenCalledWith(ARTICLE, 'a1', 'sv')
    expect(triggerAutoTranslate).not.toHaveBeenCalled()
  })

  it('respects the guard, so the plugin cannot unpublish its own writes in a loop', async () => {
    const { run, handleSourceUnpublish } = setup({ guarded: () => true })

    await run({
      action: 'unpublish',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
    })

    expect(handleSourceUnpublish).not.toHaveBeenCalled()
  })
})

describe('what the middleware ignores', () => {
  it.each([
    ['delete', { action: 'delete' }],
    ['discardDraft', { action: 'discardDraft' }],
  ])('%s', async (_name, override) => {
    const { run, triggerAutoTranslate, handleSourceUnpublish } = setup()

    await run({
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
      ...override,
    })

    expect(triggerAutoTranslate).not.toHaveBeenCalled()
    expect(handleSourceUnpublish).not.toHaveBeenCalled()
  })

  it('non-localized content types', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'update',
      contentType: WRITER,
      params: { documentId: 'w1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).not.toHaveBeenCalled()
  })

  it('its own content types', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({
      action: 'update',
      contentType: 'plugin::translate.auto-translate-log',
      params: { documentId: 'l1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).not.toHaveBeenCalled()
  })

  it('guarded writes', async () => {
    const { run, triggerAutoTranslate } = setup({ guarded: () => true })

    await run({
      action: 'update',
      contentType: ARTICLE,
      params: { documentId: 'a1', locale: 'sv' },
    })

    expect(triggerAutoTranslate).not.toHaveBeenCalled()
  })

  it('calls that carry no documentId', async () => {
    const { run, triggerAutoTranslate } = setup()

    await run({ action: 'update', contentType: ARTICLE, params: { locale: 'sv' } })

    expect(triggerAutoTranslate).not.toHaveBeenCalled()
  })
})

describe('the middleware never breaks the write it wraps', () => {
  it('returns the downstream result unchanged', async () => {
    const { run } = setup()
    const result = { documentId: 'a1', locale: 'sv' }

    await expect(
      run(
        { action: 'update', contentType: ARTICLE, params: { documentId: 'a1' } },
        result
      )
    ).resolves.toBe(result)
  })

  it('swallows a trigger that rejects', async () => {
    const { run, triggerAutoTranslate } = setup()
    triggerAutoTranslate.mockRejectedValue(new Error('boom') as never)

    await expect(
      run({
        action: 'update',
        contentType: ARTICLE,
        params: { documentId: 'a1', locale: 'sv' },
      })
    ).resolves.toBeDefined()
  })
})
