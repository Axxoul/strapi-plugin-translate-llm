import { errors } from '@strapi/utils'
import {
  AutoPublishMode,
  CascadeMode,
  OnSourceUnpublish,
  TranslateOn,
} from '../types/auto-translate-options'

/**
 * Lifecycle of a queue row.
 *
 * `pending` and `translating` are *live* states — a row in either is queued work,
 * not a log entry, and is exempt from age-based cleanup.
 */
export type AutoTranslateLogStatus =
  | 'pending'
  | 'translating'
  | 'success'
  | 'failed'
  | 'cancelled'

/** Statuses that represent work still owed. */
export const LIVE_LOG_STATUSES: readonly AutoTranslateLogStatus[] = [
  'pending',
  'translating',
] as const

export interface AutoTranslateLogEntry {
  id: number
  documentId: string
  contentType: string
  entryDocumentId: string
  displayName?: string
  sourceLocale: string
  targetLocale: string
  status: AutoTranslateLogStatus
  error?: string
  createdAt: string
  updatedAt?: string
  /** Groups every row queued by one trigger. */
  planId?: string
  /** Dependency tier — rows are executed in ascending order within a plan. */
  tier?: number
  /** How many times execution has been started for this row. */
  attempts?: number
  /** Publish policy for this row (cascaded dependencies are always `mirror`). */
  publishMode?: AutoPublishMode
  /** Whether the triggering action published — resolves `publishMode: 'trigger'`. */
  triggerPublished?: boolean
  /** False for cascaded dependencies, true for the entry the editor acted on. */
  isTrigger?: boolean
}

export interface AutoTranslateSettings {
  enabled: boolean
  masterLocale: string
  translateOn: TranslateOn
  cascade: CascadeMode
  autoPublish: AutoPublishMode
  onSourceUnpublish: OnSourceUnpublish
  cascadeMaxEntries: number
  cascadeMaxDepth: number
  cascadeLocales: string[] | null
  cascadeIgnoreContentTypes: string[]
}

/** The subset of settings that has a file-config default the store can override. */
export type AutoTranslateConfigurableSettings = Omit<
  AutoTranslateSettings,
  'enabled' | 'masterLocale'
>

export interface AutoTranslateSettingsData extends AutoTranslateSettings {
  /** File-config values, so the UI can show which setting comes from where. */
  defaults: AutoTranslateConfigurableSettings
}

export interface AutoTranslateQueueStatus {
  /** Whether the executor is draining right now. */
  running: boolean
  pending: number
  translating: number
  failed: number
  /** ISO timestamp of the oldest live row, or null when the queue is empty. */
  oldestPendingAt: string | null
  /** Live rows older than the stale threshold — visibly stuck rather than gone. */
  stale: number
}

/**
 * GET /translate/auto-translate/settings
 */
export declare namespace AutoTranslateSettingsEndpoint {
  export namespace Get {
    export interface Request {
      query: {}
      body: {}
    }

    export type Response =
      | { data: AutoTranslateSettingsData }
      | { data: null; error: errors.ApplicationError }
  }

  export namespace Update {
    export interface Request {
      query: {}
      body: Partial<AutoTranslateSettings>
    }

    export type Response =
      | { data: AutoTranslateSettingsData }
      | { data: null; error: errors.ApplicationError }
  }
}

/**
 * GET /translate/auto-translate/logs
 */
export declare namespace AutoTranslateLogs {
  export namespace List {
    export interface Request {
      query: {
        status?: AutoTranslateLogStatus
        limit?: number
      }
      body: {}
    }

    export type Response =
      | { data: AutoTranslateLogEntry[] }
      | { data: null; error: errors.ApplicationError }
  }

  export namespace Clear {
    export interface Request {
      query: {}
      body: {}
    }

    export type Response =
      | { data: { cleared: number } }
      | { data: null; error: errors.ApplicationError }
  }
}

/**
 * GET /translate/auto-translate/queue — status
 * DELETE /translate/auto-translate/queue — kill switch
 */
export declare namespace AutoTranslateQueue {
  export namespace Status {
    export interface Request {
      query: {}
      body: {}
    }

    export type Response =
      | { data: AutoTranslateQueueStatus }
      | { data: null; error: errors.ApplicationError }
  }

  export namespace Cancel {
    export interface Request {
      query: {}
      body: {}
    }

    export type Response =
      | { data: { cancelled: number } }
      | { data: null; error: errors.ApplicationError }
  }
}
