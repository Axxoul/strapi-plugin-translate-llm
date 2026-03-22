import React from 'react'
import {
  Box,
  Flex,
  Typography,
  Button,
  Loader,
  Badge,
} from '@strapi/design-system'
import { Cross, Check, WarningCircle } from '@strapi/icons'
import { Link } from 'react-router-dom'
import { useIntl } from 'react-intl'
import {
  useGetAutoTranslateLogsQuery,
  useClearAutoTranslateLogsMutation,
} from '../../services/auto-translate'
import { getTranslation } from '../../utils/getTranslation'
import { AutoTranslateLogEntry } from '@shared/contracts/auto-translate'

function StatusIcon({ status }: { status: AutoTranslateLogEntry['status'] }) {
  switch (status) {
    case 'pending':
    case 'translating':
      return <Loader small />
    case 'success':
      return <Check fill="success600" />
    case 'failed':
      return <WarningCircle fill="danger600" />
    default:
      return null
  }
}

function statusColor(
  status: AutoTranslateLogEntry['status']
): string {
  switch (status) {
    case 'success':
      return 'success100'
    case 'failed':
      return 'danger100'
    default:
      return 'neutral100'
  }
}

/**
 * Build a link to the content manager entry for a given content type + documentId + locale.
 * Strapi v5 content manager URL pattern:
 *   /admin/content-manager/collection-types/:contentType/:documentId?plugins[i18n][locale]=:locale
 */
function buildEntityLink(
  contentType: string,
  entryDocumentId: string,
  targetLocale: string
): string {
  return `/content-manager/collection-types/${contentType}/${entryDocumentId}?plugins[i18n][locale]=${targetLocale}`
}

/**
 * Extract a short, human-readable content type name from the full UID.
 * e.g. "api::article.article" -> "Article"
 */
function shortContentType(uid: string): string {
  const parts = uid.split('.')
  const last = parts[parts.length - 1] || uid
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ')
}

const StatusPanel = () => {
  const { formatMessage } = useIntl()
  const { data: response, isLoading } = useGetAutoTranslateLogsQuery(
    { limit: 20 },
    { pollingInterval: 5000 }
  )
  const [clearLogs] = useClearAutoTranslateLogsMutation()

  const logs: AutoTranslateLogEntry[] =
    (response as any)?.data ?? []

  const hasPending = logs.some(
    (l) => l.status === 'pending' || l.status === 'translating'
  )
  const hasFailed = logs.some((l) => l.status === 'failed')

  if (isLoading) return null
  if (logs.length === 0) {
    return (
      <Box
        background="neutral0"
        padding={4}
        shadow="filterShadow"
        hasRadius
        height="100%"
      >
        <Flex direction="column" alignItems="stretch" height="100%">
          <Typography variant="sigma" textColor="neutral600">
            {formatMessage({
              id: getTranslation('auto-translate.logs.title'),
              defaultMessage: 'RECENT AUTO-TRANSLATIONS',
            })}
          </Typography>
          <Flex flex="1" alignItems="center" justifyContent="center" paddingTop={4}>
            <Typography variant="omega" textColor="neutral600">
              {formatMessage({
                id: getTranslation('auto-translate.logs.empty'),
                defaultMessage: 'No recent auto-translations',
              })}
            </Typography>
          </Flex>
        </Flex>
      </Box>
    )
  }

  return (
    <Box
      background="neutral0"
      padding={4}
      shadow="filterShadow"
      hasRadius
      height="100%"
    >
      <Flex justifyContent="space-between" alignItems="center" paddingBottom={3}>
        <Flex gap={2} alignItems="center">
          <Typography variant="sigma" textColor="neutral600">
            {formatMessage({
              id: getTranslation('auto-translate.logs.title'),
              defaultMessage: 'RECENT AUTO-TRANSLATIONS',
            })}
          </Typography>
          {hasPending && (
            <Badge active>
              {formatMessage({
                id: getTranslation('auto-translate.status.in-progress'),
                defaultMessage: 'In progress',
              })}
            </Badge>
          )}
          {hasFailed && (
            <Badge backgroundColor="danger100" textColor="danger700">
              {formatMessage({
                id: getTranslation('auto-translate.status.has-errors'),
                defaultMessage: 'Has errors',
              })}
            </Badge>
          )}
        </Flex>
        <Button variant="ghost" size="S" onClick={() => clearLogs()}>
          {formatMessage({
            id: getTranslation('auto-translate.logs.clear'),
            defaultMessage: 'Clear',
          })}
        </Button>
      </Flex>
      <Flex direction="column" gap={2}>
        {logs.map((log) => (
          <Box
            key={log.id}
            background={statusColor(log.status)}
            padding={2}
            hasRadius
          >
            <Flex justifyContent="space-between" alignItems="center">
              <Flex gap={2} alignItems="center">
                <StatusIcon status={log.status} />
                <Link
                  to={buildEntityLink(log.contentType, log.entryDocumentId, log.targetLocale)}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <Typography variant="omega" fontWeight="semiBold" textColor="primary600">
                    {log.displayName || shortContentType(log.contentType)}
                  </Typography>
                </Link>
              </Flex>
              <Badge
                backgroundColor={statusColor(log.status)}
                textColor={
                  log.status === 'success'
                    ? 'success700'
                    : log.status === 'failed'
                      ? 'danger700'
                      : 'neutral700'
                }
              >
                {log.status}
              </Badge>
            </Flex>
            <Box paddingTop={1} paddingLeft={6}>
              <Typography variant="pi" textColor="neutral500">
                {log.sourceLocale} &rarr; {log.targetLocale}
              </Typography>
              <Typography variant="pi" textColor="neutral400">
                {' '}&middot;{' '}{shortContentType(log.contentType)}
              </Typography>
            </Box>
            {log.status === 'failed' && log.error && (
              <Box paddingTop={1} paddingLeft={6}>
                <Typography variant="pi" textColor="danger600">
                  {log.error}
                </Typography>
              </Box>
            )}
          </Box>
        ))}
      </Flex>
    </Box>
  )
}

export default StatusPanel
export { StatusPanel }
