import {
  AutoTranslateLogEntry,
  AutoTranslateLogStatus,
  AutoTranslateSettings,
} from '../contracts/auto-translate'

export interface AutoTranslateService {
  isGuarded(contentType: string, documentId: string, locale: string): boolean
  triggerAutoTranslate(
    contentType: string,
    documentId: string,
    locale: string,
    isPublished: boolean
  ): Promise<void>
  getLogs(filters?: {
    status?: AutoTranslateLogStatus
    limit?: number
  }): Promise<AutoTranslateLogEntry[]>
  clearLogs(): Promise<number>
  getSettings(): Promise<AutoTranslateSettings>
  updateSettings(input: AutoTranslateSettings): Promise<AutoTranslateSettings>
}
