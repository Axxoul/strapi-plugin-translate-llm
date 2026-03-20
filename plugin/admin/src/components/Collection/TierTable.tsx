import React, { memo } from 'react'
import { Table, Tbody } from '@strapi/design-system'
import CollectionTableHeader from './CollectionHeader'
import CollectionRow from './CollectionRow'
import { ContentTypeTranslationReport } from '@shared/types/report'
import { Locale } from '@shared/types/locale'
import { ActionType } from './actions'

interface TierTableProps {
  contentTypes: ContentTypeTranslationReport[]
  locales: Array<Pick<Locale, 'code' | 'name'>>
  updates: Array<{ contentType?: string; documentId: string }>
  onAction: (params: {
    action: ActionType
    targetLocale?: string
    collection: ContentTypeTranslationReport
  }) => void
}

const TierTable = ({
  contentTypes,
  locales,
  updates,
  onAction,
}: TierTableProps) => {
  const COL_COUNT = locales.length + 1

  return (
    <Table colCount={COL_COUNT} rowCount={contentTypes.length}>
      <CollectionTableHeader locales={locales} />
      <Tbody>
        {contentTypes.map((collection, index) => (
          <CollectionRow
            key={collection.contentType}
            entry={collection}
            updateCount={
              updates.filter(
                (update) => update?.contentType === collection.contentType
              ).length
            }
            locales={locales}
            onAction={(action, targetLocale) =>
              onAction({ action, targetLocale, collection })
            }
            index={index}
          />
        ))}
      </Tbody>
    </Table>
  )
}

export default memo(TierTable)
