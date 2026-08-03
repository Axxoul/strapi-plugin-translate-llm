import React, { useState, useEffect } from 'react'
import { Box, Main, Flex, Grid, Typography, TextInput, Textarea, Button, Field, Toggle, SingleSelect, SingleSelectOption } from '@strapi/design-system'
import { Layouts } from '@strapi/strapi/admin'
import { useIntl } from 'react-intl'
import { useAlert } from '../Hooks/useAlert'
import { useGetTranslateSettingsQuery, useUpdateTranslateSettingsMutation } from '../services/settings'
import { useGetAutoTranslateSettingsQuery, useUpdateAutoTranslateSettingsMutation } from '../services/auto-translate'
import { useGetI18NLocalesQuery } from '../services/locales'
import { getTranslation } from '../utils/getTranslation'
import { StatusPanel } from '../components/AutoTranslate/StatusPanel'
import { BatchTranslateStatusPanel } from '../components/BatchTranslate/StatusPanel'
import {
  AutoPublishMode,
  CascadeMode,
  OnSourceUnpublish,
  TranslateOn,
} from '@shared/types/auto-translate-options'

/** Comma-separated UI field ↔ string[]. An empty field means "not set". */
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatList(value: string[] | null | undefined): string {
  return Array.isArray(value) ? value.join(', ') : ''
}

