/**
 * `jsonb` is the format of Strapi's Blocks fields. It was missing here while
 * being present in the provider contract (`shared/types/provider.ts`) and in the
 * config validator's allow list — an inconsistency the previously untyped config
 * default hid.
 */
export type FieldFormat = 'plain' | 'markdown' | 'html' | 'jsonb'
