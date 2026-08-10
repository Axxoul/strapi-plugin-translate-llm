import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
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
const TAG = 'api::tag.tag'

const enabled = { enabled: true, masterLocale: 'sv' }

/**
 * The service keeps module-level state (guard, in-flight set, drain flag), so
 * every test gets a freshly required copy alongside a fresh fake Strapi.
 */
function load(options: HarnessOptions = {}) {
  jest.resetModules()
  const harness = createHarness({
    ...options,
    contentTypes: {
      [ARTICLE]: { localizations: { sv: ['a1'] } },
      [CATEGORY]: { localizations: { sv: ['c1'] } },
      [TAG]: { localizations: { sv: ['t1'] } },
      ...(options.contentTypes ?? {}),
    },
  })

  const related = require('../../utils/related-documents')
  const tierMap = require('../../utils/tier-map')
  const service = require('../auto-translate').default({
    strapi: harness.strapi,
  })
  harness.strapi.__autoTranslate = service

  related.getRelatedDocuments.mockImplementation(
    async (uid: string, documentId: string) =>
      (options.relations ?? {})[`${uid}:${documentId}`] ?? []
  )

  return { ...harness, service, tierMap }
}

function setTiers(tierMap: any, tiers: Record<string, number>) {
  tierMap.getTierMap.mockReturnValue(new Map(Object.entries(tiers)))
}

afterEach(() => {
  jest.clearAllMocks()
  restoreStrapi(originalStrapi)
})

describe('auto-translate settings', () => {
  it('falls back to the file config when nothing is stored', async () => {
    const { service } = load({ config: { translateOn: 'publish', cascade: 'missing-only' } })

    const settings = await service.getEffectiveSettings()

    expect(settings.translateOn).toBe('publish')
    expect(settings.cascade).toBe('missing-only')
    expect(settings.enabled).toBe(false)
  })

  it('lets the store override the file config', async () => {
    const { service } = load({
      config: { translateOn: 'save' },
      settings: { ...enabled, translateOn: 'publish' },
    })

    await expect(service.getEffectiveSettings()).resolves.toMatchObject({
      translateOn: 'publish',
      enabled: true,
      masterLocale: 'sv',
    })
  })

  it('ignores unset and invalid stored values instead of trusting them', async () => {
    const { service } = load({
      config: { cascadeMaxEntries: 25, autoPublish: 'mirror' },
      settings: { autoPublish: '', cascadeMaxEntries: 0, cascade: 'nonsense' },
    })

    await expect(service.getEffectiveSettings()).resolves.toMatchObject({
      autoPublish: 'mirror',
      cascadeMaxEntries: 25,
      cascade: 'off',
    })
  })

  it('treats an empty locale allowlist as "every locale"', async () => {
    const { service } = load({
      config: { cascadeLocales: null },
      settings: { cascadeLocales: [] },
    })

    await expect(service.getEffectiveSettings()).resolves.toMatchObject({
      cascadeLocales: null,
    })
  })

  it('exposes the file-config defaults next to the effective values', async () => {
    const { service } = load({
      config: { cascadeMaxDepth: 3 },
      settings: { cascadeMaxDepth: 9 },
    })

    const data = await service.getSettings()

    expect(data.cascadeMaxDepth).toBe(9)
    expect(data.defaults.cascadeMaxDepth).toBe(3)
  })

  it('merges partial updates rather than replacing the whole object', async () => {
    const { service, getStoredSettings } = load({
      settings: { ...enabled, cascade: 'missing-only' },
    })

    await service.updateSettings({ translateOn: 'publish' })

    expect(getStoredSettings()).toMatchObject({
      enabled: true,
      masterLocale: 'sv',
      cascade: 'missing-only',
      translateOn: 'publish',
    })
  })

  it('re-reads the store after an update instead of serving the cache', async () => {
    const { service } = load({ settings: { ...enabled, translateOn: 'save' } })

    await service.getEffectiveSettings()
    await service.updateSettings({ translateOn: 'publish' })

    await expect(service.getEffectiveSettings()).resolves.toMatchObject({
      translateOn: 'publish',
    })
  })

  it('caches settings so the hot path does not hit core_store every time', async () => {
    const { service, strapi } = load({ settings: enabled })

    await service.getEffectiveSettings()
    await service.getEffectiveSettings()
    await service.getEffectiveSettings()

    expect(strapi.store).toHaveBeenCalledTimes(1)
  })
})

