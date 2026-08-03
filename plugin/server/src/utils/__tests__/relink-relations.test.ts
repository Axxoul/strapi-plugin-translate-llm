import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals'
import {
  buildIncomingRelationIndex,
  clearIncomingRelationIndexCache,
  relinkIncomingRelations,
} from '../relink-relations'

type Doc = Record<string, any>

/**
 * Minimal in-memory document service. Only supports what the relink pass uses:
 * `findMany` filtered by a relation's documentId, `findOne` by documentId +
 * locale, and a partial `update`.
 */
function makeStrapiMock(
  contentTypes: Record<string, any>,
  database: Record<string, Doc[]> = {}
) {
  const updates: Array<{
    uid: string
    documentId: string
    locale: string
    data: any
  }> = []

  const documents = (uid: string) => ({
    findMany: async ({ locale, filters }: any) => {
      const [attr] = Object.keys(filters ?? {})
      const wanted = filters?.[attr]?.documentId?.$eq
      return (database[uid] ?? []).filter((doc) => {
        if (doc.locale !== locale) return false
        const value = doc[attr]
        if (Array.isArray(value)) {
          return value.some((rel) => rel?.documentId === wanted)
        }
        return value?.documentId === wanted
      })
    },
    findOne: async ({ documentId, locale }: any) =>
      (database[uid] ?? []).find(
        (doc) => doc.documentId === documentId && doc.locale === locale
      ) ?? null,
    update: async ({ documentId, locale, data }: any) => {
      const doc = (database[uid] ?? []).find(
        (d) => d.documentId === documentId && d.locale === locale
      )
      if (!doc) throw new Error('not found')
      updates.push({ uid, documentId, locale, data })
      for (const [attr, value] of Object.entries<any>(data)) {
        if (value && typeof value === 'object' && Array.isArray(value.connect)) {
          doc[attr] = [
            ...(doc[attr] ?? []),
            ...value.connect.map((id: string) => ({ documentId: id })),
          ]
        } else if (typeof value === 'string') {
          doc[attr] = { documentId: value }
        }
      }
      return doc
    },
  })

  const mock = {
    contentTypes,
    documents,
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    // exposed for assertions
    __updates: updates,
    __database: database,
  }

  Object.defineProperty(global, 'strapi', { value: mock, writable: true })
  return mock
}

function localizedType(attributes: Record<string, any>) {
  return {
    pluginOptions: { i18n: { localized: true } },
    attributes,
    info: { displayName: 'Test' },
  }
}

function plainType(attributes: Record<string, any>) {
  return {
    pluginOptions: {},
    attributes,
    info: { displayName: 'Plain' },
  }
}

/** product ←→ product-option, the pair that regressed in production */
const PRODUCT_TYPES = {
  'api::product.product': localizedType({
    title: { type: 'string' },
    product_options: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'api::product-option.product-option',
      mappedBy: 'product',
    },
  }),
  'api::product-option.product-option': localizedType({
    name: { type: 'string' },
    product: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'api::product.product',
      inversedBy: 'product_options',
    },
  }),
}

beforeEach(() => {
  clearIncomingRelationIndexCache()
})

afterEach(() => {
  clearIncomingRelationIndexCache()
  Object.defineProperty(global, 'strapi', { value: undefined, writable: true })
})

