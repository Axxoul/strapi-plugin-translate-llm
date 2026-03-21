import { toLower } from 'lodash'
import { TranslateProvider } from '../../../shared/types/provider'
import { TranslateProviderOptions } from '../../../shared/types/provider'
import dummyProvider from './dummy-provider'

export const createProvider = async (
  providerName: string,
  providerOptions: TranslateProviderOptions
) => {
  const name = toLower(providerName)
  let provider: TranslateProvider

  if (name === 'dummy') {
    provider = dummyProvider
  } else {
    let modulePath: string
    const moduleName = `strapi-provider-translate-${name}`
    try {
      modulePath = require.resolve(moduleName, {
        paths: [process.cwd(), __dirname],
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        modulePath = name
      } else {
        throw error
      }
    }

    try {
      provider = require(modulePath)
    } catch (err) {
      console.error(err)
      throw new Error(
        `Could not load translate provider "${name}": ${err instanceof Error ? err.message : err}`
      )
    }
  }

  return provider.init(providerOptions)
}