describe('auto-translate trigger — Rule 0, defaults unchanged', () => {
  it.each([true, false])(
    'writes exactly the parameters the pre-cascade release wrote (publishedNow=%s)',
    async (publishedNow) => {
      const { service, translateEntity } = load({ settings: enabled })

      await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', publishedNow)
      await service._drainQueue()

      expect(translateEntity).toHaveBeenCalledTimes(2) // en + de
      expect(translateEntity).toHaveBeenNthCalledWith(1, {
        documentId: 'a1',
        contentType: ARTICLE,
        sourceLocale: 'sv',
        targetLocale: 'en',
        create: true,
        updateExisting: true,
        publish: publishedNow,
        priority: 10,
      })
    }
  )

  it('queues nothing extra: one row per target locale, no cascade', async () => {
    const { service, rows } = load({
      settings: enabled,
      relations: { [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.isTrigger)).toBe(true)
  })

  it('does nothing when auto-translate is disabled', async () => {
    const { service, rows } = load()

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(0)
  })

  it('does nothing for a non-master locale', async () => {
    const { service, rows } = load({ settings: enabled })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'en', true)

    expect(rows).toHaveLength(0)
  })

  it('honours ignoreUpdatedContentTypes', async () => {
    const { service, rows } = load({
      settings: enabled,
      config: { ignoreUpdatedContentTypes: [ARTICLE] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(0)
  })
})

describe('cascade: missing-only', () => {
  const cascadeSettings = { ...enabled, cascade: 'missing-only' }

  it('queues dependencies before the entry, ordered by tier', async () => {
    const { service, rows, tierMap } = load({
      settings: { ...cascadeSettings, cascadeLocales: ['en'] },
      relations: {
        [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }],
        [`${CATEGORY}:c1`]: [{ uid: TAG, documentId: 't1' }],
      },
    })
    setTiers(tierMap, { [ARTICLE]: 2, [CATEGORY]: 1, [TAG]: 0 })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows.map((r) => [r.contentType, r.tier])).toEqual([
      [TAG, 0],
      [CATEGORY, 1],
      [ARTICLE, 2],
    ])
  })

  it('never re-translates a dependency that already has the locale', async () => {
    const { service, rows } = load({
      settings: { ...cascadeSettings, cascadeLocales: ['en'] },
      contentTypes: {
        [CATEGORY]: { localizations: { sv: ['c1'], en: ['c1'] } },
      },
      relations: {
        [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }],
      },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows.map((r) => r.contentType)).toEqual([ARTICLE])
  })

  it('cascaded rows mirror their own source and refuse to clobber', async () => {
    const { service, rows, translateEntity } = load({
      settings: { ...cascadeSettings, cascadeLocales: ['en'], autoPublish: 'publish' },
      contentTypes: {
        [CATEGORY]: { localizations: { sv: ['c1'] }, published: { sv: ['c1'] } },
      },
      relations: {
        [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }],
      },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)

    const [dependency, trigger] = rows
    expect(dependency.publishMode).toBe('mirror')
    expect(trigger.publishMode).toBe('publish')

    await service._drainQueue()

    // The dependency's own source is published → it publishes, even though the
    // triggering action did not publish.
    expect(translateEntity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        contentType: CATEGORY,
        publish: true,
        updateExisting: false,
      })
    )
    expect(translateEntity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        contentType: ARTICLE,
        publish: true,
        updateExisting: true,
      })
    )
  })

  it('an unpublished source dependency stays a draft', async () => {
    const { service, translateEntity } = load({
      settings: { ...cascadeSettings, cascadeLocales: ['en'] },
      contentTypes: { [CATEGORY]: { localizations: { sv: ['c1'] } } },
      relations: { [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service._drainQueue()

    expect(translateEntity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ contentType: CATEGORY, publish: false })
    )
  })

  it('never walks into an ignored content type', async () => {
    const { service, rows } = load({
      settings: {
        ...cascadeSettings,
        cascadeLocales: ['en'],
        cascadeIgnoreContentTypes: [CATEGORY],
      },
      relations: { [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows.map((r) => r.contentType)).toEqual([ARTICLE])
  })
})

describe('fan-out bounds', () => {
  it('spends one budget across every target locale, not one per locale', async () => {
    const { service, rows } = load({
      settings: { ...enabled, cascade: 'missing-only', cascadeMaxEntries: 4 },
      relations: {
        [`${ARTICLE}:a1`]: [
          { uid: CATEGORY, documentId: 'c1' },
          { uid: TAG, documentId: 't1' },
        ],
      },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    // 2 locales × (1 trigger) = 2 reserved, leaving 2 for dependencies in total.
    expect(rows).toHaveLength(4)
    expect(rows.filter((r) => r.isTrigger)).toHaveLength(2)
  })

  it('logs which locales were cut short instead of truncating silently', async () => {
    const { service, strapi } = load({
      settings: { ...enabled, cascade: 'missing-only', cascadeMaxEntries: 3 },
      relations: {
        [`${ARTICLE}:a1`]: [
          { uid: CATEGORY, documentId: 'c1' },
          { uid: TAG, documentId: 't1' },
        ],
      },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    const warning = strapi.log.warn.mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes('cascade bounds reached'))
    expect(warning).toBeDefined()
  })

  it('warns when the budget cannot even cover one entry per locale', async () => {
    const { service, rows, strapi } = load({
      settings: { ...enabled, cascadeMaxEntries: 1 },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(1)
    const warning = strapi.log.warn.mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes('lower than the number of target locales'))
    expect(warning).toContain('de')
  })

  it('restricts work to the locale allowlist', async () => {
    const { service, rows } = load({
      settings: { ...enabled, cascadeLocales: ['de'] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows.map((r) => r.targetLocale)).toEqual(['de'])
  })
})

describe('dedupe', () => {
  it('two triggers for the same entry produce exactly one translation', async () => {
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
    })

    await Promise.all([
      service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true),
      service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true),
    ])
    await service._drainQueue()

    expect(rows.filter((r) => r.status !== 'cancelled')).toHaveLength(1)
    expect(translateEntity).toHaveBeenCalledTimes(1)
  })

  it('the database row arbitrates, not the in-memory set', async () => {
    // Simulate the other dyno: a live row exists that this process never queued.
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
    })

    rows.push({
      id: 999,
      documentId: 'log-999',
      contentType: ARTICLE,
      entryDocumentId: 'a1',
      sourceLocale: 'sv',
      targetLocale: 'en',
      status: 'pending',
      createdAt: new Date(Date.now() - 5000).toISOString(),
      isTrigger: true,
      publishMode: 'trigger',
      attempts: 0,
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(1)

    await service._drainQueue()
    expect(translateEntity).toHaveBeenCalledTimes(1)
  })

  it('drops a duplicate that adds no signal, even for a stronger live row', async () => {
    const { service, rows } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
      rowAgeMs: 0,
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)

    expect(rows).toHaveLength(1)
    expect(rows[0].triggerPublished).toBe(true)

    // Let the kicked drain finish inside this test's harness — a drain leaking
    // into the next test would run against that test's global strapi.
    await service._drainQueue()
  })

  it('re-queues once the previous translation has finished', async () => {
    const { service, rows } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service._drainQueue()
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('success')
    expect(rows[1].status).toBe('pending')
  })
})

describe('signal merging — the admin panel publishes as update-then-publish', () => {
  it('the publish trigger upgrades the pending row instead of being dropped', async () => {
    // rowAgeMs: 0 keeps the first row inside its settle window, exactly where
    // the production incident sat (publish landed 70 ms after the row).
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
      rowAgeMs: 0,
    })

    // The CM publish controller always saves the draft first, then publishes —
    // two document-service actions milliseconds apart.
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(1)
    expect(rows[0].triggerPublished).toBe(true)

    await service._drainQueue()

    expect(translateEntity).toHaveBeenCalledTimes(1)
    expect(translateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ publish: true })
    )
  })

  it('the publish flag survives the triggers arriving out of order', async () => {
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
      rowAgeMs: 0,
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)
    await service._drainQueue()

    expect(rows).toHaveLength(1)
    expect(translateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ publish: true })
    )
  })

  it('an upgrade lands during the settle window the executor is already waiting out', async () => {
    // rowAgeMs: 0 makes the drain loop actually sleep the settle delay with a
    // pre-fetched copy of the row — the exact window the production incident
    // hit (row created at .125, publish landed at .195, settle ends at .425).
    const { service, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
      rowAgeMs: 0,
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)
    const drain = service._drainQueue()
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await drain

    expect(translateEntity).toHaveBeenCalledTimes(1)
    expect(translateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ publish: true })
    )
  })

  it('a publish arriving mid-translation queues a follow-up rather than losing the flag', async () => {
    let publishDuringFlight: (() => Promise<void>) | null = null
    const calls: boolean[] = []
    const translateEntity = jest.fn(async (params: any) => {
      calls.push(params.publish)
      if (publishDuringFlight) {
        const fire = publishDuringFlight
        publishDuringFlight = null
        await fire()
      }
      return {}
    })

    const { service, rows } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
      translateEntity,
    })

    publishDuringFlight = () =>
      service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)
    await service._drainQueue()

    // First run finished as a draft (the flag came too late for it), the
    // follow-up re-translated and published.
    expect(calls).toEqual([false, true])
    expect(rows.map((r) => r.status)).toEqual(['success', 'success'])
  })

  it('a direct trigger upgrades a pending cascade mirror row', async () => {
    const { service, rows, translateEntity, tierMap } = load({
      settings: {
        ...enabled,
        cascade: 'missing-only',
        cascadeLocales: ['en'],
      },
      relations: { [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }] },
      rowAgeMs: 0,
    })
    setTiers(tierMap, { [ARTICLE]: 1, [CATEGORY]: 0 })

    // The cascade queues the category as a create-if-missing mirror row…
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)
    // …then an editor publishes the category directly.
    await service.triggerAutoTranslate(CATEGORY, 'c1', 'sv', true)

    const category = rows.find((r) => r.contentType === CATEGORY)
    expect(rows.filter((r) => r.contentType === CATEGORY)).toHaveLength(1)
    expect(category).toMatchObject({
      isTrigger: true,
      publishMode: 'trigger',
      triggerPublished: true,
    })

    await service._drainQueue()

    // The editor acted on the category itself, so trigger semantics win:
    // its translation is overwritten and published.
    expect(translateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: CATEGORY,
        updateExisting: true,
        publish: true,
      })
    )
  })

  it('a cascade mirror row never downgrades a pending trigger row', async () => {
    const { service, rows, tierMap } = load({
      settings: {
        ...enabled,
        cascade: 'missing-only',
        cascadeLocales: ['en'],
      },
      relations: { [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }] },
      rowAgeMs: 0,
    })
    setTiers(tierMap, { [ARTICLE]: 1, [CATEGORY]: 0 })

    await service.triggerAutoTranslate(CATEGORY, 'c1', 'sv', true)
    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', false)

    const category = rows.find((r) => r.contentType === CATEGORY)
    expect(category).toMatchObject({
      isTrigger: true,
      publishMode: 'trigger',
      triggerPublished: true,
    })

    // Let the kicked drain finish inside this test's harness — a drain leaking
    // into the next test would run against that test's global strapi.
    await service._drainQueue()
  })

  it("another process's live row absorbs the publish flag instead of eating it", async () => {
    // The foreign row was queued by the other dyno's update action; our
    // process only ever sees the publish. The DB row stays the arbiter.
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
    })

    rows.push({
      id: 999,
      documentId: 'log-999',
      contentType: ARTICLE,
      entryDocumentId: 'a1',
      sourceLocale: 'sv',
      targetLocale: 'en',
      status: 'pending',
      createdAt: new Date(Date.now() - 5000).toISOString(),
      isTrigger: true,
      publishMode: 'trigger',
      triggerPublished: false,
      attempts: 0,
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    expect(rows).toHaveLength(1)
    expect(rows[0].triggerPublished).toBe(true)

    await service._drainQueue()
    expect(translateEntity).toHaveBeenCalledTimes(1)
    expect(translateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ publish: true })
    )
  })

  it("a row already translating on another process gets a follow-up, not an upgrade", async () => {
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
    })

    rows.push({
      id: 500,
      documentId: 'log-500',
      contentType: ARTICLE,
      entryDocumentId: 'a1',
      sourceLocale: 'sv',
      targetLocale: 'en',
      status: 'translating',
      createdAt: new Date(Date.now() - 5000).toISOString(),
      isTrigger: true,
      publishMode: 'trigger',
      triggerPublished: false,
      attempts: 1,
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)

    // The mid-flight row is untouched; a follow-up row carries the flag.
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ status: 'translating', triggerPublished: false })
    expect(rows[1]).toMatchObject({ status: 'pending', triggerPublished: true })

    await service._drainQueue()
    expect(translateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ publish: true })
    )
  })
})

