import { describe, expect, it } from '@jest/globals'
import {
  buildChangedRows,
  ChangedDocument,
  ContentTypeSchema,
  selectContentTypes,
} from '../changed-plan'

const collection = (localized = true): ContentTypeSchema => ({
  kind: 'collectionType',
  pluginOptions: { i18n: { localized } },
})

const single: ContentTypeSchema = {
  kind: 'singleType',
  pluginOptions: { i18n: { localized: true } },
}

const tiers = (entries: Record<string, number>) =>
  new Map<string, number>(Object.entries(entries))

describe('selectContentTypes', () => {
  it('orders by ascending tier, then uid as a deterministic tie-break', () => {
    const schemas = {
      'api::z.z': collection(),
      'api::a.a': collection(),
      'api::b.b': collection(),
    }

    const uids = selectContentTypes({
      tiers: tiers({ 'api::z.z': 0, 'api::a.a': 1, 'api::b.b': 0 }),
      schemas,
      ignore: [],
    })

    expect(uids).toEqual(['api::b.b', 'api::z.z', 'api::a.a'])
  })

  it('drops content types on the ignore list', () => {
    const schemas = { 'api::a.a': collection(), 'api::b.b': collection() }

    const uids = selectContentTypes({
      tiers: tiers({}),
      schemas,
      ignore: ['api::a.a'],
    })

    expect(uids).toEqual(['api::b.b'])
  })

  it('restricts to `only` when given', () => {
    const schemas = {
      'api::a.a': collection(),
      'api::b.b': collection(),
      'api::c.c': collection(),
    }

    const uids = selectContentTypes({
      tiers: tiers({}),
      schemas,
      ignore: [],
      only: ['api::c.c', 'api::a.a'],
    })

    expect(uids).toEqual(['api::a.a', 'api::c.c'])
  })

  it('excludes single types', () => {
    const schemas = { 'api::a.a': collection(), 'api::b.b': single }

    const uids = selectContentTypes({ tiers: tiers({}), schemas, ignore: [] })

    expect(uids).toEqual(['api::a.a'])
  })

  it('excludes non-localized and non-api content types', () => {
    const schemas = {
      'api::a.a': collection(),
      'api::b.b': collection(false),
      'plugin::translate.auto-translate-log': collection(),
    }

    const uids = selectContentTypes({ tiers: tiers({}), schemas, ignore: [] })

    expect(uids).toEqual(['api::a.a'])
  })
})

describe('buildChangedRows', () => {
  const doc = (documentId: string, updatedAt = '2026-01-01T00:00:00.000Z'): ChangedDocument => ({
    documentId,
    updatedAt,
  })

  const baseOptions = {
    sourceLocale: 'sv',
    targetLocale: 'en',
    publishMode: 'draft' as const,
    planId: 'changed-1',
    tierOf: () => 0,
    maxTotal: 400,
  }

  it('flattens changed documents in uid order, tagging every row a direct trigger', () => {
    const rows = buildChangedRows({
      ...baseOptions,
      uids: ['api::a.a', 'api::b.b'],
      changedByUid: new Map([
        ['api::a.a', [doc('a1')]],
        ['api::b.b', [doc('b1'), doc('b2')]],
      ]),
      tierOf: (uid) => (uid === 'api::a.a' ? 0 : 1),
    })

    expect(rows.map((r) => [r.contentType, r.entryDocumentId])).toEqual([
      ['api::a.a', 'a1'],
      ['api::b.b', 'b1'],
      ['api::b.b', 'b2'],
    ])
    expect(rows[1]).toMatchObject({
      tier: 1,
      planId: 'changed-1',
      publishMode: 'draft',
      isTrigger: true,
      triggerPublished: false,
    })
  })

  it('truncates at maxTotal across content types', () => {
    const rows = buildChangedRows({
      ...baseOptions,
      uids: ['api::a.a', 'api::b.b'],
      changedByUid: new Map([
        ['api::a.a', [doc('a1'), doc('a2')]],
        ['api::b.b', [doc('b1'), doc('b2')]],
      ]),
      maxTotal: 3,
    })

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.entryDocumentId)).toEqual(['a1', 'a2', 'b1'])
  })
})
