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
      >
        <Typography variant="omega" textColor="neutral600">
          {formatMessage({
            id: getTranslation('auto-translate.logs.empty'),
            defaultMessage: 'No recent auto-translations',
          })}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      background="neutral0"
      padding={4}
      shadow="filterShadow"
      hasRadius
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
                <Typography variant="omega">
                  {log.displayName || log.contentType}
                </Typography>
                <Typography variant="pi" textColor="neutral500">
                  {log.sourceLocale} &rarr; {log.targetLocale}
                </Typography>
              </Flex>
              <Typography variant="pi" textColor="neutral500">
                {log.status}
              </Typography>
            </Flex>
            {log.status === 'failed' && log.error && (
              <Box paddingTop={1}>
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