describe('queue execution', () => {
  it('consumes rows in insertion order, so a later plan never preempts an earlier one', async () => {
    const { service, translateEntity, tierMap } = load({
      settings: { ...enabled, cascade: 'missing-only', cascadeLocales: ['en'] },
      relations: {
        [`${ARTICLE}:a1`]: [{ uid: CATEGORY, documentId: 'c1' }],
      },
    })
    setTiers(tierMap, { [ARTICLE]: 1, [CATEGORY]: 0, [TAG]: 0 })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service.triggerAutoTranslate(TAG, 't1', 'sv', true)
    await service._drainQueue()

    expect(
      (translateEntity as any).mock.calls.map((c: any[]) => c[0].contentType)
    ).toEqual([CATEGORY, ARTICLE, TAG])
  })

  it('records a failure on the row instead of stopping the queue', async () => {
    const translateEntity = jest
      .fn<any>()
      .mockRejectedValueOnce(new Error('provider exploded'))
      .mockResolvedValue({})

    const { service, rows } = load({ settings: enabled, translateEntity })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service._drainQueue()

    expect(rows[0].status).toBe('failed')
    expect(rows[0].error).toBe('provider exploded')
    expect(rows[1].status).toBe('success')
  })

  it('gives up after the attempt limit rather than looping forever', async () => {
    const { service, rows, translateEntity } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    rows[0].attempts = 3
    await service._drainQueue()

    expect(rows[0].status).toBe('failed')
    expect(rows[0].error).toMatch(/Gave up after 3 attempts/)
    expect(translateEntity).not.toHaveBeenCalled()
  })

  it('guards its own writes so the middleware cannot re-enter', async () => {
    let guardedDuringWrite: boolean | null = null
    const { service } = load({
      settings: { ...enabled, cascadeLocales: ['en'] },
      translateEntity: jest.fn(async () => {
        guardedDuringWrite =
          (global as any).strapi.__autoTranslate.isGuarded(ARTICLE, 'a1', 'en') &&
          (global as any).strapi.__autoTranslate.isPluginWrite()
        return {}
      }),
    })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service._drainQueue()

    expect(guardedDuringWrite).toBe(true)
    expect(service.isGuarded(ARTICLE, 'a1', 'en')).toBe(false)
    expect(service.isPluginWrite()).toBe(false)
  })
})

