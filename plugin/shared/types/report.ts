import { UID } from '@strapi/strapi'
import { Locale } from './locale'
import { BatchTranslateJob } from './batch-translate-job'

export interface SingleLocaleTranslationReport {
  /**
   * Count of entries for this locale
   */
  count: number
  /**
   * True if all entries are translated
   */
  complete: boolean
  job: BatchTranslateJob
}

export interface ContentTypeTranslationReport {
  /**
   * The content type UID
   */
  contentType: UID.ContentType
  /**
   * The display name of the content type
   */
  collection: string
  localeReports: Record<string, SingleLocaleTranslationReport>
  /**
   * Dependency tier: 0 = no deps, 1+ = depends on lower tiers
   */
  tier: number
  /**
   * True if this content type is part of a circular dependency
   */
  circular: boolean
}

export interface TierGroup {
  tier: number
  circular: boolean
  description: string
  contentTypes: ContentTypeTranslationReport[]
}

export interface TieredReportData {
  tiers: TierGroup[]
  locales: Locale[]
}

/** @deprecated Use TieredReportData instead */
export interface ReportData {
  contentTypes: ContentTypeTranslationReport[]
  locales: Locale[]
}
