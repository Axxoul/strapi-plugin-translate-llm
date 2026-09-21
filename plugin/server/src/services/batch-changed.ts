import { Core, UID } from '@strapi/strapi'
import {
  BatchChangedService,
  PublishChangedParams,
  PublishChangedResult,
  QueueChangedParams,
  QueueChangedResult,
} from '../../../shared/services/batch-changed'
import { TranslateConfig } from '../config'
import { getService } from '../utils/get-service'
import { getTierMap } from '../utils/tier-map'
import { isDraftAndPublish, resolvePublish } from '../utils/resolve-publish'
import {
  buildChangedRows,
  ChangedDocument,
  selectContentTypes,
} from '../utils/changed-plan'

/** Per-type cap on the change query — `documents().findMany` has no default limit. */
const MAX_PER_TYPE = 200
/** Cross-type cap on rows queued/published in one run. */
const MAX_TOTAL = 400

let runCounter = 0
const newPlanId = () => `changed-${Date.now().toString(36)}-${++runCounter}`

function fileConfig(): TranslateConfig {
  return strapi.config.get<TranslateConfig>('plugin::translate')
}

function selectUids(only?: string[]) {
  const tiers = getTierMap()
  const uids = selectContentTypes({
    tiers,
    schemas: strapi.contentTypes as any,
    ignore: fileConfig().ignoreUpdatedContentTypes ?? [],
    only,
  })
  return { uids, tiers }
}

/** Source drafts of `uid` changed after `since`, tier-neutral (one type at a time). */
async function findChanged(
  uid: string,
  sourceLocale: string,
  since: string
): Promise<ChangedDocument[]> {
  try {
    const docs = (await strapi.documents(uid as UID.ContentType).findMany({
      locale: sourceLocale,
      status: 'draft',
      filters: { updatedAt: { $gt: since } } as any,
      fields: ['documentId', 'updatedAt'] as any,
      sort: 'updatedAt:asc',
      limit: MAX_PER_TYPE,
    })) as unknown as ChangedDocument[]

    if (docs.length >= MAX_PER_TYPE) {
      strapi.log.warn(`[batch-changed] ${uid} hit the ${MAX_PER_TYPE}-per-type cap`)
    }
    return docs
  } catch (error) {
    strapi.log.warn(
      `[batch-changed] could not query ${uid}: ${(error as Error)?.message ?? error}`
    )
    return []
  }
}

export default ({ strapi }: { strapi: Core.Strapi }): BatchChangedService => ({
  async resolveSourceLocale(explicit?: string) {
    if (explicit) return explicit
    const settings = await getService('auto-translate').getEffectiveSettings()
    if (settings.masterLocale) return settings.masterLocale
    return (
      (await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.()) ??
      null
    )
  },

  async queueChanged(params: QueueChangedParams): Promise<QueueChangedResult> {
    const { uids, tiers } = selectUids(params.contentTypes)
    const planId = newPlanId()

    const changedByUid = new Map<string, ChangedDocument[]>()
    let total = 0
    for (const uid of uids) {
      const docs = await findChanged(uid, params.sourceLocale, params.since)
      changedByUid.set(uid, docs)
      total += docs.length
    }

    const rows = buildChangedRows({
      uids,
      changedByUid,
      sourceLocale: params.sourceLocale,
      targetLocale: params.targetLocale,
      publishMode: params.publishMode,
      planId,
      tierOf: (uid) => tiers.get(uid) ?? 0,
      maxTotal: MAX_TOTAL,
    })
    if (rows.length < total) {
      strapi.log.warn(
        `[batch-changed] ${planId} truncated ${total - rows.length} change(s) at MAX_TOTAL (${MAX_TOTAL})`
      )
    }

    const queuedByUid = new Map<string, number>()
    for (const row of rows) {
      queuedByUid.set(row.contentType, (queuedByUid.get(row.contentType) ?? 0) + 1)
    }

    const queued = await getService('auto-translate').enqueueRows(rows)
    if (queued > 0) getService('auto-translate').startQueue()

    const byContentType = uids.map((uid) => ({
      uid,
      tier: tiers.get(uid) ?? 0,
      changed: changedByUid.get(uid)?.length ?? 0,
      queued: queuedByUid.get(uid) ?? 0,
    }))

    strapi.log.info(
      `[batch-changed] ${planId} since=${params.since} target=${params.targetLocale} mode=translate ` +
        `types=[${uids.join(', ')}] queued=${queued} skipped=${total - queued}`
    )
    strapi.log.debug(`[batch-changed] ${planId} byContentType=${JSON.stringify(byContentType)}`)

    return { planId, total, queued, skipped: total - queued, byContentType }
  },

  async publishChanged(params: PublishChangedParams): Promise<PublishChangedResult> {
    const { uids, tiers } = selectUids(params.contentTypes)
    const planId = newPlanId()

    let total = 0
    let published = 0
    let skippedUnpublishedSource = 0
    let skippedNoTarget = 0
    let failed = 0
    const byContentType: PublishChangedResult['byContentType'] = []

    for (const uid of uids) {
      const docs = await findChanged(uid, params.sourceLocale, params.since)
      total += docs.length
      let uidPublished = 0

      for (const doc of docs) {
        try {
          const target = await strapi.documents(uid as UID.ContentType).findOne({
            documentId: doc.documentId,
            locale: params.targetLocale,
          })
          if (!target) {
            skippedNoTarget++
            continue
          }
          // A non-D&P type has one always-live row — nothing to publish.
          if (!isDraftAndPublish(uid)) continue

          const shouldPublish = await resolvePublish({
            mode: 'mirror',
            uid: uid as UID.ContentType,
            documentId: doc.documentId,
            sourceLocale: params.sourceLocale,
          })
          if (!shouldPublish) {
            skippedUnpublishedSource++
            continue
          }

          await strapi.documents(uid as UID.ContentType).publish({
            documentId: doc.documentId,
            locale: params.targetLocale,
          })
          published++
          uidPublished++
        } catch (error) {
          failed++
          await getService('batch-translate-log').createFailure({
            batchJobId: planId,
            contentType: uid,
            entryDocumentId: doc.documentId,
            sourceLocale: params.sourceLocale,
            targetLocale: params.targetLocale,
            error: (error as Error)?.message ?? String(error),
          })
        }
      }

      byContentType.push({
        uid,
        tier: tiers.get(uid) ?? 0,
        changed: docs.length,
        published: uidPublished,
      })
    }

    strapi.log.info(
      `[batch-changed] ${planId} since=${params.since} target=${params.targetLocale} mode=publish ` +
        `types=[${uids.join(', ')}] published=${published} failed=${failed}`
    )
    strapi.log.debug(`[batch-changed] ${planId} byContentType=${JSON.stringify(byContentType)}`)

    return {
      planId,
      total,
      published,
      skippedUnpublishedSource,
      skippedNoTarget,
      failed,
      byContentType,
    }
  },

  async getStatus(planId?: string) {
    const { pending, translating, failed, running, oldestPendingAt } =
      await getService('auto-translate').getQueueStatus()
    if (!planId) return { pending, translating, failed, running, oldestPendingAt }

    const failedLogs = await getService('auto-translate').getLogs({
      status: 'failed',
      planId,
      limit: MAX_TOTAL,
    })
    return { pending, translating, failed: failedLogs.length, running, oldestPendingAt }
  },
})
