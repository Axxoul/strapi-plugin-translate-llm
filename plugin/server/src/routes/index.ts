import autoTranslateRoutes from './auto-translate'
import batchTranslateLogRoutes from './batch-translate-log'
import translateRoutes from './translate'
import providerRoutes from './provider'
import settingsRoutes from './settings'

export default [
  ...autoTranslateRoutes,
  ...batchTranslateLogRoutes,
  ...translateRoutes,
  ...providerRoutes,
  ...settingsRoutes,
]
