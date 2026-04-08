import autoTranslate from './auto-translate'
import batchTranslateJob from './batch-translate-job'
import batchTranslateLog from './batch-translate-log'
import provider from './provider'
import settings from './settings'
import translate from './translate'
import updatedEntry from './updated-entry'

export default {
  'auto-translate': autoTranslate,
  'batch-translate-job': batchTranslateJob,
  'batch-translate-log': batchTranslateLog,
  provider,
  settings,
  translate,
  'updated-entry': updatedEntry,
}
