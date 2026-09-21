import type { Core } from '@strapi/strapi'

import { actions } from './services/permissions/actions'
import { getService } from './utils/get-service'
import { TranslateConfig } from './config'
import { createProvider } from './utils/create-provider'
import { registerAutoTranslateMiddleware } from './middlewares/auto-translate'

const bootstrap: Core.Plugin['bootstrap'] = async ({ strapi }) => {
  const translateConfig =
    strapi.config.get<TranslateConfig>('plugin::translate')

  // Merge file config with DB-stored settings (UI overrides)
  const mergedOptions = await getService('settings').getMergedProviderOptions()
  strapi.plugin('translate').provider = await createProvider(
    translateConfig.provider,
    mergedOptions
  )

  // Register auto-translate document service middleware
  registerAutoTranslateMiddleware(strapi)

  // Clean up finished auto-translate logs (older than 7 days), then pick up any
  // queued translations a restart interrupted. Order matters only for tidiness:
  // cleanup never touches pending/translating rows.
  getService('auto-translate')
    .cleanupOldLogs()
    .catch((err: Error) =>
      strapi.log.warn('[auto-translate] Log cleanup failed:', err)
    )
    .then(() => getService('auto-translate').resumeQueue())
    .catch((err: Error) =>
      strapi.log.warn('[auto-translate] Queue resume failed:', err)
    )

  // Clean up old batch-translate logs (older than 7 days)
  getService('batch-translate-log')
    .cleanupOld()
    .catch((err: Error) =>
      strapi.log.warn('[batch-translate-log] Log cleanup failed:', err)
    )

  await strapi.admin.services.permission.actionProvider.registerMany(actions)
  await getService('translate').batchTranslateManager.bootstrap()
}

export default bootstrap
