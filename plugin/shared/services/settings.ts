import { ProviderSettingsData } from '../contracts/settings'

export interface SettingsService {
  getSettings(): Promise<ProviderSettingsData>
  updateSettings(
    input: Omit<ProviderSettingsData, 'provider'>
  ): Promise<{ data: ProviderSettingsData; warning?: string }>
  getMergedProviderOptions(): Promise<Record<string, any>>
}