describe('restart survival', () => {
  it('re-queues rows interrupted mid-flight', async () => {
    const { service, rows } = load({ settings: enabled })

    rows.push({
      id: 1,
      documentId: 'log-1',
      contentType: ARTICLE,
      entryDocumentId: 'a1',
      sourceLocale: 'sv',
      targetLocale: 'en',
      status: 'translating',
      attempts: 1,
      createdAt: new Date(Date.now() - 5000).toISOString(),
    })

    const resumed = await service.resumeQueue()

    expect(resumed).toBe(1)
    expect(rows[0].status).toBe('pending')
  })

  it('age-based cleanup never removes queued work', async () => {
    const { service, rows } = load({ settings: enabled })
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

    rows.push(
      { id: 1, documentId: 'log-1', status: 'pending', createdAt: old },
      { id: 2, documentId: 'log-2', status: 'translating', createdAt: old },
      { id: 3, documentId: 'log-3', status: 'success', createdAt: old },
      { id: 4, documentId: 'log-4', status: 'failed', createdAt: old },
      { id: 5, documentId: 'log-5', status: 'cancelled', createdAt: old }
    )

    await service.cleanupOldLogs()

    expect(rows.map((r) => r.status).sort()).toEqual(['pending', 'translating'])
  })

  it('surfaces stuck rows rather than letting them disappear', async () => {
    const { service, rows } = load({ settings: enabled })
    rows.push({
      id: 1,
      documentId: 'log-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })

    await expect(service.getQueueStatus()).resolves.toMatchObject({
      pending: 1,
      stale: 1,
      running: false,
    })
  })
})

describe('kill switch', () => {
  it('cancels pending rows and stops the drain', async () => {
    const { service, rows, translateEntity } = load({ settings: enabled })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    const cancelled = await service.cancelQueue()
    await service._drainQueue()

    expect(cancelled).toBe(2)
    expect(rows.every((r) => r.status === 'cancelled')).toBe(true)
    expect(translateEntity).not.toHaveBeenCalled()
  })

  it('a later trigger revives the queue without a restart', async () => {
    const { service, translateEntity } = load({ settings: enabled })

    await service.triggerAutoTranslate(ARTICLE, 'a1', 'sv', true)
    await service.cancelQueue()
    await service.triggerAutoTranslate(CATEGORY, 'c1', 'sv', true)
    await service._drainQueue()

    expect(
      (translateEntity as any).mock.calls.map((c: any[]) => c[0].contentType)
    ).toEqual([CATEGORY, CATEGORY])
  })
})

describe('onSourceUnpublish', () => {
  it('does nothing by default', async () => {
    const { service, strapi } = load({ settings: enabled })

    await service.handleSourceUnpublish(ARTICLE, 'a1', 'sv')

    expect(strapi.documents).not.toHaveBeenCalledWith(ARTICLE)
  })

  it('unpublishes the trigger entry’s translations when asked', async () => {
    const { service, strapi } = load({
      settings: { ...enabled, onSourceUnpublish: 'unpublish' },
    })

    await service.handleSourceUnpublish(ARTICLE, 'a1', 'sv')

    const unpublish = strapi.documents(ARTICLE).unpublish
    expect(unpublish).toHaveBeenCalledTimes(2)
    expect(unpublish).toHaveBeenCalledWith({ documentId: 'a1', locale: 'en' })
  })

  it('skips content types without draft & publish', async () => {
    const { service, strapi } = load({
      settings: { ...enabled, onSourceUnpublish: 'unpublish' },
      contentTypes: {
        [CATEGORY]: { draftAndPublish: false, localizations: { sv: ['c1'] } },
      },
    })

    await service.handleSourceUnpublish(CATEGORY, 'c1', 'sv')

    expect(strapi.documents(CATEGORY).unpublish).not.toHaveBeenCalled()
  })
})
