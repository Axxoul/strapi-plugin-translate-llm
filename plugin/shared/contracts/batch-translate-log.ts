import { errors } from '@strapi/utils'

export interface BatchTranslateLogEntry {
  id: number
  documentId: string
  batchJobId: string
  contentType: string
  entryDocumentId: string
  displayName?: string
  sourceLocale: string
  targetLocale: string
  error: string
  createdAt: string
}

/**
 * GET /translate/batch-translate/logs
 */
export declare namespace BatchTranslateLogs {
  export namespace List {
    export interface Request {
      query: {
        batchJobId?: string
        limit?: number
      }
      body: {}
    }

    export type Response =
      | { data: BatchTranslateLogEntry[] }
      | { data: null; error: errors.ApplicationError }
  }

  export namespace Clear {
    export interface Request {
      query: {
        batchJobId?: string
      }
      body: {}
    }

    export type Response =
      | { data: { cleared: number } }
      | { data: null; error: errors.ApplicationError }
  }
}
