import { Core } from '@strapi/strapi'
import { z } from 'zod'
import { getService } from '../utils/get-service'
import { handleContextError } from '../utils/handle-error'

/**
 * Every field is optional: an omitted field means "leave as is", which is what
 * lets the DB store hold only the settings an operator actually overrode and the
 * rest fall through to the file config.
 */
const autoTranslateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  masterLocale: z.string().optional(),
  translateOn: z.enum(['save', 'publish']).optional(),
  cascade: z.enum(['off', 'missing-only']).optional(),
  autoPublish: z.enum(['draft', 'publish', 'mirror', 'trigger']).optional(),
  onSourceUnpublish: z.enum(['ignore', 'unpublish']).optional(),
  cascadeMaxEntries: z.number().int().min(1).optional(),
  cascadeMaxDepth: z.number().int().min(1).optional(),
  cascadeLocales: z.array(z.string()).nullable().optional(),
  cascadeIgnoreContentTypes: z.array(z.string()).optional(),
})

export default (): Core.Controller => ({
  async getSettings(ctx) {
    try {
      const data = await getService('auto-translate').getSettings()
      return { data }
    } catch (error) {
      return handleContextError(ctx, error, 'AutoTranslate.getSettingsError')
    }
  },

  async updateSettings(ctx) {
    try {
      const parsed = autoTranslateSettingsSchema.parse(ctx.request.body)
      const data = await getService('auto-translate').updateSettings(parsed)
      return { data }
    } catch (error) {
      return handleContextError(ctx, error, 'AutoTranslate.updateSettingsError')
    }
  },

  async getLogs(ctx) {
    try {
      const status = ctx.query.status as string | undefined
      const limit = ctx.query.limit
        ? parseInt(ctx.query.limit as string, 10)
        : undefined
      const data = await getService('auto-translate').getLogs({
        status: status as any,
        limit,
      })
      return { data }
    } catch (error) {
      return handleContextError(ctx, error, 'AutoTranslate.getLogsError')
    }
  },

  async clearLogs(ctx) {
    try {
      const cleared = await getService('auto-translate').clearLogs()
      return { data: { cleared } }
    } catch (error) {
      return handleContextError(ctx, error, 'AutoTranslate.clearLogsError')
    }
  },

  async getQueueStatus(ctx) {
    try {
      const data = await getService('auto-translate').getQueueStatus()
      return { data }
    } catch (error) {
      return handleContextError(ctx, error, 'AutoTranslate.getQueueStatusError')
    }
  },

  /** Kill switch — drops queued work without needing a restart. */
  async cancelQueue(ctx) {
    try {
      const cancelled = await getService('auto-translate').cancelQueue()
      return { data: { cancelled } }
    } catch (error) {
      return handleContextError(ctx, error, 'AutoTranslate.cancelQueueError')
    }
  },
})
