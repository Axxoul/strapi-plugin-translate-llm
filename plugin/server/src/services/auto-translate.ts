import { Core } from '@strapi/strapi'
import {
  AutoTranslateLogEntry,
  AutoTranslateLogStatus,
  AutoTranslateSettings,
} from '../../../shared/contracts/auto-translate'
import { getService } from '../utils/get-service'

const AUTO_TRANSLATE_STORE_KEY = 'auto_translate_settings'
const LOG_UID = 'plugin::translate.auto-translate-log'

// Helper to access the log document service with loose typing
// (Strapi doesn't generate types for plugin content types at design time)
function logDocuments() {
  return strapi.documents(LOG_UID as any) as any
}

const DEFAULT_SETTINGS: AutoTranslateSettings = {
  enabled: false,
  masterLocale: '',
}

// In-memory guard to prevent infinite loops.
// When we write a translated entry, we add its key here so the middleware skips it.
const autoTranslateGuard = new Set<string>()

// Debounce map: documentId -> timeout handle
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

const DEBOUNCE_MS = 300

function guardKey(
  contentType: string,
  documentId: string,
  locale: string
): string {
  return `${contentType}:${documentId}:${locale}`
}

function getStore() {
  return strapi.store({
    type: 'plugin',
    name: 'translate',
    key: AUTO_TRANSLATE_STORE_KEY,
  })
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  isGuarded(contentType: string, documentId: string, locale: string): boolean {
    return autoTranslateGuard.has(guardKey(contentType, documentId, locale))
  },

  async getSettings(): Promise<AutoTranslateSettings> {
    const stored =
      ((await getStore().get()) as AutoTranslateSettings | null) || null
    if (!stored) return { ...DEFAULT_SETTINGS }
    return {
      enabled: stored.enabled ?? false,
      masterLocale: stored.masterLocale ?? '',
    }
  },

  async updateSettings(
    input: AutoTranslateSettings
  ): Promise<AutoTranslateSettings> {
    const settings: AutoTranslateSettings = {
      enabled: !!input.enabled,
      masterLocale: input.masterLocale || '',
    }
    await getStore().set({ value: settings })
    return settings
  },

  async triggerAutoTranslate(
    contentType: string,
    documentId: string,
    locale: string,
    isPublished: boolean
  ): Promise<void> {
    // Check if auto-translate is enabled and locale matches master
    const settings = await this.getSettings()
    if (!settings.enabled || !settings.masterLocale) return
    if (locale !== settings.masterLocale) return

    // Check content type is localized
    const ct = strapi.contentTypes[contentType]
    if (!ct?.pluginOptions?.i18n?.localized) return

    // Check ignore list
    const translateConfig = strapi.config.get<{
      ignoreUpdatedContentTypes: string[]
    }>('plugin::translate')
    if (translateConfig.ignoreUpdatedContentTypes?.includes(contentType)) return

    // Debounce by documentId — if user saves rapidly, only translate once
    const debounceKey = `${contentType}:${documentId}`
    const existing = debounceMap.get(debounceKey)
    if (existing) clearTimeout(existing)

    return new Promise<void>((resolve) => {
      debounceMap.set(
        debounceKey,
        setTimeout(async () => {
          debounceMap.delete(debounceKey)
          try {
            await this._executeAutoTranslate(
              contentType,
              documentId,
              locale,
              isPublished
            )
          } catch (err) {
            strapi.log.error(
              `[auto-translate] Unhandled error for ${contentType}:${documentId}:`,
              err
            )
          }
          resolve()
        }, DEBOUNCE_MS)
      )
    })
  },

  async _executeAutoTranslate(
    contentType: string,
    documentId: string,
    sourceLocale: string,
    isPublished: boolean
  ): Promise<void> {
    // Get all locales, filter out master
    const locales: Array<{ code: string }> = await strapi
      .plugin('i18n')
      .service('locales')
      .find()
    const targetLocales = locales
      .map((l) => l.code)
      .filter((code) => code !== sourceLocale)

    if (targetLocales.length === 0) return

    // Get a display name for the log
    const ct = strapi.contentTypes[contentType]
    const displayName = ct?.info?.displayName || contentType

    // Create log entries for all target locales
    const logEntries: Array<{ documentId: string; targetLocale: string }> = []
    for (const targetLocale of targetLocales) {
      const entry = await logDocuments().create({
        data: {
          contentType,
          entryDocumentId: documentId,
          displayName,
          sourceLocale,
          targetLocale,
          status: 'pending',
        },
      })
      logEntries.push({
        documentId: entry.documentId,
        targetLocale,
      })
    }

    // Translate sequentially to avoid overwhelming the provider
    const translateService = getService('translate')
    for (const logEntry of logEntries) {
      const key = guardKey(contentType, documentId, logEntry.targetLocale)

      // Update log to 'translating'
      await logDocuments().update({
        documentId: logEntry.documentId,
        data: { status: 'translating' },
      })

      try {
        // Add guard before writing translated content
        autoTranslateGuard.add(key)

        await translateService.translateEntity({
          documentId,
          contentType: contentType as any,
          sourceLocale,
          targetLocale: logEntry.targetLocale,
          create: true,
          updateExisting: true,
          publish: isPublished,
          priority: 10, // lower priority than direct user translation
        })

        // Update log to 'success'
        await logDocuments().update({
          documentId: logEntry.documentId,
          data: { status: 'success' },
        })
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err)
        strapi.log.error(
          `[auto-translate] Failed ${contentType}:${documentId} -> ${logEntry.targetLocale}: ${errorMessage}`
        )

        // Update log to 'failed'
        await logDocuments().update({
          documentId: logEntry.documentId,
          data: { status: 'failed', error: errorMessage },
        })
      } finally {
        autoTranslateGuard.delete(key)
      }
    }
  },

  async getLogs(
    filters?: { status?: AutoTranslateLogStatus; limit?: number }
  ): Promise<AutoTranslateLogEntry[]> {
    const limit = filters?.limit || 50

    const where: Record<string, any> = {}
    if (filters?.status) {
      where.status = filters.status
    }

    const entries = await strapi.db.query(LOG_UID as any).findMany({
      where,
      orderBy: { createdAt: 'desc' },
      limit,
    })

    return entries.map((e: any) => ({
      id: e.id,
      documentId: e.documentId,
      contentType: e.contentType,
      entryDocumentId: e.entryDocumentId,
      displayName: e.displayName,
      sourceLocale: e.sourceLocale,
      targetLocale: e.targetLocale,
      status: e.status,
      error: e.error,
      createdAt: e.createdAt,
    }))
  },

  async clearLogs(): Promise<number> {
    const count = await strapi.db.query(LOG_UID as any).count({})
    if (count > 0) {
      await strapi.db.query(LOG_UID as any).deleteMany({ where: {} })
    }
    return count
  },

  async cleanupOldLogs(): Promise<void> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    await strapi.db.query(LOG_UID as any).deleteMany({
      where: {
        createdAt: { $lt: sevenDaysAgo.toISOString() },
      },
    })
  },
})
