import { TranslateSettings } from '@shared/contracts/settings'
import { translateApi } from './api'

const settingsApi = translateApi.injectEndpoints({
  endpoints: (build) => ({
    getTranslateSettings: build.query<
      TranslateSettings.Get.Response,
      TranslateSettings.Get.Request['body']
    >({
      providesTags: ['TranslateSettings'],
      query: () => ({ url: '/translate/settings', method: 'GET' }),
    }),
    updateTranslateSettings: build.mutation<
      TranslateSettings.Update.Response,
      TranslateSettings.Update.Request['body']
    >({
      invalidatesTags: ['TranslateSettings', 'TranslateProviderUsage'],
      query: (data) => ({
        url: '/translate/settings',
        method: 'PUT',
        data,
      }),
    }),
  }),
  overrideExisting: false,
})

export const { useGetTranslateSettingsQuery, useUpdateTranslateSettingsMutation } = settingsApi
