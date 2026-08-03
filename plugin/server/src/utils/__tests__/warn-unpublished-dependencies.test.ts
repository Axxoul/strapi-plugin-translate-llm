import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { warnUnpublishedDependencies } from '../warn-unpublished-dependencies'

const PARENT = 'api::article.article'
const DEP = 'api::category.category'

const originalStrapi = (global as any).strapi

/**
 * `published` lists the documentIds that have a published row, per locale.
 * Everything else exists as a draft only.
 */
function mockStrapi({
  published = {} as Record<string, string[]>,
  draftAndPublish = true,
  components = {},
} = {}) {
  ;(global as any).strapi = {
    contentTypes: {
      [PARENT]: {
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
      },
      [DEP]: {
        options: { draftAndPublish },
        pluginOptions: { i18n: { localized: true } },
      },
    },
    components,
    documents: jest.fn(() => ({
      findOne: jest.fn(async ({ documentId, locale, status }: any) =>
        status === 'published' && published[locale]?.includes(documentId)
          ? { documentId }
          : null
      ),
    })),
    log: { warn: jest.fn(), debug: jest.fn() },
  }
  return (global as any).strapi
}

const schema: any = {
  attributes: {
    title: { type: 'string' },
    category: { type: 'relation', target: DEP, relation: 'manyToOne' },
  },
}

const call = (data: any) =>
  warnUnpublishedDependencies({
    data,
    schema,
    parentUid: PARENT,
    parentDocumentId: 'a1',
    sourceLocale: 'sv',
    targetLocale: 'en',
  })

afterEach(() => {
  jest.clearAllMocks()
  ;(global as any).strapi = originalStrapi
})

describe('warnUnpublishedDependencies', () => {
  it('says nothing when the dependency is published in the target locale', async () => {
    const strapi = mockStrapi({ published: { sv: ['c1'], en: ['c1'] } })

    const report = await call({ category: { documentId: 'c1' } })

    expect(report).toEqual({ legacy: [], mirrored: [] })
    expect(strapi.log.warn).not.toHaveBeenCalled()
  })

  it('warns loudly for a target-only gap — source published, target draft-only', async () => {
    const strapi = mockStrapi({ published: { sv: ['c1'] } })

    const report = await call({ category: { documentId: 'c1' } })

    expect(report.legacy).toEqual([{ uid: DEP, documentId: 'c1' }])
    expect(report.mirrored).toEqual([])
    expect(strapi.log.warn).toHaveBeenCalledTimes(1)
    expect(String(strapi.log.warn.mock.calls[0][0])).toContain(
      'draft only'
    )
  })

  it('stays quiet when the source has the identical gap', async () => {
    const strapi = mockStrapi({ published: {} })

    const report = await call({ category: { documentId: 'c1' } })

    expect(report.mirrored).toEqual([{ uid: DEP, documentId: 'c1' }])
    expect(report.legacy).toEqual([])
    expect(strapi.log.warn).not.toHaveBeenCalled()
    expect(strapi.log.debug).toHaveBeenCalled()
  })

  it('ignores dependencies that have no draft & publish to be missing from', async () => {
    const strapi = mockStrapi({ draftAndPublish: false })

    const report = await call({ category: { documentId: 'c1' } })

    expect(report).toEqual({ legacy: [], mirrored: [] })
    expect(strapi.documents).not.toHaveBeenCalled()
  })

  it('checks each dependency once, however many times it is referenced', async () => {
    const strapi = mockStrapi({ published: { sv: ['c1'] } })
    const manySchema: any = {
      attributes: {
        primary: { type: 'relation', target: DEP, relation: 'manyToOne' },
        others: { type: 'relation', target: DEP, relation: 'oneToMany' },
      },
    }

    const report = await warnUnpublishedDependencies({
      data: {
        primary: { documentId: 'c1' },
        others: [{ documentId: 'c1' }, { documentId: 'c2' }],
      },
      schema: manySchema,
      parentUid: PARENT,
      parentDocumentId: 'a1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(report.legacy).toEqual([{ uid: DEP, documentId: 'c1' }])
    expect(report.mirrored).toEqual([{ uid: DEP, documentId: 'c2' }])
    expect(strapi.log.warn).toHaveBeenCalledTimes(1)
  })

  it('descends into components', async () => {
    const strapi = mockStrapi({
      published: { sv: ['c1'] },
      components: {
        'sections.hero': {
          attributes: {
            link: { type: 'relation', target: DEP, relation: 'manyToOne' },
          },
        },
      },
    })

    const report = await warnUnpublishedDependencies({
      data: { hero: { link: { documentId: 'c1' } } },
      schema: {
        attributes: {
          hero: { type: 'component', component: 'sections.hero' },
        },
      } as any,
      parentUid: PARENT,
      parentDocumentId: 'a1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(report.legacy).toEqual([{ uid: DEP, documentId: 'c1' }])
    expect(strapi.log.warn).toHaveBeenCalledTimes(1)
  })

  it('never throws when a lookup fails', async () => {
    ;(global as any).strapi = {
      contentTypes: {
        [DEP]: {
          options: { draftAndPublish: true },
          pluginOptions: { i18n: { localized: true } },
        },
      },
      components: {},
      documents: jest.fn(() => ({
        findOne: jest.fn(async () => {
          throw new Error('db down')
        }),
      })),
      log: { warn: jest.fn(), debug: jest.fn() },
    }

    await expect(call({ category: { documentId: 'c1' } })).resolves.toEqual({
      legacy: [],
      mirrored: [],
    })
  })
})
