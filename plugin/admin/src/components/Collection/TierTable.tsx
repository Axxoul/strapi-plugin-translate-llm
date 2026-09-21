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
  onAction: (params: {
    action: ActionType
    targetLocale?: string
    collection: ContentTypeTranslationReport
  }) => void
}

const TierTable = ({ contentTypes, locales, onAction }: TierTableProps) => {
  const COL_COUNT = locales.length + 1

  return (
    <Table colCount={COL_COUNT} rowCount={contentTypes.length}>
      <CollectionTableHeader locales={locales} />
      <Tbody>
        {contentTypes.map((collection, index) => (
          <CollectionRow
            key={collection.contentType}
            entry={collection}
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
