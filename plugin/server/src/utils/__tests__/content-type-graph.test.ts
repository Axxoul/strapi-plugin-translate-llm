import { describe, expect, it } from '@jest/globals'
import {
  buildDependencyGraph,
  findSCCs,
  computeTiers,
} from '../content-type-graph'
import { Core } from '@strapi/strapi'

function makeStrapiMock(
  contentTypes: Record<string, any>,
  components: Record<string, any> = {}
): Core.Strapi {
  return { contentTypes, components } as any
}

function localizedType(
  attributes: Record<string, any> = {},
  info: { displayName: string } = { displayName: 'Test' }
) {
  return {
    pluginOptions: { i18n: { localized: true } },
    attributes,
    info,
  }
}

describe('content-type-graph', () => {
  describe('buildDependencyGraph', () => {
    it('no relations → all types present with no edges', () => {
      const strapi = makeStrapiMock({
        'api::article.article': localizedType({ title: { type: 'string' } }),
        'api::page.page': localizedType({ slug: { type: 'string' } }),
      })

      const graph = buildDependencyGraph(strapi)

      expect(graph.size).toBe(2)
      expect(graph.get('api::article.article')!.size).toBe(0)
      expect(graph.get('api::page.page')!.size).toBe(0)
    })

    it('linear chain A→B→C', () => {
      const strapi = makeStrapiMock({
        'api::a.a': localizedType({
          rel: { type: 'relation', target: 'api::b.b', relation: 'manyToOne' },
        }),
        'api::b.b': localizedType({
          rel: { type: 'relation', target: 'api::c.c', relation: 'manyToOne' },
        }),
        'api::c.c': localizedType({ name: { type: 'string' } }),
      })

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::a.a')).toEqual(new Set(['api::b.b']))
      expect(graph.get('api::b.b')).toEqual(new Set(['api::c.c']))
      expect(graph.get('api::c.c')).toEqual(new Set())
    })

    it('filters out non-localized targets', () => {
      const strapi = makeStrapiMock({
        'api::a.a': localizedType({
          rel: {
            type: 'relation',
            target: 'api::nonlocal.nonlocal',
            relation: 'manyToOne',
          },
        }),
        'api::nonlocal.nonlocal': {
          pluginOptions: {},
          attributes: { name: { type: 'string' } },
          info: { displayName: 'NonLocal' },
        },
      })

      const graph = buildDependencyGraph(strapi)

      expect(graph.size).toBe(1)
      expect(graph.get('api::a.a')!.size).toBe(0)
    })

    it('filters out translate: copy edges', () => {
      const strapi = makeStrapiMock({
        'api::a.a': localizedType({
          rel: {
            type: 'relation',
            target: 'api::b.b',
            relation: 'manyToOne',
            pluginOptions: { translate: { translate: 'copy' } },
          },
        }),
        'api::b.b': localizedType({ name: { type: 'string' } }),
      })

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::a.a')!.size).toBe(0)
    })

    it('filters out translate: delete edges', () => {
      const strapi = makeStrapiMock({
        'api::a.a': localizedType({
          rel: {
            type: 'relation',
            target: 'api::b.b',
            relation: 'manyToOne',
            pluginOptions: { translate: { translate: 'delete' } },
          },
        }),
        'api::b.b': localizedType({ name: { type: 'string' } }),
      })

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::a.a')!.size).toBe(0)
    })

    it('self-reference creates self-loop edge', () => {
      const strapi = makeStrapiMock({
        'api::tree.tree': localizedType({
          parent: {
            type: 'relation',
            target: 'api::tree.tree',
            relation: 'manyToOne',
          },
        }),
      })

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::tree.tree')).toEqual(
        new Set(['api::tree.tree'])
      )
    })

    it('inverse relation (mappedBy) is skipped', () => {
      const strapi = makeStrapiMock({
        'api::a.a': localizedType({
          bs: {
            type: 'relation',
            target: 'api::b.b',
            relation: 'manyToMany',
            mappedBy: 'as',
          },
        }),
        'api::b.b': localizedType({
          as: {
            type: 'relation',
            target: 'api::a.a',
            relation: 'manyToMany',
            inversedBy: 'bs',
          },
        }),
      })

      const graph = buildDependencyGraph(strapi)

      // a→b is skipped (mappedBy), b→a is kept (inversedBy = owning side)
      expect(graph.get('api::a.a')!.size).toBe(0)
      expect(graph.get('api::b.b')).toEqual(new Set(['api::a.a']))
    })

    it('oneToMany (always inverse) is skipped', () => {
      const strapi = makeStrapiMock({
        'api::a.a': localizedType({
          bs: {
            type: 'relation',
            target: 'api::b.b',
            relation: 'oneToMany',
            mappedBy: 'a',
          },
        }),
        'api::b.b': localizedType({
          a: {
            type: 'relation',
            target: 'api::a.a',
            relation: 'manyToOne',
          },
        }),
      })

      const graph = buildDependencyGraph(strapi)

      // a.bs is oneToMany with mappedBy → skipped; b.a is manyToOne → kept
      expect(graph.get('api::a.a')!.size).toBe(0)
      expect(graph.get('api::b.b')).toEqual(new Set(['api::a.a']))
    })

    it('detects relations inside components', () => {
      const strapi = makeStrapiMock(
        {
          'api::a.a': localizedType({
            section: { type: 'component', component: 'sections.hero' },
          }),
          'api::b.b': localizedType({ name: { type: 'string' } }),
        },
        {
          'sections.hero': {
            attributes: {
              link: {
                type: 'relation',
                target: 'api::b.b',
                relation: 'manyToOne',
              },
            },
          },
        }
      )

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::a.a')).toEqual(new Set(['api::b.b']))
    })

    it('detects relations inside dynamic zones', () => {
      const strapi = makeStrapiMock(
        {
          'api::a.a': localizedType({
            blocks: {
              type: 'dynamiczone',
              components: ['sections.hero'],
            },
          }),
          'api::b.b': localizedType({ name: { type: 'string' } }),
        },
        {
          'sections.hero': {
            attributes: {
              link: {
                type: 'relation',
                target: 'api::b.b',
                relation: 'manyToOne',
              },
            },
          },
        }
      )

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::a.a')).toEqual(new Set(['api::b.b']))
    })

    it('skips component relations when component has translate: delete', () => {
      const strapi = makeStrapiMock(
        {
          'api::a.a': localizedType({
            section: {
              type: 'component',
              component: 'sections.hero',
              pluginOptions: { translate: { translate: 'delete' } },
            },
          }),
          'api::b.b': localizedType({ name: { type: 'string' } }),
        },
        {
          'sections.hero': {
            attributes: {
              link: {
                type: 'relation',
                target: 'api::b.b',
                relation: 'manyToOne',
              },
            },
          },
        }
      )

      const graph = buildDependencyGraph(strapi)

      expect(graph.get('api::a.a')!.size).toBe(0)
    })
  })

  describe('findSCCs', () => {
    it('no edges → each node is its own SCC', () => {
      const graph = new Map([
        ['a', new Set<string>()],
        ['b', new Set<string>()],
      ])

      const sccs = findSCCs(graph)

      expect(sccs.length).toBe(2)
      expect(sccs.every((scc) => scc.length === 1)).toBe(true)
    })

    it('simple cycle A→B→A', () => {
      const graph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
      ])

      const sccs = findSCCs(graph)
      const cycleScc = sccs.find((scc) => scc.length === 2)

      expect(cycleScc).toBeDefined()
      expect(cycleScc!.sort()).toEqual(['a', 'b'])
    })

    it('self-loop is a single-node SCC', () => {
      const graph = new Map([['a', new Set(['a'])]])

      const sccs = findSCCs(graph)

      expect(sccs.length).toBe(1)
      expect(sccs[0]).toEqual(['a'])
    })
  })

  describe('computeTiers', () => {
    it('no relations → all tier 0, not circular', () => {
      const graph = new Map([
        ['a', new Set<string>()],
        ['b', new Set<string>()],
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('a')).toEqual({ tier: 0, circular: false })
      expect(tiers.get('b')).toEqual({ tier: 0, circular: false })
    })

    it('linear chain A→B→C → C=0, B=1, A=2', () => {
      const graph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set<string>()],
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('c')).toEqual({ tier: 0, circular: false })
      expect(tiers.get('b')).toEqual({ tier: 1, circular: false })
      expect(tiers.get('a')).toEqual({ tier: 2, circular: false })
    })

    it('diamond A→B, A→C, B→D, C→D → D=0, B=1, C=1, A=2', () => {
      const graph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['d'])],
        ['c', new Set(['d'])],
        ['d', new Set<string>()],
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('d')).toEqual({ tier: 0, circular: false })
      expect(tiers.get('b')).toEqual({ tier: 1, circular: false })
      expect(tiers.get('c')).toEqual({ tier: 1, circular: false })
      expect(tiers.get('a')).toEqual({ tier: 2, circular: false })
    })

    it('simple cycle A→B→A → both circular with numeric tier', () => {
      const graph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('a')).toEqual({ tier: 0, circular: true })
      expect(tiers.get('b')).toEqual({ tier: 0, circular: true })
    })

    it('self-reference → circular with numeric tier', () => {
      const graph = new Map([['a', new Set(['a'])]])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('a')).toEqual({ tier: 0, circular: true })
    })

    it('non-circular type depending on circular → gets numeric tier, not circular', () => {
      const graph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['b'])], // b↔c cycle
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('b')).toEqual({ tier: 0, circular: true })
      expect(tiers.get('c')).toEqual({ tier: 0, circular: true })
      expect(tiers.get('a')).toEqual({ tier: 1, circular: false })
    })

    it('circular SCC gets numeric tier based on deps', () => {
      const graph = new Map([
        ['x', new Set<string>()], // tier 0
        ['a', new Set(['b', 'x'])],
        ['b', new Set(['a'])], // a↔b cycle, depends on x
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('x')).toEqual({ tier: 0, circular: false })
      expect(tiers.get('a')).toEqual({ tier: 1, circular: true })
      expect(tiers.get('b')).toEqual({ tier: 1, circular: true })
    })

    it('mixed: some circular, some not, independent paths', () => {
      const graph = new Map([
        ['x', new Set<string>()], // independent, tier 0
        ['y', new Set(['x'])], // depends on x, tier 1
        ['a', new Set(['b'])],
        ['b', new Set(['a'])], // a↔b cycle
      ])
      const sccs = findSCCs(graph)

      const tiers = computeTiers(graph, sccs)

      expect(tiers.get('x')).toEqual({ tier: 0, circular: false })
      expect(tiers.get('y')).toEqual({ tier: 1, circular: false })
      expect(tiers.get('a')).toEqual({ tier: 0, circular: true })
      expect(tiers.get('b')).toEqual({ tier: 0, circular: true })
    })
  })
})
