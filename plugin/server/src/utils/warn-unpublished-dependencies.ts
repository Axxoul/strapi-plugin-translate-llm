import { Struct, UID } from '@strapi/strapi'
import { CascadeRef } from './cascade-plan'
import { collectRelationRefs } from './related-documents'
import { isDraftAndPublish } from './resolve-publish'

export type UnpublishedDependencyReport = {
  /** Source published, target-locale dependency draft-only — a target-only gap. */
  legacy: CascadeRef[]
  /** The dependency's own source is unpublished too — believed a faithful mirror. */
  mirrored: CascadeRef[]
}

/**
 * Warn when a relation is about to be written on a **published** row whose
 * target has no published row to link to.
 *
 * This is a different failure from the one `logDroppedRelations` covers, and it
 * is invisible to it: `getRelevantLocalization()` calls `findOne({documentId,
 * locale})` with no status, which defaults to the draft, so a draft-only
 * dependency *resolves successfully* and is never dropped by
 * `translateRelation`. The loss happens one layer later, silently, inside
 * Strapi's relation transform — `dp.js` resolves the write against the target's
 * published row, which does not exist, and the link simply never appears.
 *
 * Two cases, deliberately logged at different levels:
 *
 * - **legacy** — the dependency *is* published in the source locale but its
 *   target-locale twin is a draft-only entry (typically from a pre-cascade
 *   translation). The gap exists only in the target locale. This is the one
 *   worth shouting about; repair belongs to a backfill, not to the cascade,
 *   because publishing an existing draft to satisfy a parent's link would push
 *   unreviewed content live.
 * - **mirrored** — the dependency is unpublished in the source locale too, so
 *   the source's own published row should have the identical gap for the
 *   identical reason. Believed faithful, logged at debug. This rests on the
 *   source-parity assertion (step 9.7 of the brief); if parity turns out not to
 *   hold, this case has to be promoted to a warning as well.
 */
export async function warnUnpublishedDependencies({
  data,
  schema,
  parentUid,
  parentDocumentId,
  sourceLocale,
  targetLocale,
}: {
  data: Record<string, any>
  schema: Struct.ContentTypeSchema
  parentUid: string
  parentDocumentId?: string | null
  sourceLocale: string
  targetLocale: string
}): Promise<UnpublishedDependencyReport> {
  const report: UnpublishedDependencyReport = { legacy: [], mirrored: [] }

  const refs: CascadeRef[] = []
  collectRelationRefs(data, schema.attributes as Record<string, any>, refs)

  const seen = new Set<string>()

  for (const ref of refs) {
    const key = `${ref.uid}:${ref.documentId}`
    if (seen.has(key)) continue
    seen.add(key)

    // Only a draft-and-publish target can have a missing published row.
    if (!isDraftAndPublish(ref.uid)) continue

    try {
      const targetPublished = await strapi
        .documents(ref.uid as UID.ContentType)
        .findOne({
          documentId: ref.documentId,
          locale: targetLocale,
          status: 'published',
        })
      if (targetPublished) continue

      const sourcePublished = await strapi
        .documents(ref.uid as UID.ContentType)
        .findOne({
          documentId: ref.documentId,
          locale: sourceLocale,
          status: 'published',
        })

      if (sourcePublished) {
        report.legacy.push(ref)
      } else {
        report.mirrored.push(ref)
      }
    } catch (error) {
      // A check that cannot run must never fail the translation it is checking.
      strapi.log.debug(
        `[translate] could not check published row for ${ref.uid}:${ref.documentId}: ${
          (error as Error)?.message ?? error
        }`
      )
    }
  }

  const parent = `${parentUid}:${parentDocumentId ?? '?'}`

  for (const ref of report.legacy) {
    strapi.log.warn(
      `[translate] publishing ${parent} in ${targetLocale}, but its dependency ` +
        `${ref.uid}:${ref.documentId} exists in ${targetLocale} as a draft only ` +
        `(it IS published in ${sourceLocale}). The relation will be missing from ` +
        `the published row and therefore from the API. Publish that entry, or run ` +
        `the localized-relation backfill.`
    )
  }

  if (report.mirrored.length > 0) {
    strapi.log.debug(
      `[translate] publishing ${parent} in ${targetLocale} with ` +
        `${report.mirrored.length} dependenc${report.mirrored.length === 1 ? 'y' : 'ies'} ` +
        `unpublished in both ${sourceLocale} and ${targetLocale} — mirrors the source`
    )
  }

  return report
}
