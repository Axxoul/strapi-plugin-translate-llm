import { UID } from '@strapi/strapi'
import { AutoPublishMode } from '@shared/types/auto-translate-options'

/**
 * Whether a content type has draft-and-publish enabled.
 *
 * Read off the schema, never inferred from names. A type without D&P has no
 * publish event and exactly one row, so for it "saved" and "published" are the
 * same thing and `status` is ignored by Strapi entirely
 * (`document-service/draft-and-publish.js` → `statusToData`).
 */
export function isDraftAndPublish(uid: string): boolean {
  return (strapi.contentTypes[uid] as any)?.options?.draftAndPublish === true
}

export type ResolvePublishParams = {
  mode: AutoPublishMode
  uid: UID.ContentType
  /** Absent for single types. */
  documentId?: string | null
  sourceLocale: string
  /**
   * Whether the action that triggered this translation published. Only consulted
   * by `mode: 'trigger'`; pass the middleware's `publishedNow`.
   */
  triggerPublished?: boolean
}

/**
 * Resolve `publish` for a single translation write.
 *
 * `trigger` is a verbatim pass-through of the triggering action's publish flag —
 * that is what auto-translate did before this option existed, and keeping it
 * exact is what makes the default upgrade path a no-op (Rule 0). In particular
 * it does **not** branch on draft-and-publish: for a non-D&P type Strapi ignores
 * `status` anyway, so branching would only risk changing the parameters an
 * existing installation writes.
 */
export async function resolvePublish({
  mode,
  uid,
  documentId,
  sourceLocale,
  triggerPublished = false,
}: ResolvePublishParams): Promise<boolean> {
  switch (mode) {
    case 'draft':
      return false
    case 'publish':
      return true
    case 'trigger':
      return triggerPublished
    case 'mirror':
      return sourceHasPublishedRow(uid, documentId, sourceLocale)
    default:
      return triggerPublished
  }
}

/**
 * `mirror` = "does the source document have a published version?".
 *
 * A non-D&P source has a single, always-live row, so it mirrors as published.
 * Returning `true` there is also inert: Strapi ignores `status` for such types.
 */
async function sourceHasPublishedRow(
  uid: UID.ContentType,
  documentId: string | null | undefined,
  sourceLocale: string
): Promise<boolean> {
  if (!isDraftAndPublish(uid)) {
    return true
  }

  try {
    const published = documentId
      ? await strapi.documents(uid).findOne({
          documentId,
          locale: sourceLocale,
          status: 'published',
        })
      : await strapi
          .documents(uid)
          .findFirst({ locale: sourceLocale, status: 'published' })
    return !!published
  } catch (error) {
    strapi.log.warn(
      `[translate] could not resolve mirror publish status for ${uid}:${documentId} (${sourceLocale}): ${
        (error as Error)?.message ?? error
      } — defaulting to draft`
    )
    return false
  }
}
