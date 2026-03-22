import {
  AutoTranslateSettings,
  AutoTranslateLogEntry,
  AutoTranslateSettingsEndpoint,
  AutoTranslateLogs,
} from '@shared/contracts/auto-translate'
import { translateApi } from './api'

const autoTranslateApi = translateApi.injectEndpoints({
  endpoints: (build) => ({
    getAutoTranslateSettings: build.query<
      AutoTranslateSettingsEndpoint.Get.Response,
      void
    >({
      providesTags: ['AutoTranslateSettings'],
      query: () => ({
        url: '/translate/auto-translate/settings',
        method: 'GET',
      }),
    }),
    updateAutoTranslateSettings: build.mutation<
      AutoTranslateSettingsEndpoint.Update.Response,
      AutoTranslateSettings
    >({
      invalidatesTags: ['AutoTranslateSettings'],
      query: (data) => ({
        url: '/translate/auto-translate/settings',
        method: 'PUT',
        data,
      }),
    }),
    getAutoTranslateLogs: build.query<
      AutoTranslateLogs.List.Response,
      { status?: string; limit?: number } | void
    >({
      providesTags: ['AutoTranslateLogs'],
      query: (params) => ({
        url: '/translate/auto-translate/logs',
        method: 'GET',
        config: { params: params || {} },
      }),
    }),
    clearAutoTranslateLogs: build.mutation<
      AutoTranslateLogs.Clear.Response,
      void
    >({
      invalidatesTags: ['AutoTranslateLogs'],
      query: () => ({
        url: '/translate/auto-translate/logs',
        method: 'DELETE',
      }),
    }),
  }),
  overrideExisting: false,
})

export const {
  useGetAutoTranslateSettingsQuery,
  useUpdateAutoTranslateSettingsMutation,
  useGetAutoTranslateLogsQuery,
  useClearAutoTranslateLogsMutation,
} = autoTranslateApi
