import { afterEach, describe, expect, it, jest } from '@jest/globals'
import {
  createHarness,
  HarnessOptions,
  restoreStrapi,
} from '../../__mocks__/auto-translate-harness'

jest.mock('../../utils/related-documents', () => ({
  getRelatedDocuments: jest.fn(async () => []),
  collectRelationRefs: jest.fn(),
}))

jest.mock('../../utils/tier-map', () => ({
  getTierMap: jest.fn(() => new Map<string, number>()),
  clearTierMapCache: jest.fn(),
}))

const originalStrapi = (global as any).strapi

const ARTICLE = 'api::article.article'
const CATEGORY = 'api::category.category'

/** Wires the real auto-translate + batch-changed services onto a fresh harness. */
function load(options: HarnessOptions = {}, tiers: Record<string, number> = {}) {
  jest.resetModules()
  const harness = createHarness(options)

  const tierMap = require('../../utils/tier-map')
  tierMap.getTierMap.mockReturnValue(new Map(Object.entries(tiers)))

  const autoTranslate = require('../auto-translate').default({ strapi: harness.strapi })
  harness.strapi.__autoTranslate = autoTranslate

  const createFailure = jest.fn(async () => {})
  harness.strapi.__batchTranslateLog = { createFailure }

  const service = require('../batch-changed').default({ strapi: harness.strapi })
  harness.strapi.__batchChanged = service

  return { ...harness, service, autoTranslate, createFailure }
}

afterEach(() => {
  jest.clearAllMocks()
  restoreStrapi(originalStrapi)
})

describe('queueChanged', () => {
  it('enqueues rows in ascending tier order and starts the queue', async () => {
    const { service, autoTranslate, rows } = load(
      {
        contentTypes: {
          [ARTICLE]: {
            localizations: { sv: ['a1'] },
            updatedAt: { a1: '2026-01-02T00:00:00.000Z' },
          },
          [CATEGORY]: {
            localizations: { sv: ['c1'] },
            updatedAt: { c1: '2026-01-02T00:00:00.000Z' },
          },
        },
      },
      { [ARTICLE]: 1, [CATEGORY]: 0 } // article depends on category
    )

    const result = await service.queueChanged({
      since: '2026-01-01T00:00:00.000Z',
      sourceLocale: 'sv',
      targetLocale: 'en',
      publishMode: 'draft',
    })

    expect(result.total).toBe(2)
    expect(result.queued).toBe(2)
    // Rows are written in tier order even though "article" sorts first alphabetically.
    expect(rows.map((r) => r.contentType)).toEqual([CATEGORY, ARTICLE])

    await autoTranslate._drainQueue()
    expect(rows.every((r) => r.status === 'success')).toBe(true)
  })
})

describe('publishChanged', () => {
  function loadWithFixture() {
    return load({
      contentTypes: {
        [ARTICLE]: {
          localizations: {
            sv: ['a1', 'a2', 'a3', 'a4'],
            en: ['a1', 'a3', 'a4'], // a2 has no target-locale localization
          },
          published: { sv: ['a3', 'a4'] }, // a1 has no published row
          updatedAt: Object.fromEntries(
            ['a1', 'a2', 'a3', 'a4'].map((id) => [id, '2026-01-02T00:00:00.000Z'])
          ),
        },
      },
    })
  }

  const params = {
    since: '2026-01-01T00:00:00.000Z',
    sourceLocale: 'sv',
    targetLocale: 'en',
  }

  it('skips a source with no published row (mirror) without publishing', async () => {
    const { service, strapi } = loadWithFixture()

    const result = await service.publishChanged(params)

    expect(result.skippedUnpublishedSource).toBeGreaterThanOrEqual(1)
    expect(strapi.documents(ARTICLE).publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'a1' })
    )
  })

  it('skips a document with no target-locale localization', async () => {
    const { service } = loadWithFixture()

    const result = await service.publishChanged(params)

    expect(result.skippedNoTarget).toBe(1)
  })

  it('logs a thrown publish via batch-translate-log without aborting the loop', async () => {
    const { service, strapi, createFailure } = loadWithFixture()
    strapi.documents(ARTICLE).publish.mockImplementation(
      async ({ documentId, locale }: any) => {
        if (documentId === 'a3') throw new Error('publish boom')
        return { documentId, locale }
      }
    )

    const result = await service.publishChanged(params)

    expect(result.failed).toBe(1)
    expect(result.published).toBe(1) // a4 still gets published after a3 fails
    expect(createFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: ARTICLE,
        entryDocumentId: 'a3',
        error: expect.stringContaining('publish boom'),
      })
    )
  })
})
