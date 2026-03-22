import { Core } from '@strapi/strapi'
import { z } from 'zod'
import { getService } from '../utils/get-service'
import { handleContextError } from '../utils/handle-error'

const autoTranslateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  masterLocale: z.string().optional(),
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
      const data = await getService('auto-translate').updateSettings({
        enabled: parsed.enabled ?? false,
        masterLocale: parsed.masterLocale ?? '',
      })
      return { data }
    } catch (error) {
      return handleContextError(
        ctx,
        error,
        'AutoTranslate.updateSettingsError'
      )
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
})
