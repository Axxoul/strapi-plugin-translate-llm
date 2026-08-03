import { Core, UID } from '@strapi/strapi'
import {
  AutoTranslateConfigurableSettings,
  AutoTranslateLogEntry,
  AutoTranslateLogStatus,
  AutoTranslateQueueStatus,
  AutoTranslateSettings,
  AutoTranslateSettingsData,
} from '../../../shared/contracts/auto-translate'
import {
  AUTO_PUBLISH_MODES,
  AutoPublishMode,
  CASCADE_MODES,
  ON_SOURCE_UNPUBLISH_VALUES,
  TRANSLATE_ON_VALUES,
} from '../../../shared/types/auto-translate-options'
import { TranslateConfig } from '../config'
import { getService } from '../utils/get-service'
import { CascadeRef, planCascade } from '../utils/cascade-plan'
import { getRelatedDocuments } from '../utils/related-documents'
import { getTierMap } from '../utils/tier-map'
import { isDraftAndPublish, resolvePublish } from '../utils/resolve-publish'
import { isSingleType } from '../utils/content-type'

const AUTO_TRANSLATE_STORE_KEY = 'auto_translate_settings'
const LOG_UID = 'plugin::translate.auto-translate-log'

/**
 * How long a queued row waits before the executor picks it up.
 *
 * This replaces the old 300 ms debounce. The debounce delayed *creating* the log
 * row, so a restart inside the window lost the work with no trace (Rule 5); the
 * row is now written immediately and the delay moved to execution, where it
 * still collapses a rapid create-then-update into a single translation of the
 * latest content.
 */
const SETTLE_MS = 300

/** Attempts before a row is given up on. No exponential backoff — it fails loudly. */
const MAX_ATTEMPTS = 3

/** A live row older than this is surfaced as stuck rather than quietly waiting. */
const STALE_MS = 15 * 60 * 1000

/** How long merged settings are reused before being re-read from `core_store`. */
const SETTINGS_TTL_MS = 10_000

/** Live rows are exempt from age-based cleanup; these are the ones it may delete. */
const CLEANABLE_STATUSES: AutoTranslateLogStatus[] = [
  'success',
  'failed',
  'cancelled',
]

// Helper to access the log document service with loose typing
// (Strapi doesn't generate types for plugin content types at design time)
function logDocuments() {
  return strapi.documents(LOG_UID as any) as any
}

function logQuery() {
  return strapi.db.query(LOG_UID as any)
}

const STORE_DEFAULTS: Pick<AutoTranslateSettings, 'enabled' | 'masterLocale'> = {
  enabled: false,
  masterLocale: '',
}

/**
 * In-memory guard against infinite loops: every write this plugin makes is
 * flagged here so the document-service middleware skips it.
 */
const autoTranslateGuard = new Set<string>()

/**
 * Depth counter for "a plugin-originated write is in progress".
 *
 * Broader than {@link autoTranslateGuard}, which is keyed by document: the
 * reverse relink pass writes to *other* documents, and without this the
 * `afterUpdate` lifecycle would file every one of them as an entry needing
 * re-translation — the cascade polluting the table with its own output.
 */
let pluginWriteDepth = 0

/**
 * Fast-path dedupe. Authoritative dedupe is the `pending` row in the database;
 * this only saves the round trip on the hot path and is rebuilt from the DB on
 * restart, so a second process never depends on it being right.
 */
const inFlight = new Set<string>()

/**
 * The in-flight drain, or null when idle. Held as a promise rather than a
 * boolean so a second caller *joins* the running drain instead of returning
 * immediately and leaving the queue apparently finished when it is not.
 */
let drainPromise: Promise<void> | null = null
let cancelRequested = false
let planCounter = 0

let settingsCache: { value: AutoTranslateSettings; at: number } | null = null

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

function fileConfig(): TranslateConfig {
  return strapi.config.get<TranslateConfig>('plugin::translate')
}

