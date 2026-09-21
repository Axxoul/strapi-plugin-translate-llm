import {
  AutoTranslateLogEntry,
  AutoTranslateLogStatus,
  AutoTranslateQueueStatus,
  AutoTranslateSettings,
  AutoTranslateSettingsData,
} from '../contracts/auto-translate'
import { AutoPublishMode } from '../types/auto-translate-options'

/** A row the persisted queue will write as `pending`. */
export type PendingRowInput = {
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

export interface AutoTranslateService {
  /** True while the plugin holds a write lock on this exact localization. */
  isGuarded(contentType: string, documentId: string, locale: string): boolean
  /**
   * True while *any* plugin-originated write is in flight, including the relink
   * pass writing to other documents. Used to keep the cascade's own output out
   * of the `updated-entry` table.
   */
  isPluginWrite(): boolean

  /**
   * Plan and enqueue translation work for one source locale of one document.
   * A no-op unless auto-translate is enabled and `locale` is the master locale.
   */
  triggerAutoTranslate(
    contentType: string,
    documentId: string,
    locale: string,
    publishedNow: boolean
  ): Promise<void>

  /** `onSourceUnpublish: 'unpublish'` — trigger entry only, never cascaded. */
  handleSourceUnpublish(
    contentType: string,
    documentId: string,
    locale: string
  ): Promise<void>

  getLogs(filters?: {
    status?: AutoTranslateLogStatus
    limit?: number
    planId?: string
  }): Promise<AutoTranslateLogEntry[]>
  clearLogs(): Promise<number>
  /**
   * Removes *finished* log entries older than the retention window (called on
   * bootstrap). Pending and translating rows are queued work and are never
   * removed by age.
   */
  cleanupOldLogs(): Promise<void>

  /** Merged file-config + store settings, cached. Use this on hot paths. */
  getEffectiveSettings(): Promise<AutoTranslateSettings>
  invalidateSettingsCache(): void
  /** Effective settings plus the file-config defaults, for the Settings page. */
  getSettings(): Promise<AutoTranslateSettingsData>
  updateSettings(
    input: Partial<AutoTranslateSettings>
  ): Promise<AutoTranslateSettingsData>

  /** Public wrapper around the persisted-queue writer, for other services. */
  enqueueRows(rows: PendingRowInput[]): Promise<number>
  /** Start draining the queue if it is not already running. */
  startQueue(): void
  /** Re-queue work interrupted by a restart. Returns how many were interrupted. */
  resumeQueue(): Promise<number>
  /** Kill switch — cancels pending rows. Returns how many were dropped. */
  cancelQueue(): Promise<number>
  getQueueStatus(): Promise<AutoTranslateQueueStatus>
}
