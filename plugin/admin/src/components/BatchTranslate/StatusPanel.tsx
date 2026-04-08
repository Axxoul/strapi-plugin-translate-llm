import React from 'react'
import {
  Box,
  Flex,
  Typography,
  Button,
  Badge,
} from '@strapi/design-system'
import { WarningCircle } from '@strapi/icons'
import { Link } from 'react-router-dom'
import { useIntl } from 'react-intl'
import {
  useGetBatchTranslateLogsQuery,
  useClearBatchTranslateLogsMutation,
} from '../../services/batch-translate-log'
import { getTranslation } from '../../utils/getTranslation'
import { BatchTranslateLogEntry } from '@shared/contracts/batch-translate-log'

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

const BatchTranslateStatusPanel = () => {
  const { formatMessage } = useIntl()
  const { data: response, isLoading } = useGetBatchTranslateLogsQuery(
    { limit: 20 },
    { pollingInterval: 5000 }
  )
  const [clearLogs] = useClearBatchTranslateLogsMutation()

  const logs: BatchTranslateLogEntry[] = (response as any)?.data ?? []

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
              id: getTranslation('batch-translate.logs.title'),
              defaultMessage: 'RECENT BATCH-TRANSLATIONS',
            })}
          </Typography>
          <Flex
            flex="1"
            alignItems="center"
            justifyContent="center"
            paddingTop={4}
          >
            <Typography variant="omega" textColor="neutral600">
              {formatMessage({
                id: getTranslation('batch-translate.logs.empty'),
                defaultMessage: 'No batch translation errors.',
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
      <Flex
        justifyContent="space-between"
        alignItems="center"
        paddingBottom={3}
      >
        <Flex gap={2} alignItems="center">
          <Typography variant="sigma" textColor="neutral600">
            {formatMessage({
              id: getTranslation('batch-translate.logs.title'),
              defaultMessage: 'RECENT BATCH-TRANSLATIONS',
            })}
          </Typography>
          <Badge backgroundColor="danger100" textColor="danger700">
            {logs.length}
          </Badge>
        </Flex>
        <Button variant="ghost" size="S" onClick={() => clearLogs()}>
          {formatMessage({
            id: getTranslation('batch-translate.logs.clear'),
            defaultMessage: 'Clear',
          })}
        </Button>
      </Flex>
      <Flex direction="column" gap={2}>
        {logs.map((log) => (
          <Box
            key={log.id}
            background="danger100"
            padding={2}
            hasRadius
          >
            <Flex gap={2} alignItems="center">
              <WarningCircle fill="danger600" />
              <Link
                to={buildEntityLink(
                  log.contentType,
                  log.entryDocumentId,
                  log.targetLocale
                )}
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <Typography
                  variant="omega"
                  fontWeight="semiBold"
                  textColor="primary600"
                >
                  {log.displayName || shortContentType(log.contentType)}
                </Typography>
              </Link>
            </Flex>
            <Box paddingTop={1} paddingLeft={6}>
              <Typography variant="pi" textColor="neutral500">
                {log.sourceLocale} &rarr; {log.targetLocale}
              </Typography>
              <Typography variant="pi" textColor="neutral400">
                {' '}
                &middot; {shortContentType(log.contentType)}
              </Typography>
            </Box>
            {log.error && (
              <Box paddingTop={1} paddingLeft={6}>
                <Typography
                  variant="pi"
                  textColor="danger600"
                  title={log.error}
                  ellipsis
                >
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

export default BatchTranslateStatusPanel
export { BatchTranslateStatusPanel }
