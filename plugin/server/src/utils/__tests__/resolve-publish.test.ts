import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { isDraftAndPublish, resolvePublish } from '../resolve-publish'

const originalStrapi = (global as any).strapi

type DocFixture = { published?: boolean }

function mockStrapi({
  draftAndPublish = true,
  published = false,
  findOne,
}: {
  draftAndPublish?: boolean
  published?: boolean
  findOne?: (...args: any[]) => any
} = {}) {
  const defaultFindOne = jest.fn((params: any) =>
    params?.status === 'published' && !published ? null : { documentId: 'doc' }
  )

  const documents = jest.fn(() => ({
    findOne: findOne ?? defaultFindOne,
    findFirst: findOne ?? defaultFindOne,
  }))

  ;(global as any).strapi = {
    contentTypes: {
      'api::a.a': { options: { draftAndPublish } },
    },
    documents,
    log: { warn: jest.fn(), debug: jest.fn() },
  }

  return { documents, findOne: findOne ?? defaultFindOne }
}

const base = {
  uid: 'api::a.a' as any,
  documentId: 'doc',
  sourceLocale: 'sv',
}

afterEach(() => {
  ;(global as any).strapi = originalStrapi
})

describe('isDraftAndPublish', () => {
  it('reads the schema option, not the name', () => {
    mockStrapi({ draftAndPublish: false })
    expect(isDraftAndPublish('api::a.a')).toBe(false)

    mockStrapi({ draftAndPublish: true })
    expect(isDraftAndPublish('api::a.a')).toBe(true)
  })

  it('is false for an unknown content type rather than throwing', () => {
    mockStrapi()
    expect(isDraftAndPublish('api::nope.nope')).toBe(false)
  })
})

describe('resolvePublish', () => {
  it('draft never publishes', async () => {
    mockStrapi({ published: true })
    await expect(
      resolvePublish({ ...base, mode: 'draft', triggerPublished: true })
    ).resolves.toBe(false)
  })

  it('publish always publishes', async () => {
    mockStrapi({ published: false })
    await expect(
      resolvePublish({ ...base, mode: 'publish', triggerPublished: false })
    ).resolves.toBe(true)
  })

  describe('trigger — the Rule 0 pass-through', () => {
    it.each([true, false])(
      'returns the triggering action’s flag verbatim (%s)',
      async (triggerPublished) => {
        mockStrapi({ published: !triggerPublished })
        await expect(
          resolvePublish({ ...base, mode: 'trigger', triggerPublished })
        ).resolves.toBe(triggerPublished)
      }
    )

    it('does not consult the source document at all', async () => {
      const { documents } = mockStrapi({ published: true })
      await resolvePublish({ ...base, mode: 'trigger', triggerPublished: false })
      expect(documents).not.toHaveBeenCalled()
    })

    it('does not branch on draft-and-publish', async () => {
      mockStrapi({ draftAndPublish: false })
      await expect(
        resolvePublish({ ...base, mode: 'trigger', triggerPublished: true })
      ).resolves.toBe(true)
    })
  })

  describe('mirror', () => {
    it('publishes when the source has a published row', async () => {
      mockStrapi({ published: true })
      await expect(
        resolvePublish({ ...base, mode: 'mirror' })
      ).resolves.toBe(true)
    })

    it('stays a draft when the source has none', async () => {
      mockStrapi({ published: false })
      await expect(
        resolvePublish({ ...base, mode: 'mirror' })
      ).resolves.toBe(false)
    })

    it('a non-D&P source mirrors as published — its single row is always live', async () => {
      const { documents } = mockStrapi({ draftAndPublish: false })
      await expect(
        resolvePublish({ ...base, mode: 'mirror' })
      ).resolves.toBe(true)
      expect(documents).not.toHaveBeenCalled()
    })

    it('uses findFirst for a single type (no documentId)', async () => {
      const findOne = jest.fn(() => ({ documentId: 'x' }))
      mockStrapi({ findOne: findOne as any })
      await expect(
        resolvePublish({ ...base, documentId: null, mode: 'mirror' })
      ).resolves.toBe(true)
    })

    it('defaults to draft — never publishes — when the lookup fails', async () => {
      const findOne = jest.fn(() => {
        throw new Error('db down')
      })
      mockStrapi({ findOne: findOne as any })
      await expect(
        resolvePublish({ ...base, mode: 'mirror' })
      ).resolves.toBe(false)
      expect((global as any).strapi.log.warn).toHaveBeenCalled()
    })
  })
})
