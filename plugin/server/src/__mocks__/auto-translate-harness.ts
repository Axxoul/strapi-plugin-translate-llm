import { jest } from '@jest/globals'
import configModule, { TranslateConfig } from '../config'

const LOG_UID = 'plugin::translate.auto-translate-log'

type Row = Record<string, any>

/** Minimal `where` matcher covering the operators the queue actually uses. */
function matches(row: Row, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = row[field]
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      return Object.entries(condition).every(([op, operand]) => {
        switch (op) {
          case '$in':
            return (operand as any[]).includes(value)
          case '$eq':
            return value === operand
          case '$lt':
            return value < (operand as any)
          default:
            throw new Error(`unsupported operator ${op} in test harness`)
        }
      })
    }
    return value === condition
  })
}

function sortRows(rows: Row[], orderBy?: Record<string, 'asc' | 'desc'>): Row[] {
  if (!orderBy) return rows
  const [field, direction] = Object.entries(orderBy)[0]
  return [...rows].sort((a, b) => {
    if (a[field] === b[field]) return 0
    const cmp = a[field] < b[field] ? -1 : 1
    return direction === 'desc' ? -cmp : cmp
  })
}

export type ContentTypeFixture = {
  localized?: boolean
  draftAndPublish?: boolean
  displayName?: string
  /** Documents that exist per locale: `locale → Set<documentId>` */
  localizations?: Record<string, string[]>
  /** Documents with a published row per locale. */
  published?: Record<string, string[]>
}

export type HarnessOptions = {
  config?: Partial<TranslateConfig>
  /** DB-store overrides (what the Settings page writes). */
  settings?: Record<string, any>
  locales?: string[]
  defaultLocale?: string
  contentTypes?: Record<string, ContentTypeFixture>
  /** Related documents keyed by `"uid:documentId"`. */
  relations?: Record<string, Array<{ uid: string; documentId: string }>>
  /**
   * How far in the past queued rows are stamped. Negative values skip the
   * executor's settle delay, which keeps drain tests fast and deterministic.
   */
  rowAgeMs?: number
  translateEntity?: (...args: any[]) => any
}

export function createHarness(options: HarnessOptions = {}) {
  const {
    config = {},
    settings = {},
    locales = ['sv', 'en', 'de'],
    defaultLocale = 'sv',
    contentTypes = {},
    relations = {},
    rowAgeMs = 1000,
  } = options

  const rows: Row[] = []
  let nextId = 1

  const translateEntity =
    options.translateEntity ?? jest.fn(async () => ({ ok: true }))

  const store: Record<string, any> = { [LOG_UID]: null }
  let storedSettings: Record<string, any> | null =
    Object.keys(settings).length > 0 ? { ...settings } : null

  const schemas: Record<string, any> = {}
  for (const [uid, fixture] of Object.entries(contentTypes)) {
    schemas[uid] = {
      uid,
      kind: 'collectionType',
      options: { draftAndPublish: fixture.draftAndPublish !== false },
      pluginOptions: { i18n: { localized: fixture.localized !== false } },
      info: { displayName: fixture.displayName ?? uid },
      attributes: {},
    }
  }

  function fixtureOf(uid: string): ContentTypeFixture {
    return contentTypes[uid] ?? {}
  }

  const logDocuments = {
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: nextId,
        documentId: `log-${nextId}`,
        createdAt: new Date(Date.now() - rowAgeMs).toISOString(),
        ...data,
      }
      nextId++
      rows.push(row)
      return row
    }),
    update: jest.fn(async ({ documentId, data }: any) => {
      const row = rows.find((r) => r.documentId === documentId)
      if (row) Object.assign(row, data)
      return row
    }),
  }

  function contentDocuments(uid: string) {
    const fixture = fixtureOf(uid)
    return {
      count: jest.fn(async ({ locale, filters }: any = {}) => {
        const ids = fixture.localizations?.[locale] ?? []
        const wanted = filters?.documentId?.$eq
        if (wanted) return ids.includes(wanted) ? 1 : 0
        return ids.length
      }),
      findOne: jest.fn(async ({ documentId, locale, status }: any = {}) => {
        if (status === 'published') {
          return fixture.published?.[locale]?.includes(documentId)
            ? { documentId, locale }
            : null
        }
        return fixture.localizations?.[locale]?.includes(documentId)
          ? { documentId, locale, title: `${uid}:${documentId}` }
          : null
      }),
      findFirst: jest.fn(async () => null),
      unpublish: jest.fn(async () => ({ documentId: 'x' })),
    }
  }

  const documentServices: Record<string, any> = {}

  const strapi: any = {
    contentTypes: schemas,
    components: {},
    config: {
      get: jest.fn((key: string) => {
        if (key === 'plugin::translate') {
          return { ...configModule.default(), ...config }
        }
        return undefined
      }),
    },
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    store: jest.fn(() => ({
      get: async () => storedSettings,
      set: async ({ value }: any) => {
        storedSettings = value
      },
    })),
    documents: jest.fn((uid: string) => {
      if (uid === LOG_UID) return logDocuments
      if (!documentServices[uid]) documentServices[uid] = contentDocuments(uid)
      return documentServices[uid]
    }),
    db: {
      query: jest.fn((uid: string) => {
        if (uid !== LOG_UID) throw new Error(`unexpected db.query for ${uid}`)
        return {
          findMany: jest.fn(async ({ where, orderBy, limit }: any = {}) => {
            const found = sortRows(
              rows.filter((r) => matches(r, where)),
              orderBy
            )
            return limit ? found.slice(0, limit) : found
          }),
          count: jest.fn(
            async ({ where }: any = {}) =>
              rows.filter((r) => matches(r, where)).length
          ),
          deleteMany: jest.fn(async ({ where }: any = {}) => {
            const keep = rows.filter((r) => !matches(r, where))
            const removed = rows.length - keep.length
            rows.length = 0
            rows.push(...keep)
            return { count: removed }
          }),
        }
      }),
    },
    plugin: jest.fn((name: string) => {
      if (name === 'i18n') {
        return {
          service: () => ({
            find: async () => locales.map((code) => ({ code })),
            getDefaultLocale: async () => defaultLocale,
          }),
        }
      }
      if (name === 'translate') {
        return {
          service: (serviceName: string) => {
            if (serviceName === 'translate') return { translateEntity }
            if (serviceName === 'auto-translate') return strapi.__autoTranslate
            return {}
          },
        }
      }
      return { service: () => ({}) }
    }),
  }

  ;(global as any).strapi = strapi

  return {
    strapi,
    rows,
    translateEntity,
    relations,
    getStoredSettings: () => storedSettings,
  }
}

export function restoreStrapi(previous: any) {
  ;(global as any).strapi = previous
}

export { LOG_UID }