describe('buildIncomingRelationIndex', () => {
  it('indexes both sides of a bidirectional relation', () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES)

    const index = buildIncomingRelationIndex(strapi as any)

    expect(index.get('api::product.product')).toEqual([
      expect.objectContaining({
        uid: 'api::product-option.product-option',
        attr: 'product',
      }),
    ])
    expect(index.get('api::product-option.product-option')).toEqual([
      expect.objectContaining({
        uid: 'api::product.product',
        attr: 'product_options',
      }),
    ])
  })

  it('skips relations on non-localized content types', () => {
    const strapi = makeStrapiMock({
      'api::log.log': plainType({
        product: {
          type: 'relation',
          relation: 'manyToOne',
          target: 'api::product.product',
        },
      }),
      'api::product.product': localizedType({ title: { type: 'string' } }),
    })

    const index = buildIncomingRelationIndex(strapi as any)

    expect(index.get('api::product.product')).toBeUndefined()
  })

  it('skips relations targeting a non-localized content type', () => {
    const strapi = makeStrapiMock({
      'api::product.product': localizedType({
        prodtype: {
          type: 'relation',
          relation: 'manyToOne',
          target: 'api::prodtype.prodtype',
        },
      }),
      'api::prodtype.prodtype': plainType({ name: { type: 'string' } }),
    })

    const index = buildIncomingRelationIndex(strapi as any)

    expect(index.get('api::prodtype.prodtype')).toBeUndefined()
  })

  it("skips i18n's virtual localizations back-reference", () => {
    const strapi = makeStrapiMock({
      'api::product.product': localizedType({
        title: { type: 'string' },
        localizations: {
          type: 'relation',
          relation: 'oneToMany',
          target: 'api::product.product',
          writable: false,
          unstable_virtual: true,
        },
      }),
    })

    const index = buildIncomingRelationIndex(strapi as any)

    expect(index.get('api::product.product')).toBeUndefined()
  })

  it("skips relations configured with translate: 'delete'", () => {
    const strapi = makeStrapiMock({
      'api::a.a': localizedType({
        rel: {
          type: 'relation',
          relation: 'manyToOne',
          target: 'api::b.b',
          pluginOptions: { translate: { translate: 'delete' } },
        },
      }),
      'api::b.b': localizedType({ name: { type: 'string' } }),
    })

    const index = buildIncomingRelationIndex(strapi as any)

    expect(index.get('api::b.b')).toBeUndefined()
  })

  it('memoizes the index until cleared', () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES)
    const first = buildIncomingRelationIndex(strapi as any)
    expect(buildIncomingRelationIndex(strapi as any)).toBe(first)

    clearIncomingRelationIndexCache()
    expect(buildIncomingRelationIndex(strapi as any)).not.toBe(first)
  })
})

