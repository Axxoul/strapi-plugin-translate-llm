declare module 'strapi-plugin-translate/shared' {
  export type TranslateProviderOptions = Record<string, any>

  export interface TranslateProviderTranslationArguments {
    text: string | string[] | object[]
    sourceLocale: string
    targetLocale: string
    priority?: number
    format?: 'plain' | 'markdown' | 'html' | 'jsonb'
  }

  export type TranslateProviderTranslationResult = string | string[] | object[]

  export interface TranslateProviderUsageResult {
    count: number
    limit: number
  }

  export interface InitializedProvider {
    translate(
      args: TranslateProviderTranslationArguments
    ): Promise<TranslateProviderTranslationResult>
    usage(): Promise<TranslateProviderUsageResult | undefined>
  }

  export interface TranslateProvider<O = TranslateProviderOptions> {
    provider: string
    name: string
    init(
      providerOptions?: O,
      pluginConfig?: Record<string, any>
    ): InitializedProvider
  }

  export interface ServiceMap {
    chunks: any
    format: any
    provider: any
    translate: any
    untranslated: any
    'batch-translate-job': any
    'updated-entry': any
  }

  export type TranslatePluginService<
    ServiceName extends keyof ServiceMap,
  > = ServiceMap[ServiceName]
}

declare const strapi: {
  plugin(name: string): {
    service<T = any>(name: string): T
  }
}
