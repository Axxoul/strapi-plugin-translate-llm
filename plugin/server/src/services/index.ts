import autoTranslate from './auto-translate'
import batchTranslateJob from './batch-translate-job'
import chunks from './chunks'
import provider from './provider'
import settings from './settings'
import translate from './translate'
import untranslated from './untranslated'
import format from './format'
import updatedEntry from './updated-entry'

export default {
  'auto-translate': autoTranslate,
  'batch-translate-job': batchTranslateJob,
  provider,
  settings,
  translate,
  untranslated,
  chunks,
  format,
  'updated-entry': updatedEntry,
}