describe('relinkIncomingRelations', () => {
  it('connects a to-many relation that the forward pass dropped', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {
      'api::product.product': [
        {
          documentId: 'prod-1',
          locale: 'sv',
          product_options: [{ documentId: 'opt-1' }],
        },
        { documentId: 'prod-1', locale: 'en', product_options: [] },
      ],
      'api::product-option.product-option': [
        { documentId: 'opt-1', locale: 'sv', product: { documentId: 'prod-1' } },
        { documentId: 'opt-1', locale: 'en', product: null },
      ],
    })

    // The EN option was just written — relink what pointed at it in SV
    const result = await relinkIncomingRelations({
      uid: 'api::product-option.product-option' as any,
      documentId: 'opt-1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(result).toEqual({ linked: 1, skipped: 0, errors: 0 })
    expect(strapi.__updates).toEqual([
      {
        uid: 'api::product.product',
        documentId: 'prod-1',
        locale: 'en',
        data: { product_options: { connect: ['opt-1'] } },
      },
    ])
  })

  it('sets an empty to-one relation', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {
      'api::product.product': [
        {
          documentId: 'prod-1',
          locale: 'sv',
          product_options: [{ documentId: 'opt-1' }],
        },
        { documentId: 'prod-1', locale: 'en', product_options: [] },
      ],
      'api::product-option.product-option': [
        { documentId: 'opt-1', locale: 'sv', product: { documentId: 'prod-1' } },
        { documentId: 'opt-1', locale: 'en', product: null },
      ],
    })

    // The EN product was just written — relink the options pointing at it
    const result = await relinkIncomingRelations({
      uid: 'api::product.product' as any,
      documentId: 'prod-1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(result).toEqual({ linked: 1, skipped: 0, errors: 0 })
    expect(strapi.__updates).toEqual([
      {
        uid: 'api::product-option.product-option',
        documentId: 'opt-1',
        locale: 'en',
        data: { product: 'prod-1' },
      },
    ])
  })

  it('is idempotent — a second run links nothing', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {
      'api::product.product': [
        {
          documentId: 'prod-1',
          locale: 'sv',
          product_options: [{ documentId: 'opt-1' }],
        },
        { documentId: 'prod-1', locale: 'en', product_options: [] },
      ],
      'api::product-option.product-option': [
        { documentId: 'opt-1', locale: 'sv', product: { documentId: 'prod-1' } },
        { documentId: 'opt-1', locale: 'en', product: null },
      ],
    })

    const params = {
      uid: 'api::product-option.product-option' as any,
      documentId: 'opt-1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    }

    await relinkIncomingRelations(params)
    const second = await relinkIncomingRelations(params)

    expect(second).toEqual({ linked: 0, skipped: 1, errors: 0 })
    expect(strapi.__updates).toHaveLength(1)
  })

  it('never overwrites an existing to-one link', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {
      'api::product.product': [
        {
          documentId: 'prod-1',
          locale: 'sv',
          product_options: [{ documentId: 'opt-1' }],
        },
      ],
      'api::product-option.product-option': [
        { documentId: 'opt-1', locale: 'sv', product: { documentId: 'prod-1' } },
        {
          documentId: 'opt-1',
          locale: 'en',
          product: { documentId: 'prod-other' },
        },
      ],
    })

    const result = await relinkIncomingRelations({
      uid: 'api::product.product' as any,
      documentId: 'prod-1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(result).toEqual({ linked: 0, skipped: 1, errors: 0 })
    expect(strapi.__updates).toHaveLength(0)
    expect(
      strapi.__database['api::product-option.product-option'][1].product
    ).toEqual({ documentId: 'prod-other' })
  })

  it('skips referrers that have no target-locale localization', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {
      'api::product.product': [
        {
          documentId: 'prod-1',
          locale: 'sv',
          product_options: [{ documentId: 'opt-1' }],
        },
        // no EN product
      ],
      'api::product-option.product-option': [
        { documentId: 'opt-1', locale: 'sv', product: { documentId: 'prod-1' } },
        { documentId: 'opt-1', locale: 'en', product: null },
      ],
    })

    const result = await relinkIncomingRelations({
      uid: 'api::product-option.product-option' as any,
      documentId: 'opt-1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(result).toEqual({ linked: 0, skipped: 1, errors: 0 })
    expect(strapi.__updates).toHaveLength(0)
  })

  it('does nothing when source and target locale are the same', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {})

    const result = await relinkIncomingRelations({
      uid: 'api::product.product' as any,
      documentId: 'prod-1',
      sourceLocale: 'sv',
      targetLocale: 'sv',
    })

    expect(result).toEqual({ linked: 0, skipped: 0, errors: 0 })
    expect(strapi.__updates).toHaveLength(0)
  })

  it('reports errors without throwing', async () => {
    const strapi = makeStrapiMock(PRODUCT_TYPES, {
      'api::product.product': [
        {
          documentId: 'prod-1',
          locale: 'sv',
          product_options: [{ documentId: 'opt-1' }],
        },
        { documentId: 'prod-1', locale: 'en', product_options: [] },
      ],
      'api::product-option.product-option': [
        { documentId: 'opt-1', locale: 'sv', product: { documentId: 'prod-1' } },
      ],
    })

    const documents = strapi.documents
    ;(strapi as any).documents = (uid: string) => ({
      ...documents(uid),
      update: async () => {
        throw new Error('db exploded')
      },
    })

    const result = await relinkIncomingRelations({
      uid: 'api::product-option.product-option' as any,
      documentId: 'opt-1',
      sourceLocale: 'sv',
      targetLocale: 'en',
    })

    expect(result).toEqual({ linked: 0, skipped: 0, errors: 1 })
    expect(strapi.log.warn).toHaveBeenCalled()
  })
})
