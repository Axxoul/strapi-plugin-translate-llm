import type { Core } from '@strapi/strapi'

import { actions } from './services/permissions/actions'
import { getService } from './utils/get-service'
import { TranslateConfig } from './config'
import { createProvider } from './utils/create-provider'
import { registerAutoTranslateMiddleware } from './middlewares/auto-translate'

const IGNORED_UIDS = [
  'plugin::translate.auto-translate-log',
  'plugin::translate.batch-translate-job',
  'plugin::translate.batch-translate-log',
  'plugin::translate.updated-entry',
]

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

  // Listen for updates to entries, mark them as updated
  strapi.db.lifecycles.subscribe({
    afterUpdate(event) {
      // A translation, a cascade write or a relink is not an editor changing
      // content — filing it here would have the plugin fill the
      // "needs re-translation" table with its own output.
      if (getService('auto-translate').isPluginWrite()) return

      if (
        // content type must not be on ignore list
        event?.model?.uid &&
        !translateConfig.ignoreUpdatedContentTypes.includes(event.model.uid) &&
        !IGNORED_UIDS.includes(event.model.uid) &&
        // entity must have localizations
        event.result?.locale &&
        Array.isArray(event.result?.localizations) &&
        event.result.localizations.length > 0 &&
        // update must include relevant fields
        Object.keys(event.params.data).some(
          (key) => !['localizations', 'updatedAt', 'updatedBy'].includes(key)
        )
      ) {
        setTimeout(() => {
          strapi
            .documents('plugin::translate.updated-entry')
            .create({
              data: {
                contentType: event.model.uid,
                groupID: event.result.documentId,
                localesWithUpdates: [event.result.locale],
              },
            })
            .catch(console.error)
        })
      }
    },
  })

  await strapi.admin.services.permission.actionProvider.registerMany(actions)
  await getService('translate').batchTranslateManager.bootstrap()
}

export default bootstrap
