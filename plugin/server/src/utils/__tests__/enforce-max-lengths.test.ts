import { describe, expect, it, afterEach, beforeEach } from '@jest/globals'
import { enforceMaxLengths } from '../enforce-max-lengths'
import setup from '../../__mocks__/initSetup'

const seoComponent = {
  attributes: {
    metaTitle: {
      type: 'string',
      maxLength: 60,
    },
    metaDescription: {
      type: 'string',
      maxLength: 160,
    },
    keywords: {
      type: 'text',
    },
  },
}

const innerComponent = {
  attributes: {
    label: {
      type: 'string',
      maxLength: 50,
    },
  },
}

const nestedComponent = {
  attributes: {
    inner: {
      type: 'component',
      component: 'shared.inner',
    },
  },
}

afterEach(() => {
  Object.defineProperty(global, 'strapi', {})
})

describe('enforceMaxLengths', () => {
  beforeEach(async () => {
    await setup({
      components: {
        'shared.seo': seoComponent,
        'shared.inner': innerComponent,
        'shared.nested': nestedComponent,
        simple: {
          attributes: {
            text: { type: 'richtext' },
          },
        },
        'two-field': {
          attributes: {
            title: { type: 'text', maxLength: 100 },
            number: { type: 'number' },
          },
        },
      },
      contentTypes: {},
    })
  })

  it('should truncate top-level string field exceeding maxLength', () => {
    const schema = {
      attributes: {
        title: { type: 'string', maxLength: 10 },
      },
    } as any

    const data = { title: 'This is a very long title' }
    enforceMaxLengths(data, schema)
    expect(data.title).toBe('This is a ')
    expect(data.title.length).toBe(10)
  })

  it('should leave string within maxLength unchanged', () => {
    const schema = {
      attributes: {
        title: { type: 'string', maxLength: 100 },
      },
    } as any

    const data = { title: 'Short title' }
    enforceMaxLengths(data, schema)
    expect(data.title).toBe('Short title')
  })

  it('should leave field without maxLength untouched', () => {
    const schema = {
      attributes: {
        description: { type: 'text' },
      },
    } as any

    const longText = 'x'.repeat(1000)
    const data = { description: longText }
    enforceMaxLengths(data, schema)
    expect(data.description).toBe(longText)
  })

  it('should truncate text field with maxLength', () => {
    const schema = {
      attributes: {
        bio: { type: 'text', maxLength: 5 },
      },
    } as any

    const data = { bio: 'Hello World' }
    enforceMaxLengths(data, schema)
    expect(data.bio).toBe('Hello')
  })

  it('should truncate component fields (seo.metaDescription case)', () => {
    const schema = {
      attributes: {
        seo: {
          type: 'component',
          component: 'shared.seo',
        },
      },
    } as any

    const data = {
      seo: {
        metaTitle: 'x'.repeat(80), // exceeds 60
        metaDescription: 'y'.repeat(200), // exceeds 160
        keywords: 'z'.repeat(500), // no maxLength
      },
    }

    enforceMaxLengths(data, schema)
    expect(data.seo.metaTitle.length).toBe(60)
    expect(data.seo.metaDescription.length).toBe(160)
    expect(data.seo.keywords.length).toBe(500)
  })

  it('should truncate repeatable component fields', () => {
    const schema = {
      attributes: {
        items: {
          type: 'component',
          component: 'shared.seo',
          repeatable: true,
        },
      },
    } as any

    const data = {
      items: [
        { metaTitle: 'x'.repeat(80), metaDescription: 'ok' },
        { metaTitle: 'short', metaDescription: 'y'.repeat(200) },
      ],
    }

    enforceMaxLengths(data, schema)
    expect(data.items[0].metaTitle.length).toBe(60)
    expect(data.items[0].metaDescription).toBe('ok')
    expect(data.items[1].metaTitle).toBe('short')
    expect(data.items[1].metaDescription.length).toBe(160)
  })

  it('should truncate dynamic zone fields', () => {
    const schema = {
      attributes: {
        blocks: {
          type: 'dynamiczone',
          components: ['two-field'],
        },
      },
    } as any

    const data = {
      blocks: [
        {
          __component: 'two-field',
          title: 'x'.repeat(150), // exceeds 100
          number: 42,
        },
      ],
    }

    enforceMaxLengths(data, schema)
    expect(data.blocks[0].title.length).toBe(100)
    expect(data.blocks[0].number).toBe(42)
  })

  it('should handle nested components', () => {
    const schema = {
      attributes: {
        wrapper: {
          type: 'component',
          component: 'shared.nested',
        },
      },
    } as any

    const data = {
      wrapper: {
        inner: {
          label: 'x'.repeat(80), // exceeds 50
        },
      },
    }

    enforceMaxLengths(data, schema)
    expect(data.wrapper.inner.label.length).toBe(50)
  })

  it('should not crash on null data', () => {
    const schema = {
      attributes: {
        title: { type: 'string', maxLength: 10 },
      },
    } as any

    expect(() => enforceMaxLengths(null as any, schema)).not.toThrow()
  })

  it('should not crash on null/undefined field values', () => {
    const schema = {
      attributes: {
        title: { type: 'string', maxLength: 10 },
        seo: { type: 'component', component: 'shared.seo' },
      },
    } as any

    const data = { title: null, seo: undefined }
    expect(() => enforceMaxLengths(data, schema)).not.toThrow()
  })

  it('should skip non-string values even with maxLength', () => {
    const schema = {
      attributes: {
        count: { type: 'string', maxLength: 5 },
      },
    } as any

    const data = { count: 12345678 }
    enforceMaxLengths(data, schema)
    expect(data.count).toBe(12345678)
  })

  it('should log a warning when truncating', () => {
    const schema = {
      attributes: {
        title: { type: 'string', maxLength: 5 },
      },
    } as any

    const data = { title: 'Too long' }
    enforceMaxLengths(data, schema)

    expect(strapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Safety net: "title" exceeded maxLength')
    )
  })
})
