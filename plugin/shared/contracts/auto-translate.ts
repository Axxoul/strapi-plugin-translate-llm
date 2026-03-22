import { errors } from '@strapi/utils'

export type AutoTranslateLogStatus =
  | 'pending'
  | 'translating'
  | 'success'
  | 'failed'

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
}

export interface AutoTranslateSettings {
  enabled: boolean
  masterLocale: string
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
      | { data: AutoTranslateSettings }
      | { data: null; error: errors.ApplicationError }
  }

  export namespace Update {
    export interface Request {
      query: {}
      body: AutoTranslateSettings
    }

    export type Response =
      | { data: AutoTranslateSettings }
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
