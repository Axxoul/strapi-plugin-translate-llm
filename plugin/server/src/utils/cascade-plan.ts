/**
 * Cascade planning.
 *
 * Given a trigger document, work out which *other* documents must be translated
 * into the target locale **before** it, so that its relations resolve instead of
 * being silently dropped by `translateRelations()`.
 *
 * This module is deliberately free of Strapi: every lookup it needs is injected.
 * That keeps the ordering, bounding and dedupe rules unit-testable without a live
 * server, which is where all the interesting behaviour actually lives.
 */

export type CascadeRef = {
  uid: string
  documentId: string
}

export type CascadeNode = CascadeRef & {
  /** Dependency tier of `uid` — nodes are emitted in ascending tier order. */
  tier: number
  /** Relation hops from the trigger document. */
  depth: number
}

export type CascadePlanLookups = {
  /**
   * Documents reachable from `ref` through relation attributes that the cascade
   * is allowed to follow (localized target, `translate !== 'delete'`, not morph).
   * Must include relations nested in components and dynamic zones.
   */
  getRelated: (ref: CascadeRef) => Promise<CascadeRef[]>
  /** Whether `ref` already has a localization in `locale`. */
  hasLocalization: (ref: CascadeRef, locale: string) => Promise<boolean>
}

export type CascadePlanOptions = {
  root: CascadeRef
  targetLocale: string
  /** `uid → tier`, from `computeTiers()`. Missing entries are treated as tier 0. */
  tiers: Map<string, number>
  /** Relation hops the walk may follow. */
  maxDepth: number
  /** Remaining budget of cascaded entries. The caller owns the cross-locale total. */
  maxEntries: number
  /** Content types the walk must not enter (ignore list, single types, …). */
  isExcluded?: (uid: string) => boolean
  lookups: CascadePlanLookups
}

export type CascadePlan = {
  /** Dependencies to translate, ordered by tier ascending. */
  nodes: CascadeNode[]
  /** True when `maxEntries` cut the plan short — always log this, never swallow it. */
  truncated: boolean
  /** True when `maxDepth` stopped the walk before it ran out of relations. */
  depthLimited: boolean
  /** Related documents skipped because a target-locale localization already exists. */
  skippedExisting: number
  /** Documents inspected, including the ones skipped. */
  visited: number
}

function key(ref: CascadeRef): string {
  return `${ref.uid}:${ref.documentId}`
}

/**
 * Breadth-first walk from `root`, collecting related documents that have **no**
 * target-locale localization yet.
 *
 * Two deliberate choices, both load-bearing:
 *
 * - **A document that already has the localization is neither translated nor
 *   walked through.** Not translating it is what makes repeated publishes
 *   converge and what stops shared taxonomy from being overwritten; not walking
 *   through it bounds the work, on the reasoning that its own subtree was
 *   handled when it was created. A dependency reachable *only* through an
 *   already-translated document is therefore out of scope for the cascade — the
 *   reverse relink pass is what repairs those links.
 * - **The root is never included.** The caller queues the trigger entry itself,
 *   after everything this returns.
 */
export async function planCascade({
  root,
  targetLocale,
  tiers,
  maxDepth,
  maxEntries,
  isExcluded,
  lookups,
}: CascadePlanOptions): Promise<CascadePlan> {
  const plan: CascadePlan = {
    nodes: [],
    truncated: false,
    depthLimited: false,
    skippedExisting: 0,
    visited: 0,
  }

  if (maxEntries <= 0) {
    plan.truncated = true
    return plan
  }

  const seen = new Set<string>([key(root)])
  let frontier: CascadeRef[] = [root]

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: CascadeRef[] = []

    for (const ref of frontier) {
      let related: CascadeRef[]
      try {
        related = (await lookups.getRelated(ref)) ?? []
      } catch {
        // A dependency we cannot read is a dependency we cannot translate. The
        // caller still translates the trigger entry; the relink pass covers the
        // link once the localization appears by some other route.
        continue
      }

      for (const rel of related) {
        if (!rel?.uid || !rel?.documentId) continue

        const refKey = key(rel)
        if (seen.has(refKey)) continue
        seen.add(refKey)

        if (isExcluded?.(rel.uid)) continue

        plan.visited++

        let exists: boolean
        try {
          exists = await lookups.hasLocalization(rel, targetLocale)
        } catch {
          // Unknown → assume it exists. Skipping a translation is recoverable;
          // creating a duplicate or overwriting an editor's work is not.
          exists = true
        }

        if (exists) {
          plan.skippedExisting++
          continue
        }

        if (plan.nodes.length >= maxEntries) {
          plan.truncated = true
          return finish(plan)
        }

        plan.nodes.push({
          uid: rel.uid,
          documentId: rel.documentId,
          tier: tiers.get(rel.uid) ?? 0,
          depth: depth + 1,
        })
        next.push(rel)
      }
    }

    if (next.length > 0 && depth + 1 >= maxDepth) {
      plan.depthLimited = true
    }
    frontier = next
  }

  return finish(plan)
}

/**
 * Order by tier ascending so dependencies precede dependents.
 *
 * `sort` is stable, so within a tier — which is also where every cycle lands,
 * since an SCC shares one tier — discovery order is preserved. Cycles cannot be
 * ordered away: whichever member goes first has an unresolvable relation, and
 * that is exactly what the reverse relink pass repairs.
 */
function finish(plan: CascadePlan): CascadePlan {
  plan.nodes.sort((a, b) => a.tier - b.tier)
  return plan
}
