import { Core, UID } from '@strapi/strapi'
import { keys } from './objects'

/**
 * A relation attribute on `uid` that points *at* another content type.
 * Collected per target so that after writing a document in a new locale we can
 * ask "who referenced this document in the source locale?" in O(1).
 */
export type IncomingRelation = {
  /** The content type that holds the relation attribute */
  uid: UID.ContentType
  /** The attribute name on `uid` */
  attr: string
  /** The raw attribute schema */
  attribute: Record<string, any>
}

const TO_MANY_RELATIONS = ['oneToMany', 'manyToMany', 'morphToMany']

/**
 * Maximum number of source-locale referrers handled per (contentType, attribute).
 * Guards against unbounded work when a widely referenced document (a country, a
 * theme) is translated.
 */
export const MAX_REFERRERS_PER_ATTRIBUTE = 500

/**
 * How long the index memo is trusted. The index only changes when the schemas
 * do, but the plugin has no reload event to hook, so a permanent memo went stale
 * after a content-type-builder change until the next restart. A TTL bounds that
 * to a minute; {@link clearIncomingRelationIndexCache} still forces a rebuild.
 */
const INDEX_TTL_MS = 60_000

let cachedIndex: Map<string, IncomingRelation[]> | null = null
let cachedIndexBuiltAt = 0

/**
 * Build (and memoize) an index of incoming relations:
 * `targetUid → [{ uid, attr, attribute }]`.
 *
 * Only relations that live on a **localized** content type are collected — a
 * relink can only ever write to a localization of the referring document, so a
 * non-localized referrer has nothing to fix. Relations marked
 * `pluginOptions.translate.translate === 'delete'` are excluded because the
 * editor explicitly asked for them to be dropped in other locales.
 *
 * Both sides of a bidirectional relation are indexed (`mappedBy` is *not*
 * skipped, unlike in {@link buildDependencyGraph}) so the relink works whichever
 * of the two documents happens to be written second.
 */
export function buildIncomingRelationIndex(
  strapiInstance: Core.Strapi = strapi
): Map<string, IncomingRelation[]> {
  if (cachedIndex && Date.now() - cachedIndexBuiltAt < INDEX_TTL_MS) {
    return cachedIndex
  }

  const index = new Map<string, IncomingRelation[]>()

  const localizedTypes = keys(strapiInstance.contentTypes).filter(
    (ct) =>
      strapiInstance.contentTypes[ct].pluginOptions?.i18n?.['localized'] ===
      true
  )

  for (const uid of localizedTypes) {
    const attributes = strapiInstance.contentTypes[uid].attributes ?? {}

    for (const attr of Object.keys(attributes)) {
      const attribute = attributes[attr] as Record<string, any>

      if (attribute.type !== 'relation') continue

      // i18n's own `localizations` back-reference and other virtual relations are
      // maintained by Strapi and cannot be written to
      if (attribute.writable === false || attribute.unstable_virtual === true) {
        continue
      }

      const onTranslate =
        attribute.pluginOptions?.translate?.translate ?? 'translate'
      if (onTranslate === 'delete') continue

      const target = attribute.target as string
      if (!target) continue

      // Only localized targets can be missing a localization in the first place
      if (
        strapiInstance.contentTypes[target]?.pluginOptions?.i18n?.[
          'localized'
        ] !== true
      ) {
        continue
      }

      if (!index.has(target)) {
        index.set(target, [])
      }
      index.get(target)!.push({
        uid: uid as UID.ContentType,
        attr,
        attribute,
      })
    }
  }

  cachedIndex = index
  cachedIndexBuiltAt = Date.now()
  return index
}

/** Reset the memoized index — used by tests and on schema reload. */
export function clearIncomingRelationIndexCache() {
  cachedIndex = null
  cachedIndexBuiltAt = 0
}

function isToMany(attribute: Record<string, any>) {
  return TO_MANY_RELATIONS.includes(attribute.relation)
}

function alreadyLinked(
  current: any,
  documentId: string,
  toMany: boolean
): boolean {
  if (toMany) {
    return (
      Array.isArray(current) &&
      current.some((related) => related?.documentId === documentId)
    )
  }
  return current?.documentId === documentId
}

export type RelinkParams = {
  /** The content type of the document that was just written in `targetLocale` */
  uid: UID.ContentType
  documentId: string
  sourceLocale: string
  targetLocale: string
}

