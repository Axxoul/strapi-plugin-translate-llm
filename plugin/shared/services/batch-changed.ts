import { BatchAutoPublishMode } from '../types/auto-translate-options'

export type ChangedByContentType = { uid: string; tier: number; changed: number }

export interface QueueChangedParams {
  since: string
  sourceLocale: string
  targetLocale: string
  publishMode: BatchAutoPublishMode
  contentTypes?: string[]
}

export interface QueueChangedResult {
  planId: string
  total: number
  queued: number
  skipped: number
  byContentType: Array<ChangedByContentType & { queued: number }>
}

export interface ChangedQueueStatus {
  pending: number
  translating: number
  failed: number
  running: boolean
  oldestPendingAt: string | null
}

/** Backs `POST /translate/batch/changed` and its status endpoint — n8n-driven. */
export interface BatchChangedService {
  /** `explicit` (the request body's `sourceLocale`) wins; else the auto-translate
   * master locale; else the i18n default locale. `null` when none resolve. */
  resolveSourceLocale(explicit?: string): Promise<string | null>
  queueChanged(params: QueueChangedParams): Promise<QueueChangedResult>
  getStatus(planId?: string): Promise<ChangedQueueStatus>
}
