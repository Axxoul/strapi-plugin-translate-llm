import { useState, useEffect, useMemo } from 'react'
import { getTranslation } from '../utils/getTranslation'
import useAlert from './useAlert'
import { isFetchError } from '@strapi/strapi/admin'
import { useContentTypesTranslationReportQuery } from '../services/report'
import { ContentTypeTranslationReport } from '@shared/types/report'

function hasRunningJob(col: ContentTypeTranslationReport): boolean {
  return !!Object.keys(col.localeReports).find((locale) =>
    ['created', 'setup', 'running'].includes(
      col.localeReports[locale].job?.status
    )
  )
}

export function useCollection() {
  const [realTimeReports, setRealTimeReports] = useState(false)

  const { handleNotification } = useAlert()

  const unkownError = () =>
    handleNotification({
      type: 'danger',
      id: getTranslation('errors.unknown-error'),
      defaultMessage: 'Unknown error occured',
    })

  const {
    data: report,
    refetch: refetchReport,
    error: reportError,
  } = useContentTypesTranslationReportQuery(
    {},
    { pollingInterval: realTimeReports ? 1000 : 0 }
  )

  useEffect(() => {
    if (reportError) {
      if (isFetchError(reportError)) {
        handleNotification({
          type: 'warning',
          id: reportError.message,
          defaultMessage: 'Failed to fetch Collections',
        })
      } else unkownError()
    }
  }, [reportError])

  // If a job in the report is in progress, set realTimeReports to true
  useEffect(() => {
    if (report) {
      const allContentTypes =
        report.data?.tiers?.flatMap((t) => t.contentTypes) || []
      const isTranslating = allContentTypes.find(hasRunningJob)

      if (!isTranslating) setRealTimeReports(false)
      else setRealTimeReports(true)
    }
  }, [report])

  // Start refreshing the collections when a collection is being indexed
  useEffect(() => {
    let interval: NodeJS.Timer | undefined

    if (realTimeReports) {
      interval = setInterval(() => {
        refetchReport()
      }, 1000)
    }

    return () => clearInterval(interval)
  }, [realTimeReports])

  // Flat list for backward compat (modal logic etc.)
  const collections = useMemo(() => {
    if (!report?.data) return []
    return report.data.tiers?.flatMap((t) => t.contentTypes) || []
  }, [report])

  return {
    collections,
    tiers: report?.data?.tiers || [],
    locales: report?.data?.locales || [],
    refetchCollection: refetchReport,
    handleNotification,
    setRealTimeReports,
  }
}

export default useCollection
