/**
 * Option vocabularies shared by the server config, the HTTP contracts and the
 * admin Settings page. Kept in `shared/` so there is exactly one definition of
 * each set of allowed values.
 */

/**
 * When a translated entry should be published.
 *
 * - `draft`   — never publish, leave the translation as a draft
 * - `publish` — always publish
 * - `mirror`  — publish iff the *source* document has a published version
 * - `trigger` — publish iff the action that triggered the translation published.
 *               Auto-translate only; meaningless (and rejected) on the batch path.
 */
export type AutoPublishMode = 'draft' | 'publish' | 'mirror' | 'trigger'

/** `autoPublish` values a batch job may use — `trigger` has no triggering action. */
export type BatchAutoPublishMode = Exclude<AutoPublishMode, 'trigger'>

/** Which editor action starts an automatic translation. */
export type TranslateOn = 'save' | 'publish'

/** Whether dependencies are translated before the entry that references them. */
export type CascadeMode = 'off' | 'missing-only'

/** What happens to target-locale entries when the source entry is unpublished. */
export type OnSourceUnpublish = 'ignore' | 'unpublish'

export const AUTO_PUBLISH_MODES: readonly AutoPublishMode[] = [
  'draft',
  'publish',
  'mirror',
  'trigger',
] as const

export const BATCH_AUTO_PUBLISH_MODES: readonly BatchAutoPublishMode[] = [
  'draft',
  'publish',
  'mirror',
] as const

export const TRANSLATE_ON_VALUES: readonly TranslateOn[] = [
  'save',
  'publish',
] as const

export const CASCADE_MODES: readonly CascadeMode[] = [
  'off',
  'missing-only',
] as const

export const ON_SOURCE_UNPUBLISH_VALUES: readonly OnSourceUnpublish[] = [
  'ignore',
  'unpublish',
] as const
