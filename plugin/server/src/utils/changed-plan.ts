/**
 * Changed-batch planning — `POST /translate/batch/changed`. Mirrors the shape
 * of `cascade-plan.ts`: pure, Strapi-free, every lookup injected.
 */

import type { PendingRowInput } from '../../../shared/services/auto-translate'
import { AutoPublishMode } from '../../../shared/types/auto-translate-options'

export type ContentTypeSchema = {
  kind?: string
  pluginOptions?: { i18n?: { localized?: boolean } }
}

export type SelectContentTypesOptions = {
  /** `uid → tier`, from `getTierMap()`. Missing entries sort as tier 0. */
  tiers: Map<string, number>
  schemas: Record<string, ContentTypeSchema>
  /** `ignoreUpdatedContentTypes` — the same list `triggerAutoTranslate` honors. */
  ignore: string[]
  only?: string[]
}

/**
 * `api::*` localized collection types minus the ignore list, tier-ascending
 * with a `uid` tie-break for a deterministic order. Single types are excluded:
 * `translate.ts`'s single-type branch always `create()`s, which would mint a
 * duplicate document on every run instead of updating the existing one.
 */
export function selectContentTypes({
  tiers,
  schemas,
  ignore,
  only,
}: SelectContentTypesOptions): string[] {
  const ignoreSet = new Set(ignore)
  const onlySet = only?.length ? new Set(only) : null

  return Object.keys(schemas)
    .filter((uid) => {
      const schema = schemas[uid]
      return (
        uid.startsWith('api::') &&
        schema?.kind === 'collectionType' &&
        schema?.pluginOptions?.i18n?.localized === true &&
        !ignoreSet.has(uid) &&
        (!onlySet || onlySet.has(uid))
      )
    })
    .sort((a, b) => (tiers.get(a) ?? 0) - (tiers.get(b) ?? 0) || a.localeCompare(b))
}

export type ChangedDocument = { documentId: string; updatedAt: string }

export type BuildChangedRowsOptions = {
  /** Ordered uids, as returned by `selectContentTypes`. */
  uids: string[]
  changedByUid: Map<string, ChangedDocument[]>
  sourceLocale: string
  targetLocale: string
  publishMode: AutoPublishMode
  planId: string
  tierOf: (uid: string) => number
  /** Cross-type cap — the caller owns the per-type query cap. */
  maxTotal: number
}

/**
 * Flatten changed documents into queue rows in `uids` order, capped at
 * `maxTotal`. Every row is a direct trigger — there is no relation walk here,
 * only "this changed".
 */
export function buildChangedRows({
  uids,
  changedByUid,
  sourceLocale,
  targetLocale,
  publishMode,
  planId,
  tierOf,
  maxTotal,
}: BuildChangedRowsOptions): PendingRowInput[] {
  const rows: PendingRowInput[] = []

  for (const uid of uids) {
    const tier = tierOf(uid)
    for (const doc of changedByUid.get(uid) ?? []) {
      if (rows.length >= maxTotal) return rows
      rows.push({
        contentType: uid,
        entryDocumentId: doc.documentId,
        sourceLocale,
        targetLocale,
        planId,
        tier,
        publishMode,
        triggerPublished: false,
        isTrigger: true,
      })
    }
  }

  return rows
}
