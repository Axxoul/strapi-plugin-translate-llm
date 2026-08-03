import { describe, expect, it, afterEach } from '@jest/globals'
import { TranslateConfig, TranslatedFieldType } from '..'

import setup from '../../__mocks__/initSetup'

afterEach(() => {
  Object.defineProperty(global, 'strapi', {})
})

describe('config', () => {
  it('default provider is dummy', async () => {
    await setup({})

    expect(
      strapi.config.get<TranslateConfig>('plugin::translate').provider
    ).toEqual('dummy')
  })

  it('setting translate relations to false', async () => {
    await setup({ config: { translateRelations: false } })

    expect(
      strapi.config.get<TranslateConfig>('plugin::translate').translateRelations
    ).toEqual(false)
  })

  it('changing translated field types', async () => {
    const translatedFieldTypes: Array<TranslatedFieldType> = [
      'string',
      { type: 'text', format: 'plain' },
      { type: 'richtext', format: 'markdown' },
      { type: 'ckeditor', format: 'html' },
    ]
    await setup({ config: { translatedFieldTypes } })

    expect(
      strapi.config.get<TranslateConfig>('plugin::translate')
        .translatedFieldTypes
    ).toEqual(translatedFieldTypes)
  })

  it('fails with translated field types not array', () => {
    const translatedFieldTypes = 'string' as any

    expect(() => setup({ config: { translatedFieldTypes } })).rejects.toThrow(
      'translatedFieldTypes has to be an array'
    )
  })

  it('fails with translateRelations not a boolean', () => {
    const translateRelations = 'false' as any

    expect(() => setup({ config: { translateRelations } })).rejects.toThrow(
      'translateRelations has to be a boolean'
    )
  })

  it('fails with providerOptions not object or undefined', () => {
    const providerOptions = 'Test' as any

    expect(() => setup({ config: { providerOptions } })).rejects.toThrow(
      'providerOptions has to be an object if it is defined'
    )
  })

  it('fails with translated fields not being in correct schema', () => {
    const translatedFieldTypes = [{ field: 'richtext' }] as any

    expect(() => setup({ config: { translatedFieldTypes } })).rejects.toThrow(
      'incorrect schema for translated fields'
    )
  })

  it('fails with translated fields of unhandled field type', () => {
    const translatedFieldTypes = [{ type: 'richtext', format: 'xml' }] as any

    expect(() => setup({ config: { translatedFieldTypes } })).rejects.toThrow(
      'unhandled format xml for translated field richtext'
    )
  })

  describe('auto-translate trigger and cascade', () => {
    // Rule 0: an app that upgrades without touching config must behave exactly
    // as it did before these options existed. Asserted on the config surface
    // itself; the write parameters they produce are asserted in the
    // auto-translate service tests.
    it('defaults reproduce the pre-cascade behaviour', async () => {
      await setup({})

      const config = strapi.config.get<TranslateConfig>('plugin::translate')

      expect(config.translateOn).toEqual('save')
      expect(config.cascade).toEqual('off')
      expect(config.autoPublish).toEqual('trigger')
      expect(config.updatedEntryAutoPublish).toEqual('draft')
      expect(config.onSourceUnpublish).toEqual('ignore')
      expect(config.cascadeLocales).toBeNull()
      expect(config.cascadeIgnoreContentTypes).toEqual([])
    })

    it('accepts the recommended production combination', async () => {
      await setup({
        config: {
          translateOn: 'publish',
          cascade: 'missing-only',
          autoPublish: 'mirror',
        },
      })

      expect(
        strapi.config.get<TranslateConfig>('plugin::translate').cascade
      ).toEqual('missing-only')
    })

    it.each([
      ['translateOn', 'sometimes', 'translateOn has to be one of save, publish'],
      ['cascade', 'all', 'cascade has to be one of off, missing-only'],
      [
        'autoPublish',
        'maybe',
        'autoPublish has to be one of draft, publish, mirror, trigger',
      ],
      [
        'updatedEntryAutoPublish',
        'trigger',
        'updatedEntryAutoPublish has to be one of draft, publish, mirror',
      ],
      [
        'onSourceUnpublish',
        'delete',
        'onSourceUnpublish has to be one of ignore, unpublish',
      ],
    ])('rejects an unknown %s', (key, value, message) => {
      expect(() =>
        setup({ config: { [key]: value } as any })
      ).rejects.toThrow(message)
    })

    it('rejects trigger on the batch update path', () => {
      // `trigger` has no meaning without a triggering action.
      expect(() =>
        setup({ config: { updatedEntryAutoPublish: 'trigger' } as any })
      ).rejects.toThrow('updatedEntryAutoPublish has to be one of')
    })

    it.each([
      ['cascadeMaxEntries', 0],
      ['cascadeMaxEntries', 2.5],
      ['cascadeMaxDepth', -1],
      ['cascadeMaxDepth', 'five'],
    ])('rejects an invalid %s (%s)', (key, value) => {
      expect(() =>
        setup({ config: { [key]: value } as any })
      ).rejects.toThrow(`${key} has to be a positive integer`)
    })

    it('accepts null for cascadeLocales, meaning every locale', async () => {
      await setup({ config: { cascadeLocales: null } })

      expect(
        strapi.config.get<TranslateConfig>('plugin::translate').cascadeLocales
      ).toBeNull()
    })

    it('rejects a non-string entry in cascadeLocales', () => {
      expect(() =>
        setup({ config: { cascadeLocales: ['en', 5] } as any })
      ).rejects.toThrow('cascadeLocales has to be an array of strings or null')
    })

    it('rejects a non-array cascadeIgnoreContentTypes', () => {
      expect(() =>
        setup({ config: { cascadeIgnoreContentTypes: 'api::a.a' } as any })
      ).rejects.toThrow('cascadeIgnoreContentTypes has to be an array of strings')
    })
  })
})