export type RelinkResult = {
  linked: number
  skipped: number
  errors: number
}

/**
 * Reverse (incoming) relation pass.
 *
 * The forward mapping in `translate-relations.ts` can only link to localizations
 * that already exist — when the related document gets its target locale *later*,
 * the link is silently lost forever. This pass runs after a document is written
 * in `targetLocale` and re-establishes those links from the other side: every
 * document that referenced `documentId` in `sourceLocale` gets the same link on
 * its `targetLocale` localization.
 *
 * Guarantees:
 * - **Additive only.** Uses `connect` for to-many and only fills *empty* to-one
 *   attributes, so editor-made links are never overwritten or disconnected.
 * - **Never fatal.** Every step is guarded; a failure is logged and the
 *   translation that triggered it still succeeds.
 * - Works with documentIds so Strapi resolves the correct locale and both the
 *   draft and published rows of draft-and-publish targets.
 */
export async function relinkIncomingRelations({
  uid,
  documentId,
  sourceLocale,
  targetLocale,
}: RelinkParams): Promise<RelinkResult> {
  const result: RelinkResult = { linked: 0, skipped: 0, errors: 0 }

  if (!documentId || sourceLocale === targetLocale) {
    return result
  }

  let incoming: IncomingRelation[]
  try {
    incoming = buildIncomingRelationIndex().get(uid) ?? []
  } catch (error) {
    strapi.log.warn(
      `[translate] could not build incoming relation index: ${error?.message ?? error}`
    )
    return { ...result, errors: 1 }
  }

  for (const { uid: sourceUid, attr, attribute } of incoming) {
    const toMany = isToMany(attribute)

    try {
      const referrers = await strapi.documents(sourceUid).findMany({
        locale: sourceLocale,
        filters: { [attr]: { documentId: { $eq: documentId } } } as any,
        fields: ['documentId'] as any,
        limit: MAX_REFERRERS_PER_ATTRIBUTE,
      } as any)

      if (referrers?.length === MAX_REFERRERS_PER_ATTRIBUTE) {
        strapi.log.warn(
          `[translate] relink hit the ${MAX_REFERRERS_PER_ATTRIBUTE} referrer cap for ${sourceUid}.${attr} → ${uid}; some links may remain unset`
        )
      }

      for (const referrer of referrers ?? []) {
        try {
          const localized = await strapi.documents(sourceUid).findOne({
            documentId: referrer.documentId,
            locale: targetLocale,
            populate: { [attr]: { fields: ['documentId'] } } as any,
          })

          // The referrer itself has no target-locale localization (yet) — its own
          // translation will run the forward mapping, which now resolves.
          if (!localized) {
            result.skipped++
            continue
          }

          const current = localized[attr]

          if (alreadyLinked(current, documentId, toMany)) {
            result.skipped++
            continue
          }

          // Never overwrite an existing to-one link made by an editor
          if (!toMany && current) {
            strapi.log.debug(
              `[translate] relink skipped ${sourceUid}.${attr} (${referrer.documentId}, ${targetLocale}): already points elsewhere`
            )
            result.skipped++
            continue
          }

          await strapi.documents(sourceUid).update({
            documentId: referrer.documentId,
            locale: targetLocale,
            data: {
              // Longhand `{ documentId }`, never a bare string. Strapi's relation
              // shorthand parser misparses a documentId that starts with a digit
              // as a numeric id (parseInt), so bare strings link the wrong row or
              // fail; the object form always resolves correctly.
              [attr]: toMany ? { connect: [{ documentId }] } : { documentId },
            } as any,
          })

          result.linked++
        } catch (error) {
          result.errors++
          strapi.log.warn(
            `[translate] failed to relink ${sourceUid}.${attr} for ${referrer?.documentId} (${targetLocale}): ${error?.message ?? error}`
          )
        }
      }
    } catch (error) {
      result.errors++
      strapi.log.warn(
        `[translate] failed to look up referrers of ${uid} through ${sourceUid}.${attr}: ${error?.message ?? error}`
      )
    }
  }

  if (result.linked > 0 || result.errors > 0) {
    strapi.log.debug(
      `[translate] relinked ${result.linked} incoming relation(s) for ${uid}:${documentId} in ${targetLocale} (skipped ${result.skipped}, errors ${result.errors})`
    )
  }

  return result
}
