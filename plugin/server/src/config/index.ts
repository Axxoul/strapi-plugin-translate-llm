import { FieldFormat } from '../../../shared/types/formats'
import { TranslateProviderOptions } from '../../../shared/types/provider'

export type TranslatedFieldType =
  | string
  | { type: string; format?: FieldFormat }

export type TranslateConfig = {
  provider: string
  providerOptions: TranslateProviderOptions
  translatedFieldTypes: Array<TranslatedFieldType>
  translateRelations: boolean
  /**
   * After writing an entry in a target locale, re-link everything that
   * referenced it in the source locale. Repairs relations that the forward
   * mapping had to drop because the localization did not exist yet.
   */
  relinkIncomingRelations: boolean
  ignoreUpdatedContentTypes: string[]
  regenerateUids: boolean
}

export default {
  default() {
    return {
      provider: 'dummy',
      providerOptions: {},
      translatedFieldTypes: [
        { type: 'string', format: 'plain' },
        { type: 'text', format: 'plain' },
        { type: 'blocks', format: 'jsonb' },
        { type: 'richtext', format: 'markdown' },
        'component',
        'dynamiczone',
      ],
      translateRelations: true,
      relinkIncomingRelations: true,
      ignoreUpdatedContentTypes: [],
      regenerateUids: false,
    }
  },
  validator({
    provider,
    providerOptions,
    translatedFieldTypes,
    translateRelations,
    relinkIncomingRelations,
    ignoreUpdatedContentTypes,
  }: Partial<TranslateConfig>) {
    if (provider === 'dummy' && process.env.NODE_ENV !== 'test') {
      console.warn(
        'provider is set to dummy by default. This only copies all values'
      )
    }
    if (!Array.isArray(translatedFieldTypes)) {
      throw new Error('translatedFieldTypes has to be an array')
    }
    if (!Array.isArray(ignoreUpdatedContentTypes)) {
      throw new Error('ignoreUpdatedContentTypes has to be an array')
    }
    for (const field of translatedFieldTypes) {
      if (typeof field === 'string') {
        continue
      } else if (typeof field === 'object') {
        if (
          typeof field.type !== 'string' ||
          !['undefined', 'string'].includes(typeof field.format)
        ) {
          throw new Error('incorrect schema for translated fields')
        }
        if (
          field.format &&
          !['plain', 'markdown', 'html', 'jsonb'].includes(field.format)
        ) {
          throw new Error(
            `unhandled format ${field.format} for translated field ${field.type}`
          )
        }
      }
    }
    if (typeof translateRelations !== 'boolean') {
      throw new Error('translateRelations has to be a boolean')
    }
    if (
      relinkIncomingRelations !== undefined &&
      typeof relinkIncomingRelations !== 'boolean'
    ) {
      throw new Error('relinkIncomingRelations has to be a boolean')
    }
    if (providerOptions && typeof providerOptions !== 'object') {
      throw new Error('providerOptions has to be an object if it is defined')
    }
  },
}