/** File-config values for the settings the Settings page can override. */
function configurableDefaults(): AutoTranslateConfigurableSettings {
  const config = fileConfig()
  return {
    translateOn: config.translateOn ?? 'save',
    cascade: config.cascade ?? 'off',
    autoPublish: config.autoPublish ?? 'trigger',
    onSourceUnpublish: config.onSourceUnpublish ?? 'ignore',
    cascadeMaxEntries: config.cascadeMaxEntries ?? 50,
    cascadeMaxDepth: config.cascadeMaxDepth ?? 5,
    cascadeLocales: config.cascadeLocales ?? null,
    cascadeIgnoreContentTypes: config.cascadeIgnoreContentTypes ?? [],
  }
}

/** A stored value only overrides the file config when it is actually set. */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function pickEnum<T extends string>(
  stored: unknown,
  fallback: T,
  allowed: readonly T[]
): T {
  return isSet(stored) && allowed.includes(stored as T) ? (stored as T) : fallback
}

function pickPositiveInt(stored: unknown, fallback: number): number {
  const value = typeof stored === 'string' ? Number(stored) : stored
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : fallback
}

function pickStringArray(
  stored: unknown,
  fallback: string[] | null,
  allowNull: boolean
): string[] | null {
  if (Array.isArray(stored) && stored.every((v) => typeof v === 'string')) {
    // An empty allowlist means "no locales", which is never what a user wants
    // from a cleared form field — treat it as "unset" and fall back.
    if (allowNull && stored.length === 0) return fallback
    return stored
  }
  return fallback
}

function mergeSettings(stored: Record<string, any> | null): AutoTranslateSettings {
  const defaults = configurableDefaults()
  const s = stored ?? {}

  return {
    enabled: s.enabled ?? STORE_DEFAULTS.enabled,
    masterLocale: s.masterLocale ?? STORE_DEFAULTS.masterLocale,
    translateOn: pickEnum(s.translateOn, defaults.translateOn, TRANSLATE_ON_VALUES),
    cascade: pickEnum(s.cascade, defaults.cascade, CASCADE_MODES),
    autoPublish: pickEnum(s.autoPublish, defaults.autoPublish, AUTO_PUBLISH_MODES),
    onSourceUnpublish: pickEnum(
      s.onSourceUnpublish,
      defaults.onSourceUnpublish,
      ON_SOURCE_UNPUBLISH_VALUES
    ),
    cascadeMaxEntries: pickPositiveInt(
      s.cascadeMaxEntries,
      defaults.cascadeMaxEntries
    ),
    cascadeMaxDepth: pickPositiveInt(s.cascadeMaxDepth, defaults.cascadeMaxDepth),
    cascadeLocales: pickStringArray(
      s.cascadeLocales,
      defaults.cascadeLocales,
      true
    ),
    cascadeIgnoreContentTypes:
      pickStringArray(
        s.cascadeIgnoreContentTypes,
        defaults.cascadeIgnoreContentTypes,
        false
      ) ?? [],
  }
}

type QueueRow = {
  id: number
  documentId: string
  contentType: string
  entryDocumentId: string
  sourceLocale: string
  targetLocale: string
  status: AutoTranslateLogStatus
  attempts: number
  publishMode: AutoPublishMode
  triggerPublished: boolean
  isTrigger: boolean
  planId: string
  tier: number
  createdAt: string
}

