import autoTranslateRoutes from './auto-translate'
import translateRoutes from './translate'
import providerRoutes from './provider'
import settingsRoutes from './settings'

export default [
  ...autoTranslateRoutes,
  ...translateRoutes,
  ...providerRoutes,
  ...settingsRoutes,
]
