import { Core } from '@strapi/strapi'
import { AutoTranslateService } from './auto-translate'
import { BatchChangedService } from './batch-changed'
import { BatchTranslateLogService } from './batch-translate-log'
import { ChunksService } from './chunks'
import { FormatService } from './format'
import { ProviderService } from './provider'
import { SettingsService } from './settings'
import { TranslateService } from './translate'
import { UntranslatedService } from './untranslated'

export * from './auto-translate'
export * from './batch-changed'
export * from './batch-translate-log'
export * from './chunks'
export * from './format'
export * from './provider'
export * from './settings'
export * from './translate'
export * from './untranslated'

export interface ServiceMap {
  'auto-translate': AutoTranslateService
  'auto-translate-log': Core.CoreAPI.Service.CollectionType
  'batch-changed': BatchChangedService
  'batch-translate-job': Core.CoreAPI.Service.CollectionType
  'batch-translate-log': BatchTranslateLogService
  chunks: ChunksService
  format: FormatService
  provider: ProviderService
  settings: SettingsService
  translate: TranslateService
  untranslated: UntranslatedService
}

export type TranslatePluginService<ServiceName extends keyof ServiceMap> =
  ServiceMap[ServiceName]