const SettingsPage = () => {
  const { formatMessage } = useIntl()
  const { handleNotification } = useAlert()
  const { data: response, isLoading } = useGetTranslateSettingsQuery({})
  const [updateSettings, { isLoading: isSaving }] = useUpdateTranslateSettingsMutation()

  // Auto-translate settings
  const { data: autoTranslateResponse, isLoading: isAutoTranslateLoading } =
    useGetAutoTranslateSettingsQuery()
  const [updateAutoTranslateSettings, { isLoading: isSavingAutoTranslate }] =
    useUpdateAutoTranslateSettingsMutation()
  const { data: localesData } = useGetI18NLocalesQuery()
  const locales: Array<{ code: string; name: string }> = Array.isArray(localesData)
    ? localesData
    : []

  const autoTranslateSettings = (autoTranslateResponse as any)?.data ?? null
  /** File-config values, so a field can show what it falls back to. */
  const defaultsAuto = autoTranslateSettings?.defaults

  const settings = (response as any)?.data ?? null
  const defaults = settings?.defaults

  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [localeMapJson, setLocaleMapJson] = useState('')

  // Auto-translate local state
  const [autoTranslateEnabled, setAutoTranslateEnabled] = useState(false)
  const [masterLocale, setMasterLocale] = useState('')
  const [translateOn, setTranslateOn] = useState<TranslateOn>('save')
  const [cascade, setCascade] = useState<CascadeMode>('off')
  const [autoPublish, setAutoPublish] = useState<AutoPublishMode>('trigger')
  const [onSourceUnpublish, setOnSourceUnpublish] =
    useState<OnSourceUnpublish>('ignore')
  const [cascadeMaxEntries, setCascadeMaxEntries] = useState('50')
  const [cascadeMaxDepth, setCascadeMaxDepth] = useState('5')
  const [cascadeLocales, setCascadeLocales] = useState('')
  const [cascadeIgnoreContentTypes, setCascadeIgnoreContentTypes] = useState('')

  useEffect(() => {
    if (settings) {
      setApiKey(settings.apiKey || '')
      setApiUrl(settings.apiUrl || '')
      setModel(settings.model || '')
      setTemperature(
        settings.temperature !== undefined && settings.temperature !== null
          ? String(settings.temperature)
          : ''
      )
      setCustomPrompt(settings.customPrompt || '')
      setLocaleMapJson(
        settings.localeMap && Object.keys(settings.localeMap).length > 0
          ? JSON.stringify(settings.localeMap, null, 2)
          : ''
      )
    }
  }, [settings])

  useEffect(() => {
    if (autoTranslateSettings) {
      setAutoTranslateEnabled(autoTranslateSettings.enabled ?? false)
      setMasterLocale(autoTranslateSettings.masterLocale ?? '')
      setTranslateOn(autoTranslateSettings.translateOn ?? 'save')
      setCascade(autoTranslateSettings.cascade ?? 'off')
      setAutoPublish(autoTranslateSettings.autoPublish ?? 'trigger')
      setOnSourceUnpublish(autoTranslateSettings.onSourceUnpublish ?? 'ignore')
      setCascadeMaxEntries(String(autoTranslateSettings.cascadeMaxEntries ?? 50))
      setCascadeMaxDepth(String(autoTranslateSettings.cascadeMaxDepth ?? 5))
      setCascadeLocales(formatList(autoTranslateSettings.cascadeLocales))
      setCascadeIgnoreContentTypes(
        formatList(autoTranslateSettings.cascadeIgnoreContentTypes)
      )
    }
  }, [autoTranslateSettings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    let localeMap: Record<string, string> | undefined
    if (localeMapJson.trim()) {
      try {
        localeMap = JSON.parse(localeMapJson)
      } catch {
        handleNotification({
          type: 'danger',
          id: getTranslation('settings.localeMap.invalid'),
          defaultMessage: 'Locale Map must be valid JSON',
        })
        return
      }
    }

    const tempNum = temperature.trim() ? parseFloat(temperature) : undefined
    if (tempNum !== undefined && (isNaN(tempNum) || tempNum < 0 || tempNum > 2)) {
      handleNotification({
        type: 'danger',
        id: getTranslation('settings.temperature.invalid'),
        defaultMessage: 'Temperature must be a number between 0 and 2',
      })
      return
    }

    try {
      const result = await updateSettings({
        apiKey: apiKey || undefined,
        apiUrl: apiUrl || undefined,
        model: model || undefined,
        temperature: tempNum,
        customPrompt: customPrompt || undefined,
        localeMap,
      }).unwrap()

      if ('warning' in result && result.warning) {
        handleNotification({
          type: 'warning',
          id: getTranslation('settings.save.provider-reload-failed'),
          defaultMessage: result.warning as string,
        })
      } else {
        handleNotification({
          type: 'success',
          id: getTranslation('settings.save.success'),
          defaultMessage: 'Settings saved successfully',
        })
      }
    } catch {
      handleNotification({
        type: 'danger',
        id: getTranslation('settings.save.error'),
        defaultMessage: 'Failed to save settings',
      })
    }
  }

  const handleAutoTranslateSave = async () => {
    if (autoTranslateEnabled && !masterLocale) {
      handleNotification({
        type: 'danger',
        id: getTranslation('auto-translate.settings.masterLocale.required'),
        defaultMessage: 'Master locale is required when auto-translate is enabled',
      })
      return
    }

    const maxEntries = parseInt(cascadeMaxEntries, 10)
    const maxDepth = parseInt(cascadeMaxDepth, 10)
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isInteger(maxDepth) ||
      maxDepth < 1
    ) {
      handleNotification({
        type: 'danger',
        id: getTranslation('auto-translate.settings.bounds.invalid'),
        defaultMessage:
          'Max entries and max depth must both be whole numbers of at least 1',
      })
      return
    }

    try {
      await updateAutoTranslateSettings({
        enabled: autoTranslateEnabled,
        masterLocale,
        translateOn,
        cascade,
        autoPublish,
        onSourceUnpublish,
        cascadeMaxEntries: maxEntries,
        cascadeMaxDepth: maxDepth,
        // An empty allowlist field means "every locale", which the server stores
        // as null — an empty array would mean "no locales at all".
        cascadeLocales: cascadeLocales.trim()
          ? parseList(cascadeLocales)
          : null,
        cascadeIgnoreContentTypes: parseList(cascadeIgnoreContentTypes),
      }).unwrap()
      handleNotification({
        type: 'success',
        id: getTranslation('auto-translate.settings.save.success'),
        defaultMessage: 'Auto-translate settings saved',
      })
    } catch {
      handleNotification({
        type: 'danger',
        id: getTranslation('auto-translate.settings.save.error'),
        defaultMessage: 'Failed to save auto-translate settings',
      })
    }
  }

  // Build hint with "Default from config: xxx" when a config default exists
  function hintWithDefault(baseHint: string, defaultValue?: string): string {
    if (defaultValue) {
      return `${baseHint} (Default from config: ${defaultValue})`
    }
    return baseHint
  }

  if (isLoading) {
    return (
      <Main>
        <Layouts.BaseHeader
          title={formatMessage({
            id: getTranslation('settings.title'),
            defaultMessage: 'Configuration',
          })}
          subtitle={formatMessage({
            id: getTranslation('settings.subtitle'),
            defaultMessage: 'Configure translation provider options',
          })}
        />
      </Main>
    )
  }

  return (
    <Main>
      <form onSubmit={handleSubmit}>
        <Layouts.BaseHeader
          title={formatMessage({
            id: getTranslation('settings.title'),
            defaultMessage: 'Configuration',
          })}
          subtitle={formatMessage({
            id: getTranslation('settings.subtitle'),
            defaultMessage: 'Configure translation provider options',
          })}
          primaryAction={
            <Button type="submit" loading={isSaving}>
              {formatMessage({
                id: getTranslation('settings.save'),
                defaultMessage: 'Save',
              })}
            </Button>
          }
        />
        <Layouts.Content>
          {/* Auto-Translate row: settings + recent logs side by side */}
          <Grid.Root gap={6}>
            <Grid.Item col={6} s={12}>
              <Box
                background="neutral0"
                padding={6}
                shadow="filterShadow"
                hasRadius
                width="100%"
              >
                <Flex direction="column" alignItems="stretch" gap={6}>
                  <Box paddingBottom={2}>
                    <Typography variant="sigma" textColor="neutral600">
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.section'),
                        defaultMessage: 'AUTO-TRANSLATE ON SAVE',
                      })}
                    </Typography>
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="neutral500">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.description'),
                          defaultMessage:
                            'Automatically translate content to all locales when saved or published in the master locale. Translations run in the background.',
                        })}
                      </Typography>
                    </Box>
                  </Box>

                  <Field.Root>
                    <Flex gap={4} alignItems="center">
                      <Toggle
                        checked={autoTranslateEnabled}
                        onChange={() => setAutoTranslateEnabled(!autoTranslateEnabled)}
                        onLabel={formatMessage({
                          id: getTranslation('auto-translate.settings.enabled.on'),
                          defaultMessage: 'Enabled',
                        })}
                        offLabel={formatMessage({
                          id: getTranslation('auto-translate.settings.enabled.off'),
                          defaultMessage: 'Disabled',
                        })}
                      />
                      <Field.Label>
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.enabled.label'),
                          defaultMessage: 'Enable auto-translate on save',
                        })}
                      </Field.Label>
                    </Flex>
                  </Field.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.masterLocale.hint'),
                      defaultMessage:
                        'The source-of-truth locale. Only saves to this locale trigger auto-translation to all others.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.masterLocale.label'),
                        defaultMessage: 'Master Locale',
                      })}
                    </Field.Label>
                    <SingleSelect
                      value={masterLocale}
                      onChange={(value: string | number) => setMasterLocale(String(value))}
                      placeholder={formatMessage({
                        id: getTranslation('auto-translate.settings.masterLocale.placeholder'),
                        defaultMessage: 'Select master locale',
                      })}
                    >
                      {locales.map((locale) => (
                        <SingleSelectOption key={locale.code} value={locale.code}>
                          {locale.name} ({locale.code})
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <Field.Hint />
                  </Field.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.translateOn.hint'),
                      defaultMessage:
                        'Content types without draft & publish have no publish event, so they always translate on save.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.translateOn.label'),
                        defaultMessage: 'Trigger',
                      })}
                    </Field.Label>
                    <SingleSelect
                      value={translateOn}
                      onChange={(value: string | number) =>
                        setTranslateOn(String(value) as TranslateOn)
                      }
                    >
                      <SingleSelectOption value="save">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.translateOn.save'),
                          defaultMessage: 'On save',
                        })}
                      </SingleSelectOption>
                      <SingleSelectOption value="publish">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.translateOn.publish'),
                          defaultMessage: 'On publish',
                        })}
                      </SingleSelectOption>
                    </SingleSelect>
                    <Field.Hint />
                  </Field.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.autoPublish.hint'),
                      defaultMessage:
                        'Publish policy for the entry that was saved. Cascaded dependencies always mirror their own source.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.autoPublish.label'),
                        defaultMessage: 'Publish Mode',
                      })}
                    </Field.Label>
                    <SingleSelect
                      value={autoPublish}
                      onChange={(value: string | number) =>
                        setAutoPublish(String(value) as AutoPublishMode)
                      }
                    >
                      <SingleSelectOption value="trigger">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.autoPublish.trigger'),
                          defaultMessage: 'Match the triggering action',
                        })}
                      </SingleSelectOption>
                      <SingleSelectOption value="mirror">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.autoPublish.mirror'),
                          defaultMessage: 'Mirror source status',
                        })}
                      </SingleSelectOption>
                      <SingleSelectOption value="draft">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.autoPublish.draft'),
                          defaultMessage: 'Always save as draft',
                        })}
                      </SingleSelectOption>
                      <SingleSelectOption value="publish">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.autoPublish.publish'),
                          defaultMessage: 'Always publish',
                        })}
                      </SingleSelectOption>
                    </SingleSelect>
                    <Field.Hint />
                  </Field.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.cascade.hint'),
                      defaultMessage:
                        'Translate related entries that have no version in the target locale yet, before the entry that references them. Existing translations are never overwritten.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.cascade.label'),
                        defaultMessage: 'Dependency Cascade',
                      })}
                    </Field.Label>
                    <SingleSelect
                      value={cascade}
                      onChange={(value: string | number) =>
                        setCascade(String(value) as CascadeMode)
                      }
                    >
                      <SingleSelectOption value="off">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.cascade.off'),
                          defaultMessage: 'Off',
                        })}
                      </SingleSelectOption>
                      <SingleSelectOption value="missing-only">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.cascade.missing-only'),
                          defaultMessage: 'Missing translations only',
                        })}
                      </SingleSelectOption>
                    </SingleSelect>
                    <Field.Hint />
                  </Field.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.onSourceUnpublish.hint'),
                      defaultMessage:
                        'Applies to the unpublished entry only — it is never cascaded to related content.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.onSourceUnpublish.label'),
                        defaultMessage: 'When the source is unpublished',
                      })}
                    </Field.Label>
                    <SingleSelect
                      value={onSourceUnpublish}
                      onChange={(value: string | number) =>
                        setOnSourceUnpublish(String(value) as OnSourceUnpublish)
                      }
                    >
                      <SingleSelectOption value="ignore">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.onSourceUnpublish.ignore'),
                          defaultMessage: 'Leave translations published',
                        })}
                      </SingleSelectOption>
                      <SingleSelectOption value="unpublish">
                        {formatMessage({
                          id: getTranslation('auto-translate.settings.onSourceUnpublish.unpublish'),
                          defaultMessage: 'Unpublish translations too',
                        })}
                      </SingleSelectOption>
                    </SingleSelect>
                    <Field.Hint />
                  </Field.Root>

                  <Grid.Root gap={4}>
                    <Grid.Item col={6} s={12}>
                      <Field.Root
                        width="100%"
                        hint={formatMessage({
                          id: getTranslation('auto-translate.settings.cascadeMaxEntries.hint'),
                          defaultMessage:
                            'Total entries one save may queue, across all target locales.',
                        })}
                      >
                        <Field.Label>
                          {formatMessage({
                            id: getTranslation('auto-translate.settings.cascadeMaxEntries.label'),
                            defaultMessage: 'Max entries per trigger',
                          })}
                        </Field.Label>
                        <TextInput
                          value={cascadeMaxEntries}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setCascadeMaxEntries(e.target.value)
                          }
                          placeholder={String(defaultsAuto?.cascadeMaxEntries ?? 50)}
                        />
                        <Field.Hint />
                      </Field.Root>
                    </Grid.Item>
                    <Grid.Item col={6} s={12}>
                      <Field.Root
                        width="100%"
                        hint={formatMessage({
                          id: getTranslation('auto-translate.settings.cascadeMaxDepth.hint'),
                          defaultMessage: 'Relation hops the cascade may follow.',
                        })}
                      >
                        <Field.Label>
                          {formatMessage({
                            id: getTranslation('auto-translate.settings.cascadeMaxDepth.label'),
                            defaultMessage: 'Max cascade depth',
                          })}
                        </Field.Label>
                        <TextInput
                          value={cascadeMaxDepth}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setCascadeMaxDepth(e.target.value)
                          }
                          placeholder={String(defaultsAuto?.cascadeMaxDepth ?? 5)}
                        />
                        <Field.Hint />
                      </Field.Root>
                    </Grid.Item>
                  </Grid.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.cascadeLocales.hint'),
                      defaultMessage:
                        'Comma-separated locale codes to translate into. Leave empty for every locale.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.cascadeLocales.label'),
                        defaultMessage: 'Target locales',
                      })}
                    </Field.Label>
                    <TextInput
                      value={cascadeLocales}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setCascadeLocales(e.target.value)
                      }
                      placeholder="en, de, fr"
                    />
                    <Field.Hint />
                  </Field.Root>

                  <Field.Root
                    hint={formatMessage({
                      id: getTranslation('auto-translate.settings.cascadeIgnoreContentTypes.hint'),
                      defaultMessage:
                        'Comma-separated content type UIDs the cascade never walks into.',
                    })}
                  >
                    <Field.Label>
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.cascadeIgnoreContentTypes.label'),
                        defaultMessage: 'Ignore content types',
                      })}
                    </Field.Label>
                    <TextInput
                      value={cascadeIgnoreContentTypes}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setCascadeIgnoreContentTypes(e.target.value)
                      }
                      placeholder="api::tag.tag, api::author.author"
                    />
                    <Field.Hint />
                  </Field.Root>

                  <Flex justifyContent="flex-end">
                    <Button
                      onClick={handleAutoTranslateSave}
                      loading={isSavingAutoTranslate}
                      variant="secondary"
                    >
                      {formatMessage({
                        id: getTranslation('auto-translate.settings.save'),
                        defaultMessage: 'Save Auto-Translate Settings',
                      })}
                    </Button>
                  </Flex>
                </Flex>
              </Box>
            </Grid.Item>

            <Grid.Item col={3} s={12}>
              <StatusPanel />
            </Grid.Item>

            <Grid.Item col={3} s={12}>
              <BatchTranslateStatusPanel />
            </Grid.Item>
          </Grid.Root>

          {/* Provider Configuration */}
          <Box
            background="neutral0"
            padding={6}
            shadow="filterShadow"
            hasRadius
            marginTop={6}
          >
            <Flex direction="column" alignItems="stretch" gap={6}>
              <Field.Root
                hint={formatMessage({
                  id: getTranslation('settings.provider.hint'),
                  defaultMessage:
                    'Change in config/plugins.js — cannot be changed from the UI',
                })}
              >
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.provider.label'),
                    defaultMessage: 'Provider',
                  })}
                </Field.Label>
                <TextInput
                  disabled
                  value={settings?.provider || ''}
                />
                <Field.Hint />
              </Field.Root>

              <Field.Root
                hint={
                  defaults?.apiKey
                    ? formatMessage({
                        id: getTranslation('settings.apiKey.hint.withDefault'),
                        defaultMessage:
                          'An API key is set in config/env. Leave unchanged to keep current value.',
                      })
                    : formatMessage({
                        id: getTranslation('settings.apiKey.hint'),
                        defaultMessage:
                          'Overrides the environment variable. Leave unchanged to keep current value.',
                      })
                }
              >
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.apiKey.label'),
                    defaultMessage: 'API Key',
                  })}
                </Field.Label>
                <TextInput
                  type="password"
                  value={apiKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setApiKey(e.target.value)
                  }
                />
                <Field.Hint />
              </Field.Root>

              <Field.Root
                hint={hintWithDefault(
                  formatMessage({
                    id: getTranslation('settings.apiUrl.hint'),
                    defaultMessage: 'Override the default API endpoint',
                  }),
                  defaults?.apiUrl
                )}
              >
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.apiUrl.label'),
                    defaultMessage: 'API URL',
                  })}
                </Field.Label>
                <TextInput
                  value={apiUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setApiUrl(e.target.value)
                  }
                  placeholder={defaults?.apiUrl || 'https://openrouter.ai/api/v1'}
                />
                <Field.Hint />
              </Field.Root>

              <Box paddingTop={2} paddingBottom={2}>
                <Typography variant="sigma" textColor="neutral600">
                  {formatMessage({
                    id: getTranslation('settings.llm.section'),
                    defaultMessage:
                      'LLM PROVIDER OPTIONS — These settings only apply to LLM-based providers like OpenRouter',
                  })}
                </Typography>
              </Box>

              <Field.Root
                hint={hintWithDefault(
                  formatMessage({
                    id: getTranslation('settings.model.hint'),
                    defaultMessage: 'LLM model identifier',
                  }),
                  defaults?.model
                )}
              >
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.model.label'),
                    defaultMessage: 'Model',
                  })}
                </Field.Label>
                <TextInput
                  value={model}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setModel(e.target.value)
                  }
                  placeholder={defaults?.model || 'anthropic/claude-sonnet-4'}
                />
                <Field.Hint />
              </Field.Root>

              <Field.Root
                hint={formatMessage({
                  id: getTranslation('settings.temperature.hint'),
                  defaultMessage:
                    '0 = deterministic, 2 = creative. Default: 0.3',
                })}
              >
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.temperature.label'),
                    defaultMessage: 'Temperature',
                  })}
                </Field.Label>
                <TextInput
                  value={temperature}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setTemperature(e.target.value)
                  }
                  placeholder={
                    defaults?.temperature !== undefined
                      ? String(defaults.temperature)
                      : '0.3'
                  }
                />
                <Field.Hint />
              </Field.Root>

              <Field.Root>
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.customPrompt.label'),
                    defaultMessage: 'Custom Prompt',
                  })}
                </Field.Label>
                <Textarea
                  value={customPrompt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setCustomPrompt(e.target.value)
                  }
                  placeholder={formatMessage({
                    id: getTranslation('settings.customPrompt.placeholder'),
                    defaultMessage:
                      'Additional instructions appended to the system translation prompt',
                  })}
                />
              </Field.Root>

              <Field.Root
                hint={formatMessage({
                  id: getTranslation('settings.localeMap.hint'),
                  defaultMessage:
                    'JSON mapping locale codes to language names for better LLM prompts',
                })}
              >
                <Field.Label>
                  {formatMessage({
                    id: getTranslation('settings.localeMap.label'),
                    defaultMessage: 'Locale Map',
                  })}
                </Field.Label>
                <Textarea
                  value={localeMapJson}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setLocaleMapJson(e.target.value)
                  }
                  placeholder='{"fr": "French", "de": "German", "nb": "Norwegian Bokmål"}'
                />
                <Field.Hint />
              </Field.Root>
            </Flex>
          </Box>
        </Layouts.Content>
      </form>
    </Main>
  )
}

export default SettingsPage
export { SettingsPage }
