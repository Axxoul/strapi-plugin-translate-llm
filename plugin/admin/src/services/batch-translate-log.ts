import { BatchTranslateLogs } from '@shared/contracts/batch-translate-log'
import { translateApi } from './api'

const batchTranslateLogApi = translateApi.injectEndpoints({
  endpoints: (build) => ({
    getBatchTranslateLogs: build.query<
      BatchTranslateLogs.List.Response,
      { batchJobId?: string; limit?: number } | void
    >({
      providesTags: ['BatchTranslateLogs'],
      query: (params) => ({
        url: '/translate/batch-translate/logs',
        method: 'GET',
        config: { params: params || {} },
      }),
    }),
    clearBatchTranslateLogs: build.mutation<
      BatchTranslateLogs.Clear.Response,
      { batchJobId?: string } | void
    >({
      invalidatesTags: ['BatchTranslateLogs'],
      query: (params) => ({
        url: '/translate/batch-translate/logs',
        method: 'DELETE',
        config: { params: params || {} },
      }),
    }),
  }),
  overrideExisting: false,
})

export const {
  useGetBatchTranslateLogsQuery,
  useClearBatchTranslateLogsMutation,
} = batchTranslateLogApi
