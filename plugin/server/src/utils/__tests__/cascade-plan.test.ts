import { describe, expect, it, jest } from '@jest/globals'
import {
  CascadePlanLookups,
  CascadeRef,
  planCascade,
} from '../cascade-plan'

/**
 * Build lookups from a plain description of the world:
 * - `edges`   — `"uid:documentId"` → the refs it points at
 * - `existing` — the set of `"uid:documentId"` that already have the target locale
 */
function makeLookups(
  edges: Record<string, CascadeRef[]>,
  existing: string[] = []
): CascadePlanLookups {
  const existingSet = new Set(existing)
  return {
    getRelated: async (ref) => edges[`${ref.uid}:${ref.documentId}`] ?? [],
    hasLocalization: async (ref) =>
      existingSet.has(`${ref.uid}:${ref.documentId}`),
  }
}

const ref = (uid: string, documentId: string): CascadeRef => ({
  uid,
  documentId,
})

const tiers = (entries: Record<string, number>) =>
  new Map<string, number>(Object.entries(entries))

const baseOptions = {
  targetLocale: 'en',
  tiers: tiers({}),
  maxDepth: 5,
  maxEntries: 50,
}

describe('planCascade', () => {
  it('returns nothing when the root has no relations', async () => {
    const plan = await planCascade({
      ...baseOptions,
      root: ref('api::a.a', '1'),
      lookups: makeLookups({}),
    })

    expect(plan.nodes).toEqual([])
    expect(plan.truncated).toBe(false)
    expect(plan.depthLimited).toBe(false)
  })

  it('never includes the root itself, even via a self-reference', async () => {
    const plan = await planCascade({
      ...baseOptions,
      root: ref('api::a.a', '1'),
      lookups: makeLookups({
        'api::a.a:1': [ref('api::a.a', '1'), ref('api::a.a', '2')],
      }),
    })

    expect(plan.nodes.map((n) => n.documentId)).toEqual(['2'])
  })

  it('orders dependencies by ascending tier, not discovery order', async () => {
    // The root sees the tier-2 type first; the plan must still put tier 0 first.
    const plan = await planCascade({
      ...baseOptions,
      root: ref('api::page.page', 'p'),
      tiers: tiers({
        'api::page.page': 3,
        'api::mid.mid': 2,
        'api::leaf.leaf': 0,
      }),
      lookups: makeLookups({
        'api::page.page:p': [ref('api::mid.mid', 'm')],
        'api::mid.mid:m': [ref('api::leaf.leaf', 'l')],
      }),
    })

    expect(plan.nodes.map((n) => `${n.uid}:${n.documentId}`)).toEqual([
      'api::leaf.leaf:l',
      'api::mid.mid:m',
    ])
  })

  it('keeps discovery order within a tier (stable sort)', async () => {
    const plan = await planCascade({
      ...baseOptions,
      root: ref('api::a.a', '1'),
      tiers: tiers({ 'api::b.b': 0 }),
      lookups: makeLookups({
        'api::a.a:1': [
          ref('api::b.b', 'first'),
          ref('api::b.b', 'second'),
          ref('api::b.b', 'third'),
        ],
      }),
    })

    expect(plan.nodes.map((n) => n.documentId)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  describe('missing-only', () => {
    it('skips a dependency that already has the target locale', async () => {
      const plan = await planCascade({
        ...baseOptions,
        root: ref('api::a.a', '1'),
        lookups: makeLookups(
          { 'api::a.a:1': [ref('api::b.b', 'x'), ref('api::b.b', 'y')] },
          ['api::b.b:x']
        ),
      })

      expect(plan.nodes.map((n) => n.documentId)).toEqual(['y'])
      expect(plan.skippedExisting).toBe(1)
    })

    it('does not walk through an already-translated dependency', async () => {
      const plan = await planCascade({
        ...baseOptions,
        root: ref('api::a.a', '1'),
        lookups: makeLookups(
          {
            'api::a.a:1': [ref('api::b.b', 'x')],
            'api::b.b:x': [ref('api::c.c', 'deep')],
          },
          ['api::b.b:x']
        ),
      })

      expect(plan.nodes).toEqual([])
    })

    it('treats an unreadable dependency as existing rather than duplicating it', async () => {
      const plan = await planCascade({
        ...baseOptions,
        root: ref('api::a.a', '1'),
        lookups: {
          getRelated: async () => [ref('api::b.b', 'x')],
          hasLocalization: async () => {
            throw new Error('db down')
          },
        },
      })

      expect(plan.nodes).toEqual([])
      expect(plan.skippedExisting).toBe(1)
    })

    it('survives a relation lookup that throws', async () => {
      const plan = await planCascade({
        ...baseOptions,
        root: ref('api::a.a', '1'),
        lookups: {
          getRelated: async () => {
            throw new Error('populate blew up')
          },
          hasLocalization: async () => false,
        },
      })

      expect(plan.nodes).toEqual([])
    })
  })

  describe('cycles', () => {
    it('visits each document once in a two-node cycle', async () => {
      const plan = await planCascade({
        ...baseOptions,
        root: ref('api::a.a', '1'),
        tiers: tiers({ 'api::a.a': 0, 'api::b.b': 0 }),
        lookups: makeLookups({
          'api::a.a:1': [ref('api::b.b', '2')],
          'api::b.b:2': [ref('api::a.a', '1'), ref('api::b.b', '2')],
        }),
      })

      expect(plan.nodes.map((n) => `${n.uid}:${n.documentId}`)).toEqual([
        'api::b.b:2',
      ])
    })

    it('terminates on a long cycle instead of looping', async () => {
      const plan = await planCascade({
        ...baseOptions,
        maxDepth: 100,
        root: ref('api::a.a', '1'),
        lookups: makeLookups({
          'api::a.a:1': [ref('api::b.b', '2')],
          'api::b.b:2': [ref('api::c.c', '3')],
          'api::c.c:3': [ref('api::a.a', '1')],
        }),
      })

      expect(plan.nodes).toHaveLength(2)
    })
  })

  describe('bounds', () => {
    it('stops at maxDepth and reports it', async () => {
      const plan = await planCascade({
        ...baseOptions,
        maxDepth: 2,
        root: ref('api::a.a', '1'),
        lookups: makeLookups({
          'api::a.a:1': [ref('api::b.b', '2')],
          'api::b.b:2': [ref('api::c.c', '3')],
          'api::c.c:3': [ref('api::d.d', '4')],
        }),
      })

      expect(plan.nodes.map((n) => n.documentId)).toEqual(['2', '3'])
      expect(plan.depthLimited).toBe(true)
    })

    it('does not claim depthLimited when the graph simply ran out', async () => {
      const plan = await planCascade({
        ...baseOptions,
        maxDepth: 5,
        root: ref('api::a.a', '1'),
        lookups: makeLookups({ 'api::a.a:1': [ref('api::b.b', '2')] }),
      })

      expect(plan.depthLimited).toBe(false)
    })

    it('stops at maxEntries and reports it', async () => {
      const plan = await planCascade({
        ...baseOptions,
        maxEntries: 2,
        root: ref('api::a.a', '1'),
        lookups: makeLookups({
          'api::a.a:1': [
            ref('api::b.b', '1'),
            ref('api::b.b', '2'),
            ref('api::b.b', '3'),
          ],
        }),
      })

      expect(plan.nodes).toHaveLength(2)
      expect(plan.truncated).toBe(true)
    })

    it('a zero budget produces an empty, explicitly truncated plan', async () => {
      const getRelated = jest.fn(async () => [ref('api::b.b', '2')])
      const plan = await planCascade({
        ...baseOptions,
        maxEntries: 0,
        root: ref('api::a.a', '1'),
        lookups: {
          getRelated: getRelated as any,
          hasLocalization: async () => false,
        },
      })

      expect(plan.nodes).toEqual([])
      expect(plan.truncated).toBe(true)
      expect(getRelated).not.toHaveBeenCalled()
    })
  })

  describe('exclusions', () => {
    it('never enters an excluded content type', async () => {
      const plan = await planCascade({
        ...baseOptions,
        root: ref('api::a.a', '1'),
        isExcluded: (uid) => uid === 'api::secret.secret',
        lookups: makeLookups({
          'api::a.a:1': [ref('api::secret.secret', 's'), ref('api::b.b', '2')],
          'api::secret.secret:s': [ref('api::c.c', '3')],
        }),
      })

      expect(plan.nodes.map((n) => n.uid)).toEqual(['api::b.b'])
    })
  })

  it('reports depth per node', async () => {
    const plan = await planCascade({
      ...baseOptions,
      tiers: tiers({ 'api::b.b': 0, 'api::c.c': 0 }),
      root: ref('api::a.a', '1'),
      lookups: makeLookups({
        'api::a.a:1': [ref('api::b.b', '2')],
        'api::b.b:2': [ref('api::c.c', '3')],
      }),
    })

    expect(plan.nodes.map((n) => [n.uid, n.depth])).toEqual([
      ['api::b.b', 1],
      ['api::c.c', 2],
    ])
  })
})
