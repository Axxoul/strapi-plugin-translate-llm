import { adminApi } from '@strapi/strapi/admin'

const translateApi = adminApi.enhanceEndpoints({
  addTagTypes: [
    'TranslateReport',
    'TranslateUsageEstimate',
    'TranslateProviderUsage',
    'TranslateBatchJobStatus',
    'TranslateBatchUpdates',
    'TranslateSettings',
    'Locale',
  ],
})

export { translateApi }
