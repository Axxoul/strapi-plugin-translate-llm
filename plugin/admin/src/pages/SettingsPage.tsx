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

    try {
      await updateAutoTranslateSettings({
        enabled: autoTranslateEnabled,
        masterLocale,
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

            <Grid.Item col={6} s={12}>
              <StatusPanel />
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
