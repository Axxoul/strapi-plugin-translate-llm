import {
  buildDependencyGraph,
  computeTiers,
  findSCCs,
} from './content-type-graph'

/**
 * Memoized `uid → tier` map for the cascade.
 *
 * The graph only changes when the content-type schemas do. A permanent memo
 * would go stale after a content-type-builder change until the next restart —
 * the defect `relink-relations.ts` shipped with — so this cache carries a TTL as
 * well as an explicit invalidator. The TTL bounds staleness to a minute without
 * pretending to observe a reload event the plugin cannot see.
 */
const TTL_MS = 60_000

let cache: { tiers: Map<string, number>; builtAt: number } | null = null

export function getTierMap(now = Date.now()): Map<string, number> {
  if (cache && now - cache.builtAt < TTL_MS) {
    return cache.tiers
  }

  const graph = buildDependencyGraph(strapi)
  const tierInfo = computeTiers(graph, findSCCs(graph))

  const tiers = new Map<string, number>()
  for (const [uid, info] of tierInfo) {
    tiers.set(uid, info.tier)
  }

  cache = { tiers, builtAt: now }
  return tiers
}

/** Drop the memo — used by tests and after a schema change. */
export function clearTierMapCache() {
  cache = null
}
