import { Core } from '@strapi/strapi'
import { getService } from '../utils/get-service'
import { handleContextError } from '../utils/handle-error'

export default (): Core.Controller => ({
  async getLogs(ctx) {
    try {
      const batchJobId = ctx.query.batchJobId as string | undefined
      const limit = ctx.query.limit
        ? parseInt(ctx.query.limit as string, 10)
        : undefined
      const data = await getService('batch-translate-log').listRecent({
        batchJobId,
        limit,
      })
      return { data }
    } catch (error) {
      return handleContextError(ctx, error, 'BatchTranslateLog.getLogsError')
    }
  },

  async clearLogs(ctx) {
    try {
      const batchJobId = ctx.query.batchJobId as string | undefined
      const cleared = await getService('batch-translate-log').clearAll({
        batchJobId,
      })
      return { data: { cleared } }
    } catch (error) {
      return handleContextError(ctx, error, 'BatchTranslateLog.clearLogsError')
    }
  },
})