type PendingRowInput = {
  contentType: string
  entryDocumentId: string
  displayName?: string
  sourceLocale: string
  targetLocale: string
  planId: string
  tier: number
  publishMode: AutoPublishMode
  triggerPublished: boolean
  isTrigger: boolean
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  isGuarded(contentType: string, documentId: string, locale: string): boolean {
    return autoTranslateGuard.has(guardKey(contentType, documentId, locale))
  },

  /** True while this plugin is writing — used to suppress `updated-entry` tracking. */
  isPluginWrite(): boolean {
    return pluginWriteDepth > 0
  },

  // ---------------------------------------------------------------------------
  // Settings — file config supplies the default, the DB store overrides it.
  // ---------------------------------------------------------------------------

  /** Merged settings, cached. Every hot path uses this instead of hitting `core_store`. */
  async getEffectiveSettings(): Promise<AutoTranslateSettings> {
    const now = Date.now()
    if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) {
      return settingsCache.value
    }
    const stored = (await getStore().get()) as Record<string, any> | null
    const value = mergeSettings(stored)
    settingsCache = { value, at: now }
    return value
  },

  invalidateSettingsCache(): void {
    settingsCache = null
  },

  /** The Settings page shape: effective values plus the file-config defaults. */
  async getSettings(): Promise<AutoTranslateSettingsData> {
    const settings = await this.getEffectiveSettings()
    return { ...settings, defaults: configurableDefaults() }
  },

  async updateSettings(
    input: Partial<AutoTranslateSettings>
  ): Promise<AutoTranslateSettingsData> {
    const current = ((await getStore().get()) as Record<string, any>) || {}
    const merged: Record<string, any> = { ...current }

    for (const key of Object.keys(input) as Array<keyof AutoTranslateSettings>) {
      const value = input[key]
      if (value !== undefined) merged[key] = value
    }
    merged.enabled = !!merged.enabled
    merged.masterLocale = merged.masterLocale || ''

    await getStore().set({ value: merged })
    this.invalidateSettingsCache()
    return this.getSettings()
  },

  // ---------------------------------------------------------------------------
  // Trigger
  // ---------------------------------------------------------------------------

  /**
   * Plan and enqueue the work for one triggering action on one source locale.
   *
   * Returns without doing anything unless auto-translate is on and `sourceLocale`
   * is the master locale — the middleware resolves every locale a publish touched
   * and calls this once per locale, so this is where `'*'` narrows to one.
   */
  async triggerAutoTranslate(
    contentType: string,
    documentId: string,
    sourceLocale: string,
    publishedNow: boolean
  ): Promise<void> {
    const settings = await this.getEffectiveSettings()
    if (!settings.enabled || !settings.masterLocale) return
    if (sourceLocale !== settings.masterLocale) return

    const ct = strapi.contentTypes[contentType]
    if (!ct?.pluginOptions?.i18n?.['localized']) return

    const config = fileConfig()
    if (config.ignoreUpdatedContentTypes?.includes(contentType)) return

    const targetLocales = await this._resolveTargetLocales(
      sourceLocale,
      settings
    )
    if (targetLocales.length === 0) return

    const displayName = await this._displayName(
      contentType,
      documentId,
      sourceLocale
    )

    const planId = `plan-${Date.now().toString(36)}-${++planCounter}`
    const tiers = getTierMap()
    const triggerTier = tiers.get(contentType) ?? 0

    // The trigger entry is queued for every allowed locale, so reserve its share
    // of the budget before dependencies get to spend any of it. Without this a
    // wide first locale would starve later locales of the entry they exist for.
    const budgetTotal = settings.cascadeMaxEntries
    const reservedForTriggers = Math.min(targetLocales.length, budgetTotal)
    let dependencyBudget = Math.max(0, budgetTotal - reservedForTriggers)

    const rows: PendingRowInput[] = []
    const cutShort: string[] = []
    const droppedLocales: string[] = []

    for (const [index, targetLocale] of targetLocales.entries()) {
      if (index >= reservedForTriggers) {
        droppedLocales.push(targetLocale)
        continue
      }

      if (settings.cascade === 'missing-only') {
        const plan = await this._planFor({
          contentType,
          documentId,
          sourceLocale,
          targetLocale,
          settings,
          tiers,
          budget: dependencyBudget,
        })

        for (const node of plan.nodes) {
          rows.push({
            contentType: node.uid,
            entryDocumentId: node.documentId,
            sourceLocale,
            targetLocale,
            planId,
            tier: node.tier,
            // Rule 3: a cascaded entry mirrors *its own* source's status, never
            // the trigger's. A published parent may reference a draft child.
            publishMode: 'mirror',
            triggerPublished: false,
            isTrigger: false,
          })
        }

        dependencyBudget -= plan.nodes.length
        if (plan.truncated || plan.depthLimited) cutShort.push(targetLocale)
      }

      rows.push({
        contentType,
        entryDocumentId: documentId,
        displayName,
        sourceLocale,
        targetLocale,
        planId,
        tier: triggerTier,
        publishMode: settings.autoPublish,
        triggerPublished: publishedNow,
        isTrigger: true,
      })
    }

    if (droppedLocales.length > 0) {
      strapi.log.warn(
        `[auto-translate] cascadeMaxEntries (${budgetTotal}) is lower than the number of target locales; ` +
          `no work was queued for: ${droppedLocales.join(', ')}`
      )
    }
    if (cutShort.length > 0) {
      strapi.log.warn(
        `[auto-translate] cascade bounds reached for ${contentType}:${documentId}; ` +
          `dependencies were cut short for: ${cutShort.join(', ')} ` +
          `(cascadeMaxEntries=${budgetTotal}, cascadeMaxDepth=${settings.cascadeMaxDepth})`
      )
    }

    const queued = await this._enqueue(rows)
    if (queued > 0) {
      strapi.log.debug(
        `[auto-translate] queued ${queued} entr${queued === 1 ? 'y' : 'ies'} for ${contentType}:${documentId} (${planId})`
      )
      this.startQueue()
    }
  },

  /**
   * `onSourceUnpublish: 'unpublish'` — take the trigger entry's translations
   * offline with it.
   *
   * Never cascaded: unpublishing a shared category because one article went
   * offline would take unrelated content down with it.
   */
  async handleSourceUnpublish(
    contentType: string,
    documentId: string,
    sourceLocale: string
  ): Promise<void> {
    const settings = await this.getEffectiveSettings()
    if (!settings.enabled || !settings.masterLocale) return
    if (settings.onSourceUnpublish !== 'unpublish') return
    if (sourceLocale !== settings.masterLocale) return
    if (!strapi.contentTypes[contentType]?.pluginOptions?.i18n?.['localized']) {
      return
    }
    if (!isDraftAndPublish(contentType)) return

    const targetLocales = await this._resolveTargetLocales(
      sourceLocale,
      settings
    )

    for (const targetLocale of targetLocales) {
      const key = guardKey(contentType, documentId, targetLocale)
      try {
        autoTranslateGuard.add(key)
        pluginWriteDepth++
        await strapi.documents(contentType as UID.ContentType).unpublish({
          documentId,
          locale: targetLocale,
        })
      } catch (error) {
        strapi.log.warn(
          `[auto-translate] failed to unpublish ${contentType}:${documentId} (${targetLocale}): ${
            (error as Error)?.message ?? error
          }`
        )
      } finally {
        pluginWriteDepth--
        autoTranslateGuard.delete(key)
      }
    }
  },

  async _resolveTargetLocales(
    sourceLocale: string,
    settings: AutoTranslateSettings
  ): Promise<string[]> {
    const locales: Array<{ code: string }> = await strapi
      .plugin('i18n')
      .service('locales')
      .find()

    let targets = locales
      .map((l) => l.code)
      .filter((code) => code !== sourceLocale)

    if (settings.cascadeLocales) {
      const allowed = new Set(settings.cascadeLocales)
      targets = targets.filter((code) => allowed.has(code))
    }
    return targets
  },

  async _planFor({
    contentType,
    documentId,
    sourceLocale,
    targetLocale,
    settings,
    tiers,
    budget,
  }: {
    contentType: string
    documentId: string
    sourceLocale: string
    targetLocale: string
    settings: AutoTranslateSettings
    tiers: Map<string, number>
    budget: number
  }) {
    const ignored = new Set(settings.cascadeIgnoreContentTypes)

    return planCascade({
      root: { uid: contentType, documentId },
      targetLocale,
      tiers,
      maxDepth: settings.cascadeMaxDepth,
      maxEntries: budget,
      isExcluded: (uid) => {
        if (ignored.has(uid)) return true
        // `translateEntity`'s single-type branch calls `create()` with no
        // existence check, so cascading into one would add a duplicate document
        // on every pass. Fixing that branch is separate, pre-existing work.
        if (isSingleType(uid)) return true
        return false
      },
      lookups: {
        getRelated: (ref: CascadeRef) =>
          getRelatedDocuments(
            ref.uid as UID.ContentType,
            ref.documentId,
            sourceLocale
          ),
        hasLocalization: async (ref, locale) =>
          (await strapi.documents(ref.uid as UID.ContentType).count({
            filters: { documentId: { $eq: ref.documentId } } as any,
            locale,
          })) > 0,
      },
    })
  },

  async _displayName(
    contentType: string,
    documentId: string,
    sourceLocale: string
  ): Promise<string> {
    const ct = strapi.contentTypes[contentType]
    const fallback = ct?.info?.displayName || contentType

    try {
      const mainField =
        (ct as any)?.pluginOptions?.['content-manager']?.mainField || 'title'
      const doc = await strapi.documents(contentType as any).findOne({
        documentId,
        locale: sourceLocale,
        fields: [mainField, 'title', 'name'] as any,
      })
      if (!doc) return fallback
      return (
        (doc as any)[mainField] ||
        (doc as any).title ||
        (doc as any).name ||
        fallback
      )
    } catch {
      return fallback
    }
  },

  // ---------------------------------------------------------------------------
  // Queue
  // ---------------------------------------------------------------------------

  /**
   * Write `pending` rows for a plan.
   *
   * Rows are inserted in plan order (dependencies by ascending tier, then the
   * trigger entry), and the executor consumes strictly by ascending id. That
   * gives the tier ordering *within* a plan without a global tier barrier: a
   * plan queued later never has to wait for another plan's tier-0 work to
   * finish before its own tier-1 work becomes eligible.
   */
  async _enqueue(rows: PendingRowInput[]): Promise<number> {
    let queued = 0

    for (const row of rows) {
      const key = guardKey(row.contentType, row.entryDocumentId, row.targetLocale)

      // Fast path — never authoritative.
      if (inFlight.has(key)) continue

      try {
        if (await this._hasLiveRow(row)) {
          inFlight.add(key)
          continue
        }

        const created = await logDocuments().create({
          data: { ...row, status: 'pending', attempts: 0 },
        })

        // Cross-process arbitration: two dynos can both pass the check above.
        // Whichever row got the lower id wins; the loser cancels itself, so the
        // work happens exactly once without a new locking mechanism.
        if (await this._losesRace(row, created.id)) {
          await this._setStatus(created.documentId, 'cancelled', {
            error: 'Superseded by an identical queued translation',
          })
          continue
        }

        inFlight.add(key)
        queued++
      } catch (error) {
        strapi.log.error(
          `[auto-translate] could not queue ${row.contentType}:${row.entryDocumentId} → ${row.targetLocale}: ${
            (error as Error)?.message ?? error
          }`
        )
      }
    }

    if (queued > 0) cancelRequested = false
    return queued
  },

  async _hasLiveRow(row: {
    contentType: string
    entryDocumentId: string
    targetLocale: string
  }): Promise<boolean> {
    const count = await logQuery().count({
      where: {
        contentType: row.contentType,
        entryDocumentId: row.entryDocumentId,
        targetLocale: row.targetLocale,
        status: { $in: ['pending', 'translating'] },
      },
    })
    return count > 0
  },

  async _losesRace(
    row: { contentType: string; entryDocumentId: string; targetLocale: string },
    ownId: number
  ): Promise<boolean> {
    // Without our own id there is nothing to compare against; keep the row and
    // let the pre-insert check be the only defence rather than risk cancelling
    // work over a malformed query.
    if (typeof ownId !== 'number') return false

    const count = await logQuery().count({
      where: {
        contentType: row.contentType,
        entryDocumentId: row.entryDocumentId,
        targetLocale: row.targetLocale,
        status: { $in: ['pending', 'translating'] },
        id: { $lt: ownId },
      },
    })
    return count > 0
  },

  /** Kick the executor if it is not already draining. Fire-and-forget. */
  startQueue(): void {
    this._drainQueue().catch((error) =>
      strapi.log.error(
        `[auto-translate] queue drain crashed: ${(error as Error)?.message ?? error}`
      )
    )
  },

  /** Resolves when the queue is empty. Joins an already-running drain. */
  _drainQueue(): Promise<void> {
    if (drainPromise) return drainPromise
    drainPromise = this._runDrain().finally(() => {
      drainPromise = null
    })
    return drainPromise
  },

  async _runDrain(): Promise<void> {
    while (!cancelRequested) {
      const row = await this._nextPendingRow()
      if (!row) break

      const wait = SETTLE_MS - (Date.now() - new Date(row.createdAt).getTime())
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
      if (cancelRequested) break

      await this._executeRow(row)
    }
  },

  async _nextPendingRow(): Promise<QueueRow | null> {
    const rows = await logQuery().findMany({
      where: { status: 'pending' },
      orderBy: { id: 'asc' },
      limit: 1,
    })
    return (rows?.[0] as QueueRow) ?? null
  },

  async _executeRow(row: QueueRow): Promise<void> {
    const key = guardKey(row.contentType, row.entryDocumentId, row.targetLocale)
    const attempts = (row.attempts ?? 0) + 1

    if (attempts > MAX_ATTEMPTS) {
      await this._setStatus(row.documentId, 'failed', {
        error: `Gave up after ${MAX_ATTEMPTS} attempts`,
        attempts,
      })
      inFlight.delete(key)
      return
    }

    await this._setStatus(row.documentId, 'translating', { attempts })
    inFlight.add(key)

    try {
      const publish = await resolvePublish({
        mode: row.publishMode ?? 'trigger',
        uid: row.contentType as UID.ContentType,
        documentId: row.entryDocumentId,
        sourceLocale: row.sourceLocale,
        triggerPublished: !!row.triggerPublished,
      })

      autoTranslateGuard.add(key)
      pluginWriteDepth++

      await getService('translate').translateEntity({
        documentId: row.entryDocumentId,
        contentType: row.contentType as any,
        sourceLocale: row.sourceLocale,
        targetLocale: row.targetLocale,
        create: true,
        // The trigger entry keeps overwriting its own translation, as it always
        // has. A cascaded dependency must not: if another process won the race
        // and created it, throwing is correct — clobbering is not.
        updateExisting: row.isTrigger !== false,
        publish,
        priority: 10, // lower priority than direct user translation
      })

      await this._setStatus(row.documentId, 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      strapi.log.error(
        `[auto-translate] Failed ${row.contentType}:${row.entryDocumentId} -> ${row.targetLocale}: ${message}`
      )
      await this._setStatus(row.documentId, 'failed', { error: message })
    } finally {
      pluginWriteDepth--
      autoTranslateGuard.delete(key)
      inFlight.delete(key)
    }
  },

  async _setStatus(
    documentId: string,
    status: AutoTranslateLogStatus,
    extra: Record<string, any> = {}
  ): Promise<void> {
    try {
      await logDocuments().update({
        documentId,
        data: { status, ...extra },
      })
    } catch (error) {
      strapi.log.warn(
        `[auto-translate] could not update queue row ${documentId} to ${status}: ${
          (error as Error)?.message ?? error
        }`
      )
    }
  },

  /**
   * Pick up work left behind by a restart.
   *
   * A row stuck in `translating` was interrupted mid-flight; it goes back to
   * `pending` with its attempt already counted, so a row that crashes the
   * process every time cannot loop forever.
   */
  async resumeQueue(): Promise<number> {
    cancelRequested = false
    inFlight.clear()

    let resumed = 0
    try {
      const interrupted = (await logQuery().findMany({
        where: { status: 'translating' },
        orderBy: { id: 'asc' },
      })) as QueueRow[]

      for (const row of interrupted) {
        await this._setStatus(row.documentId, 'pending')
        resumed++
      }

      const pending = (await logQuery().findMany({
        where: { status: 'pending' },
        orderBy: { id: 'asc' },
      })) as QueueRow[]

      for (const row of pending) {
        inFlight.add(
          guardKey(row.contentType, row.entryDocumentId, row.targetLocale)
        )
      }

      if (pending.length > 0) {
        strapi.log.info(
          `[auto-translate] resuming ${pending.length} queued translation(s)` +
            (resumed > 0 ? ` (${resumed} were interrupted mid-flight)` : '')
        )
        this.startQueue()
      }
    } catch (error) {
      strapi.log.warn(
        `[auto-translate] could not resume the queue: ${(error as Error)?.message ?? error}`
      )
    }
    return resumed
  },

  /** Kill switch — stops queued work without a restart. */
  async cancelQueue(): Promise<number> {
    cancelRequested = true

    const pending = (await logQuery().findMany({
      where: { status: 'pending' },
    })) as QueueRow[]

    for (const row of pending) {
      await this._setStatus(row.documentId, 'cancelled', {
        error: 'Cancelled from the Settings page',
      })
      inFlight.delete(
        guardKey(row.contentType, row.entryDocumentId, row.targetLocale)
      )
    }

    strapi.log.warn(
      `[auto-translate] queue cancelled — ${pending.length} pending translation(s) dropped`
    )
    return pending.length
  },

  async getQueueStatus(): Promise<AutoTranslateQueueStatus> {
    const [pending, translating, failed] = await Promise.all([
      logQuery().count({ where: { status: 'pending' } }),
      logQuery().count({ where: { status: 'translating' } }),
      logQuery().count({ where: { status: 'failed' } }),
    ])

    const oldest = await logQuery().findMany({
      where: { status: { $in: ['pending', 'translating'] } },
      orderBy: { createdAt: 'asc' },
      limit: 1,
    })
    const oldestPendingAt = oldest?.[0]?.createdAt
      ? new Date(oldest[0].createdAt).toISOString()
      : null

    const stale = await logQuery().count({
      where: {
        status: { $in: ['pending', 'translating'] },
        createdAt: { $lt: new Date(Date.now() - STALE_MS).toISOString() },
      },
    })

    return {
      pending,
      translating,
      failed,
      oldestPendingAt,
      stale,
      running: drainPromise !== null,
    }
  },

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------

  async getLogs(filters?: {
    status?: AutoTranslateLogStatus
    limit?: number
  }): Promise<AutoTranslateLogEntry[]> {
    const limit = filters?.limit || 50

    const where: Record<string, any> = {}
    if (filters?.status) {
      where.status = filters.status
    }

    const entries = await logQuery().findMany({
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
      updatedAt: e.updatedAt,
      planId: e.planId,
      tier: e.tier,
      attempts: e.attempts,
      publishMode: e.publishMode,
      triggerPublished: e.triggerPublished,
      isTrigger: e.isTrigger,
    }))
  },

  async clearLogs(): Promise<number> {
    const count = await logQuery().count({})
    if (count > 0) {
      await logQuery().deleteMany({ where: {} })
    }
    inFlight.clear()
    return count
  },

  /**
   * Age-based cleanup of *finished* rows only.
   *
   * `pending` and `translating` rows are queued work, not history. Deleting one
   * because it is old would silently drop the translation it stands for — the
   * same class of silent loss this whole feature exists to remove. A stuck row
   * stays and is surfaced by {@link getQueueStatus} instead.
   */
  async cleanupOldLogs(): Promise<void> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    await logQuery().deleteMany({
      where: {
        createdAt: { $lt: sevenDaysAgo.toISOString() },
        status: { $in: CLEANABLE_STATUSES },
      },
    })
  },
})
