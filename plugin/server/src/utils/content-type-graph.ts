import { Core, UID } from '@strapi/strapi'
import { keys } from './objects'

/**
 * Build a dependency graph of localized content types based on their relations.
 * An edge from A → B means "A has a relation targeting B that needs to be translated".
 */
export function buildDependencyGraph(
  strapi: Core.Strapi
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  const localizedTypes = keys(strapi.contentTypes).filter(
    (ct) =>
      strapi.contentTypes[ct].pluginOptions?.i18n?.['localized'] === true
  )

  // Initialize all localized types in the graph
  for (const uid of localizedTypes) {
    graph.set(uid, new Set())
  }

  const localizedSet = new Set<string>(localizedTypes)

  for (const uid of localizedTypes) {
    const schema = strapi.contentTypes[uid]
    collectRelationEdges(strapi, uid, schema.attributes, localizedSet, graph)
  }

  return graph
}

function collectRelationEdges(
  strapi: Core.Strapi,
  sourceUid: string,
  attributes: Record<string, any>,
  localizedSet: Set<string>,
  graph: Map<string, Set<string>>
) {
  for (const attrName of Object.keys(attributes)) {
    const attr = attributes[attrName]
    const onTranslate = attr.pluginOptions?.translate?.translate ?? 'translate'

    if (attr.type === 'relation') {
      if (onTranslate === 'copy' || onTranslate === 'delete') continue
      if (attr.mappedBy) continue // skip inverse/back-reference relations
      const target = attr.target as string
      if (!target || !localizedSet.has(target)) continue
      // Add edge including self-references
      graph.get(sourceUid)!.add(target)
    } else if (attr.type === 'component') {
      if (onTranslate === 'copy' || onTranslate === 'delete') continue
      const componentUid = attr.component as string
      if (componentUid && strapi.components?.[componentUid]) {
        collectRelationEdges(
          strapi,
          sourceUid,
          strapi.components[componentUid].attributes,
          localizedSet,
          graph
        )
      }
    } else if (attr.type === 'dynamiczone') {
      if (onTranslate === 'copy' || onTranslate === 'delete') continue
      const componentUids = (attr.components || []) as string[]
      for (const compUid of componentUids) {
        if (strapi.components?.[compUid]) {
          collectRelationEdges(
            strapi,
            sourceUid,
            strapi.components[compUid].attributes,
            localizedSet,
            graph
          )
        }
      }
    }
  }
}

/**
 * Tarjan's algorithm to find strongly connected components.
 */
export function findSCCs(graph: Map<string, Set<string>>): string[][] {
  let index = 0
  const stack: string[] = []
  const onStack = new Set<string>()
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const sccs: string[][] = []

  function strongconnect(v: string) {
    indices.set(v, index)
    lowlinks.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)

    const neighbors = graph.get(v) || new Set()
    for (const w of neighbors) {
      if (!graph.has(w)) continue // skip non-graph nodes
      if (!indices.has(w)) {
        strongconnect(w)
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!))
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!))
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        scc.push(w)
      } while (w !== v)
      sccs.push(scc)
    }
  }

  for (const v of graph.keys()) {
    if (!indices.has(v)) {
      strongconnect(v)
    }
  }

  return sccs
}

/**
 * Compute tiers for content types based on their dependency graph and SCCs.
 * - All nodes get a numeric tier (max of dependency tiers + 1, roots = 0)
 * - Circular SCCs are flagged with circular: true but still get a numeric tier
 * - Non-circular dependents of circular SCCs are NOT propagated as circular
 */
export function computeTiers(
  graph: Map<string, Set<string>>,
  sccs: string[][]
): Map<string, { tier: number; circular: boolean }> {
  const result = new Map<string, { tier: number; circular: boolean }>()

  // Determine which SCCs are circular
  const circularSccIndices = new Set<number>()
  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i]
    if (
      scc.length > 1 ||
      (scc.length === 1 && graph.get(scc[0])?.has(scc[0]))
    ) {
      circularSccIndices.add(i)
    }
  }

  // Map each node to its SCC index
  const nodeToScc = new Map<string, number>()
  for (let i = 0; i < sccs.length; i++) {
    for (const node of sccs[i]) {
      nodeToScc.set(node, i)
    }
  }

  // Build condensed DAG (SCC index → set of SCC indices it depends on)
  const condensedAdj = new Map<number, Set<number>>()
  for (let i = 0; i < sccs.length; i++) {
    condensedAdj.set(i, new Set())
  }
  for (const [node, neighbors] of graph) {
    const srcScc = nodeToScc.get(node)!
    for (const neighbor of neighbors) {
      const dstScc = nodeToScc.get(neighbor)
      if (dstScc !== undefined && dstScc !== srcScc) {
        condensedAdj.get(srcScc)!.add(dstScc)
      }
    }
  }

  // Compute tier for each SCC via recursive DFS on condensed DAG
  const sccTier = new Map<number, number>()

  function computeSccTier(sccIdx: number): number {
    if (sccTier.has(sccIdx)) return sccTier.get(sccIdx)!
    sccTier.set(sccIdx, -1) // guard against unexpected cycles in condensed DAG

    let maxDepTier = -1
    for (const dep of condensedAdj.get(sccIdx)!) {
      maxDepTier = Math.max(maxDepTier, computeSccTier(dep))
    }

    const tier = maxDepTier + 1
    sccTier.set(sccIdx, tier)
    return tier
  }

  for (let i = 0; i < sccs.length; i++) {
    computeSccTier(i)
  }

  // Assign results
  for (let i = 0; i < sccs.length; i++) {
    const tier = sccTier.get(i)!
    const circular = circularSccIndices.has(i)
    for (const node of sccs[i]) {
      result.set(node, { tier, circular })
    }
  }

  return result
}
