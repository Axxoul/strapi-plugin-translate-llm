import { Core } from '@strapi/strapi'
import { getService } from '../utils/get-service'
import { isDraftAndPublish } from '../utils/resolve-publish'

/** Actions that can start a translation. */
const TRIGGER_ACTIONS = ['create', 'update', 'publish']

/**
 * Actions the middleware inspects at all.
 *
 * `unpublish` is here so `onSourceUnpublish` can act on it — and, just as
 * importantly, so the plugin's *own* unpublish writes hit the guard below
 * instead of re-entering.
 *
 * Deliberately absent:
 * - `delete` — Strapi removes a document's localizations with the document, so
 *   there is nothing to propagate.
 * - `discardDraft` — reverting a draft to its published content is an edit to
 *   the source locale that the editor has not published. It is picked up by the
 *   next save or publish like any other edit; propagating it eagerly would push
 *   machine output live off the back of an undo.
 */
const HANDLED_ACTIONS = [...TRIGGER_ACTIONS, 'unpublish']

/**
 * Resolve which source locales an action actually touched.
 *
 * `params.locale` is not reliable on its own: `@strapi/core` fills in the i18n
 * default *inside* the repository, after the middleware has run, so a plain
 * `publish({ documentId })` arrives here with `locale === undefined`. And
 * `publish` accepts `'*'` and arrays via `multiLocaleToLookup`. Reading the raw
 * value and returning early — which is what this used to do — made the feature
 * silently do nothing on the commonest publish shape of all.
 */
async function resolveLocales(
  strapi: Core.Strapi,
  raw: unknown
): Promise<string[]> {
  const localesService = strapi.plugin('i18n')?.service('locales')

  if (raw === '*') {
    const all: Array<{ code: string }> = (await localesService?.find()) ?? []
    return all.map((l) => l.code)
  }

  if (Array.isArray(raw)) {
    const expanded = await Promise.all(
      raw.map((entry) => resolveLocales(strapi, entry))
    )
    return [...new Set(expanded.flat())]
  }

  if (typeof raw === 'string' && raw.length > 0) {
    return [raw]
  }

  // Omitted → whatever i18n would have defaulted to.
  const fallback = await localesService?.getDefaultLocale?.()
  return fallback ? [fallback] : []
}

export function registerAutoTranslateMiddleware(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    const result = await next()

    const { action } = context
    const contentType =
      typeof context.contentType === 'string'
        ? context.contentType
        : (context.contentType as any)?.uid

    if (!contentType || typeof contentType !== 'string') return result
    if (!HANDLED_ACTIONS.includes(action)) return result

    // Skip plugin's own content types
    if (contentType.startsWith('plugin::translate.')) return result

    // Skip admin content types
    if (contentType.startsWith('admin::')) return result

    // Skip non-localized content types
    const ct = strapi.contentTypes[contentType as keyof typeof strapi.contentTypes]
    if (!(ct as any)?.pluginOptions?.i18n?.localized) return result

    const params = context.params as Record<string, any> | undefined
    const res = result as Record<string, any> | undefined

    const documentId: string | undefined =
      params?.documentId || res?.documentId
    if (!documentId) return result

    const autoTranslateService = getService('auto-translate')

    // `update({ status: 'published' })` and `create({ status: 'published' })` do
    // not emit a separate `publish` action — `repository.js` calls the
    // module-local `publish()` directly, so the internal publish never re-enters
    // this chain. Both shapes have to be recognised here or publishing an entry
    // the ordinary way would never trigger anything.
    const publishedNow =
      action === 'publish' ||
      (['create', 'update'].includes(action) && params?.status === 'published')

    let locales: string[]
    try {
      locales = await resolveLocales(strapi, params?.locale ?? res?.locale)
    } catch (err) {
      strapi.log.error('[auto-translate] Locale resolution failed:', err)
      return result
    }
    if (locales.length === 0) return result

    if (action === 'unpublish') {
      for (const locale of locales) {
        if (autoTranslateService.isGuarded(contentType, documentId, locale)) {
          continue
        }
        autoTranslateService
          .handleSourceUnpublish(contentType, documentId, locale)
          .catch((err: Error) =>
            strapi.log.error('[auto-translate] Unpublish handling failed:', err)
          )
      }
      return result
    }

    // `translateOn: 'publish'` waits for a publish — but only where a publish
    // exists. A content type without draft-and-publish has one row and no
    // publish event, so for it saving *is* publishing and it keeps firing on
    // create/update. Read off the schema, never off a name.
    let translateOn: string
    try {
      translateOn = (await autoTranslateService.getEffectiveSettings())
        .translateOn
    } catch (err) {
      strapi.log.error('[auto-translate] Could not read settings:', err)
      return result
    }

    if (
      translateOn === 'publish' &&
      isDraftAndPublish(contentType) &&
      !publishedNow
    ) {
      return result
    }

    for (const locale of locales) {
      // Guard (prevents infinite loop from our own writes)
      if (autoTranslateService.isGuarded(contentType, documentId, locale)) {
        continue
      }

      // Fire async — don't block the save response
      autoTranslateService
        .triggerAutoTranslate(contentType, documentId, locale, publishedNow)
        .catch((err: Error) =>
          strapi.log.error('[auto-translate] Trigger failed:', err)
        )
    }

    return result
  })
}
