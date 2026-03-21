import { errors } from '@strapi/utils'

export interface ProviderSettingsData {
  provider: string
  apiKey?: string
  apiUrl?: string
  model?: string
  temperature?: number
  customPrompt?: string
  localeMap?: Record<string, string>
  /** Values from config/plugins.js (env vars resolved) — read-only reference */
  defaults?: {
    apiKey?: boolean
    apiUrl?: string
    model?: string
    temperature?: number
    customPrompt?: string
    localeMap?: Record<string, string>
  }
}

/**
 * GET /translate/settings - Get provider settings
 */
export declare namespace TranslateSettings {
  export namespace Get {
    export interface Request {
      query: {}
      body: {}
    }

    export type Response =
      | { data: ProviderSettingsData }
      | {
          data: null
          error: errors.ApplicationError
        }
  }

  export namespace Update {
    export interface Request {
      query: {}
      body: Omit<ProviderSettingsData, 'provider' | 'defaults'>
    }

    export type Response =
      | { data: ProviderSettingsData; warning?: string }
      | {
          data: null
          error: errors.ApplicationError
        }
  }
}
