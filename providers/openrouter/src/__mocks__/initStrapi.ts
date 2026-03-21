import { get, set } from 'lodash'
import translatePlugin from 'strapi-plugin-translate-llm/strapi-server'

const initSetup = async () => {
  const translate = translatePlugin()
  let mock = {
    plugin(name: keyof typeof this.plugins) {
      return this.plugins[name]
    },
    getRef() {
      return this
    },
    plugins: {
      translate: {
        service(name: keyof typeof this.services) {
          return this.services[name]({ strapi: mock.getRef() as any })
        },
        services: translate.services,
      },
      'content-type-builder': {
        service(name: keyof typeof this.services) {
          return this.services[name]
        },
        services: {
          components: {
            formatComponent(componentInfo: any) {
              return componentInfo
            },
          },
          'content-types': {
            formatContentType(contentTypeInfo: any) {
              return contentTypeInfo
            },
          },
        },
      },
    },
    service(uid: string) {
      const [handler, collection] = uid.split('::')
      if (handler === 'plugin') {
        const [plugin, service] = collection.split('.')
        return mock.plugins[plugin as any].services[service]({
          strapi: mock.getRef(),
        })
      }
      return {
        // @ts-expect-error TS(2339)
        findOne: (id, params) => this.entityService.findOne(uid, id, params),
        // @ts-expect-error TS(2339)
        find: (params) => this.entityService.findMany(uid, params),
        // @ts-expect-error TS(2339)
        create: (params) => this.entityService.create(uid, params),
        // @ts-expect-error TS(2339)
        update: (id, params) => this.entityService.update(uid, id, params),
        // @ts-expect-error TS(2339)
        delete: (id, params) => this.entityService.delete(uid, id, params),
      }
    },
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    config: {
      has: function (prop = '') {
        return !!get(this.plugins, prop.replace('plugin::', ''))
      },
      get: function (prop = '', defaultValue: any) {
        return (
          get(this.plugins, String(prop).replace('plugin::', '')) ||
          defaultValue
        )
      },
      set: function (prop = '', value: any) {
        return set(this.plugins, prop.replace('plugin::', ''), value)
      },
      plugins: {
        translate: {},
      },
    },
  }

  return mock
}

const setup = async function () {
  Object.defineProperty(global, 'strapi', {
    value: await initSetup(),
    writable: true,
  })
}

export default setup
