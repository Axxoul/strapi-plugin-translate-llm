import { FieldFormat } from '../../../shared/types/formats'
import { TranslateProviderOptions } from '../../../shared/types/provider'
import {
  AUTO_PUBLISH_MODES,
  AutoPublishMode,
  BATCH_AUTO_PUBLISH_MODES,
  BatchAutoPublishMode,
  CASCADE_MODES,
  CascadeMode,
  ON_SOURCE_UNPUBLISH_VALUES,
  OnSourceUnpublish,
  TRANSLATE_ON_VALUES,
  TranslateOn,
} from '../../../shared/types/auto-translate-options'

export type TranslatedFieldType =
  | string
  | { type: string; format?: FieldFormat }

export type {
  AutoPublishMode,
  BatchAutoPublishMode,
  CascadeMode,
  OnSourceUnpublish,
  TranslateOn,
}

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

  // ---------------------------------------------------------------------------
  // Auto-translate trigger + cascade.
  //
  // Every default below reproduces the behaviour of releases before the cascade
  // existed, so upgrading without touching config is a no-op (Rule 0).
  // These are *file-config defaults*; the DB store (Settings page) overrides them
  // per environment — see `services/settings.ts` → `getMergedAutoTranslateSettings`.
  // ---------------------------------------------------------------------------

  /**
   * Which editor action starts an automatic translation.
   * - `save`    — every create/update in the master locale (the historical behaviour)
   * - `publish` — only when the entry is published. Content types without
   *               draft-and-publish have no publish event and keep firing on save.
   */
  translateOn: TranslateOn

  /**
   * Whether to translate the related documents a trigger entry depends on before
   * translating the entry itself.
   * - `off`          — no cascade (historical behaviour)
   * - `missing-only` — cascade only into related documents that have **no**
   *                    target-locale localization yet. Existing translations are
   *                    never re-translated or overwritten.
   */
  cascade: CascadeMode

  /** Publish policy for the *trigger* entry of an automatic translation. */
  autoPublish: AutoPublishMode

  /**
   * Publish policy for `batchUpdate` (the "re-translate updated entries" path).
   * `draft` reproduces the hardcoded `publish: false` this replaced.
   */
  updatedEntryAutoPublish: BatchAutoPublishMode

  /**
   * What to do with target-locale entries when the source entry is unpublished.
   * Never cascaded — it applies to the trigger document only.
   */
  onSourceUnpublish: OnSourceUnpublish

  /**
   * Hard ceiling on entries queued by one trigger, counted **in total across all
   * target locales** — not per locale. Bounds spend on a metered provider.
   */
  cascadeMaxEntries: number

  /** How many relation hops the cascade walk may follow from the trigger entry. */
  cascadeMaxDepth: number

  /** Target locales the cascade may write. `null` means every locale. */
  cascadeLocales: string[] | null

  /** Content types the cascade never walks into. */
  cascadeIgnoreContentTypes: string[]
}

export default {
  default(): TranslateConfig {
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

      translateOn: 'save',
      cascade: 'off',
      autoPublish: 'trigger',
      updatedEntryAutoPublish: 'draft',
      onSourceUnpublish: 'ignore',
      cascadeMaxEntries: 50,
      cascadeMaxDepth: 5,
      cascadeLocales: null,
      cascadeIgnoreContentTypes: [],
    }
  },
  validator({
    provider,
    providerOptions,
    translatedFieldTypes,
    translateRelations,
    relinkIncomingRelations,
    ignoreUpdatedContentTypes,
    translateOn,
    cascade,
    autoPublish,
    updatedEntryAutoPublish,
    onSourceUnpublish,
    cascadeMaxEntries,
    cascadeMaxDepth,
    cascadeLocales,
    cascadeIgnoreContentTypes,
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

    assertEnum('translateOn', translateOn, TRANSLATE_ON_VALUES)
    assertEnum('cascade', cascade, CASCADE_MODES)
    assertEnum('autoPublish', autoPublish, AUTO_PUBLISH_MODES)
    assertEnum(
      'updatedEntryAutoPublish',
      updatedEntryAutoPublish,
      BATCH_AUTO_PUBLISH_MODES
    )
    assertEnum(
      'onSourceUnpublish',
      onSourceUnpublish,
      ON_SOURCE_UNPUBLISH_VALUES
    )
    assertPositiveInt('cascadeMaxEntries', cascadeMaxEntries)
    assertPositiveInt('cascadeMaxDepth', cascadeMaxDepth)

    if (
      cascadeLocales !== undefined &&
      cascadeLocales !== null &&
      (!Array.isArray(cascadeLocales) ||
        cascadeLocales.some((l) => typeof l !== 'string'))
    ) {
      throw new Error('cascadeLocales has to be an array of strings or null')
    }
    if (
      cascadeIgnoreContentTypes !== undefined &&
      (!Array.isArray(cascadeIgnoreContentTypes) ||
        cascadeIgnoreContentTypes.some((l) => typeof l !== 'string'))
    ) {
      throw new Error('cascadeIgnoreContentTypes has to be an array of strings')
    }
  },
}

function assertEnum<T extends string>(
  name: string,
  value: T | undefined,
  allowed: readonly T[]
) {
  if (value !== undefined && !allowed.includes(value)) {
    throw new Error(`${name} has to be one of ${allowed.join(', ')}`)
  }
}

function assertPositiveInt(name: string, value: number | undefined) {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} has to be a positive integer`)
  }
}
