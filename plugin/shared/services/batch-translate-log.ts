import { BatchTranslateLogEntry } from '../contracts/batch-translate-log'

export interface BatchTranslateLogService {
  createFailure(input: {
    batchJobId: string
    contentType: string
    entryDocumentId: string
    displayName?: string
    sourceLocale: string
    targetLocale: string
    error: string
  }): Promise<void>
  listRecent(filters?: {
    batchJobId?: string
    limit?: number
  }): Promise<BatchTranslateLogEntry[]>
  clearAll(filters?: { batchJobId?: string }): Promise<number>
  cleanupOld(olderThanMs?: number): Promise<void>
}
