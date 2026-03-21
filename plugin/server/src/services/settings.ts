import { Core } from '@strapi/strapi'
import { TranslateConfig } from '../config'
import { ProviderSettingsData } from '../../../shared/contracts/settings'
import { createProvider } from '../utils/create-provider'

const STORE_KEY = 'provider_settings'
const API_KEY_MASK = '****'

interface StoredSettings {
  apiKey?: string
  apiUrl?: string
  model?: string
  temperature?: number
  customPrompt?: string
  localeMap?: Record<string, string>
}

function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  if (key.length <= 4) return API_KEY_MASK
  return API_KEY_MASK + key.slice(-4)
}

function isApiKeyMasked(value: string | undefined): boolean {
  return !!value && value.startsWith(API_KEY_MASK)
}

function getStore() {
  return strapi.store({ type: 'plugin', name: 'translate', key: STORE_KEY })
}

function getFileConfig(): TranslateConfig {
  return strapi.config.get<TranslateConfig>('plugin::translate')
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async getSettings(): Promise<ProviderSettingsData> {
    const fileConfig = getFileConfig()
    const opts = (fileConfig.providerOptions || {}) as Record<string, any>
    const stored = ((await getStore().get()) as StoredSettings) || {}

    return {
      provider: fileConfig.provider || 'dummy',
      apiKey: maskApiKey(stored.apiKey || opts.apiKey),
      apiUrl: stored.apiUrl || opts.apiUrl || '',
      model: stored.model || opts.model || '',
      temperature: stored.temperature ?? opts.temperature,
      customPrompt: stored.customPrompt || opts.customPrompt || '',
      localeMap: stored.localeMap || opts.localeMap || {},
      defaults: {
        apiKey: !!opts.apiKey,
        apiUrl: opts.apiUrl || '',
        model: opts.model || '',
        temperature: opts.temperature,
        customPrompt: opts.customPrompt || '',
        localeMap: opts.localeMap || {},
      },
    }
  },

  async updateSettings(
    input: Omit<ProviderSettingsData, 'provider'>
  ): Promise<{ data: ProviderSettingsData; warning?: string }> {
    const current = ((await getStore().get()) as StoredSettings) || {}

    const updated: StoredSettings = {
      apiKey: isApiKeyMasked(input.apiKey) ? current.apiKey : input.apiKey,
      apiUrl: input.apiUrl,
      model: input.model,
      temperature: input.temperature,
      customPrompt: input.customPrompt,
      localeMap: input.localeMap,
    }

    await getStore().set({ value: updated })

    // Try to reload the provider with new settings
    let warning: string | undefined
    try {
      const merged = await this.getMergedProviderOptions()
      const fileConfig = getFileConfig()
      const newProvider = await createProvider(fileConfig.provider, merged)
      strapi.plugin('translate').provider = newProvider
    } catch (err) {
      warning = `Settings saved but provider failed to reload: ${err instanceof Error ? err.message : String(err)}`
      strapi.log.warn(warning)
    }

    const data = await this.getSettings()
    return { data, warning }
  },

  async getMergedProviderOptions(): Promise<Record<string, any>> {
    const fileConfig = getFileConfig()
    const fileOptions = (fileConfig.providerOptions as Record<string, any>) || {}
    const stored = ((await getStore().get()) as StoredSettings) || {}

    const merged = { ...fileOptions }
    for (const [key, value] of Object.entries(stored)) {
      if (value !== undefined && value !== null && value !== '') {
        merged[key] = value
      }
    }

    return merged
  },
})
