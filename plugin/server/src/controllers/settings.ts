import { Core } from '@strapi/strapi'
import { z } from 'zod'
import { getService } from '../utils/get-service'
import { TranslateSettings } from '../../../shared/contracts/settings'
import { handleContextError } from '../utils/handle-error'

const settingsBodySchema = z.object({
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  customPrompt: z.string().optional(),
  localeMap: z.record(z.string()).optional(),
})

export interface SettingsController extends Core.Controller {
  getSettings: Core.ControllerHandler<TranslateSettings.Get.Response>
  updateSettings: Core.ControllerHandler<TranslateSettings.Update.Response>
}

export default (): SettingsController => ({
  async getSettings(ctx) {
    try {
      const data = await getService('settings').getSettings()
      return { data }
    } catch (error) {
      return handleContextError(ctx, error, 'Settings.getError')
    }
  },

  async updateSettings(ctx) {
    try {
      const parsed = settingsBodySchema.parse(ctx.request.body)
      const result = await getService('settings').updateSettings(parsed)
      if (result.warning) {
        return { data: result.data, warning: result.warning }
      }
      return { data: result.data }
    } catch (error) {
      return handleContextError(ctx, error, 'Settings.updateError')
    }
  },
})
