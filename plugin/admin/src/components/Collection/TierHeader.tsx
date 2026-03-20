import React, { memo } from 'react'
import { Box, Flex, Typography } from '@strapi/design-system'
import { WarningCircle } from '@strapi/icons'
import { useIntl } from 'react-intl'
import { getTranslation } from '../../utils'

interface TierHeaderProps {
  tier: number
  circular: boolean
  description: string
}

const TierHeader = ({ tier, circular, description }: TierHeaderProps) => {
  const { formatMessage } = useIntl()

  const label = formatMessage(
    {
      id: getTranslation('batch-translate.tier.label'),
      defaultMessage: 'Tier {tier}',
    },
    { tier }
  )

  return (
    <Box paddingTop={4} paddingBottom={2}>
      <Flex gap={2} alignItems="center">
        {circular && <WarningCircle fill="warning500" />}
        <Typography variant="delta">{label}</Typography>
      </Flex>
      <Typography variant="pi" textColor="neutral600">
        {description}
      </Typography>
    </Box>
  )
}

export default memo(TierHeader)
