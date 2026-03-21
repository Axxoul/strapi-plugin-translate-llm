import { Core } from '@strapi/strapi'
import { ChunksService } from './chunks'
import { FormatService } from './format'
import { ProviderService } from './provider'
import { SettingsService } from './settings'
import { TranslateService } from './translate'
import { UntranslatedService } from './untranslated'

export * from './chunks'
export * from './format'
export * from './provider'
export * from './settings'
export * from './translate'
export * from './untranslated'

export interface ServiceMap {
  'batch-translate-job': Core.CoreAPI.Service.CollectionType
  chunks: ChunksService
  format: FormatService
  provider: ProviderService
  settings: SettingsService
  translate: TranslateService
  untranslated: UntranslatedService
  'updated-entry': Core.CoreAPI.Service.CollectionType
}

export type TranslatePluginService<ServiceName extends keyof ServiceMap> =
  ServiceMap[ServiceName]
