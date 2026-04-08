import { Core } from '@strapi/strapi'
import { BatchTranslateLogEntry } from '../../../shared/contracts/batch-translate-log'

const LOG_UID = 'plugin::translate.batch-translate-log'

function logDocuments() {
  return strapi.documents(LOG_UID as any) as any
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async createFailure(input: {
    batchJobId: string
    contentType: string
    entryDocumentId: string
    displayName?: string
    sourceLocale: string
    targetLocale: string
    error: string
  }): Promise<void> {
    try {
      await logDocuments().create({
        data: {
          batchJobId: input.batchJobId,
          contentType: input.contentType,
          entryDocumentId: input.entryDocumentId,
          displayName: input.displayName,
          sourceLocale: input.sourceLocale,
          targetLocale: input.targetLocale,
          error: input.error,
        },
      })
    } catch (err) {
      strapi.log.warn(
        `[batch-translate-log] Failed to persist failure entry: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  },

  async listRecent(filters?: {
    batchJobId?: string
    limit?: number
  }): Promise<BatchTranslateLogEntry[]> {
    const limit = filters?.limit || 50

    const where: Record<string, any> = {}
    if (filters?.batchJobId) {
      where.batchJobId = filters.batchJobId
    }

    const entries = await strapi.db.query(LOG_UID as any).findMany({
      where,
      orderBy: { createdAt: 'desc' },
      limit,
    })

    return entries.map((e: any) => ({
      id: e.id,
      documentId: e.documentId,
      batchJobId: e.batchJobId,
      contentType: e.contentType,
      entryDocumentId: e.entryDocumentId,
      displayName: e.displayName,
      sourceLocale: e.sourceLocale,
      targetLocale: e.targetLocale,
      error: e.error,
      createdAt: e.createdAt,
    }))
  },

  async clearAll(filters?: { batchJobId?: string }): Promise<number> {
    const where: Record<string, any> = {}
    if (filters?.batchJobId) {
      where.batchJobId = filters.batchJobId
    }
    const count = await strapi.db.query(LOG_UID as any).count({ where })
    if (count > 0) {
      await strapi.db.query(LOG_UID as any).deleteMany({ where })
    }
    return count
  },

  async cleanupOld(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs)
    await strapi.db.query(LOG_UID as any).deleteMany({
      where: {
        createdAt: { $lt: cutoff.toISOString() },
      },
    })
  },
})
