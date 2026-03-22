import { Core } from '@strapi/strapi'
import { getService } from '../utils/get-service'

export function registerAutoTranslateMiddleware(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    const result = await next()

    const { action } = context
    const contentType =
      typeof context.contentType === 'string'
        ? context.contentType
        : (context.contentType as any)?.uid

    if (!contentType || typeof contentType !== 'string') return result

    // Only intercept create, update, publish
    if (!['create', 'update', 'publish'].includes(action)) return result

    // Skip plugin's own content types
    if (contentType.startsWith('plugin::translate.')) return result

    // Skip admin content types
    if (contentType.startsWith('admin::')) return result

    // Skip non-localized content types
    const ct = strapi.contentTypes[contentType as keyof typeof strapi.contentTypes]
    if (!(ct as any)?.pluginOptions?.i18n?.localized) return result

    const params = context.params as Record<string, any> | undefined
    const res = result as Record<string, any> | undefined

    const locale: string | undefined = params?.locale || res?.locale
    const documentId: string | undefined =
      params?.documentId || res?.documentId
    if (!locale || !documentId) return result

    // Check guard (prevents infinite loop from our own writes)
    const autoTranslateService = getService('auto-translate')
    if (autoTranslateService.isGuarded(contentType, documentId, locale)) {
      return result
    }

    const isPublished =
      params?.status === 'published' || action === 'publish'

    // Fire async — don't block the save response
    autoTranslateService
      .triggerAutoTranslate(contentType, documentId, locale, isPublished)
      .catch((err: Error) =>
        strapi.log.error('[auto-translate] Trigger failed:', err)
      )

    return result
  })
}
