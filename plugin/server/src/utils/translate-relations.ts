import { get, cloneDeep, has, compact } from 'lodash'
import { getConfig } from './get-config'
import { Modules, UID } from '@strapi/strapi'
import { Struct, Schema } from '@strapi/strapi'
import { keys } from './objects'
import { TranslatePluginOptions } from '@shared/types/plugin-options'

async function getRelevantLocalization(
  contentType: UID.ContentType,
  documentId: string,
  locale: string
) {
  return strapi.documents(contentType).findOne({ documentId, locale })
}

/**
 * Translate relations by either copying, deleting or using the corresponding locale
 * @param {object} data The data to translate
 * @param {object} schema The schema of the content-type
 * @param {string} targetLocale The target locale (iso-format)
 * @returns The input data with relations either
 *  - copied in the case they can be resued
 *  - deleted if they cannot be reused
 *  - translated if the relation target is localized and the related instance has the targetLocale created
 */
export async function translateRelations<TSchemaUID extends UID.ContentType>(
  data: Modules.Documents.Document<TSchemaUID>,
  schema: Struct.ContentTypeSchema | Struct.ComponentSchema,
  targetLocale: string
) {
  const { translateRelations: shouldTranslateRelations } = getConfig()

  const attributesSchema = schema['attributes']
  const resultData = cloneDeep(data)
  await Promise.all(
    keys(attributesSchema).map(async (attr) => {
      const attributeData = get(data, attr, undefined)

      if (attributeData === null || attributeData === undefined) {
        return
      }

      const attributeSchema = attributesSchema[attr]

      const onTranslate = get(
        attributeSchema,
        ['pluginOptions', 'translate', 'translate'],
        'translate'
      )
      if (
        ['relation', 'component', 'dynamiczone'].includes(attributeSchema.type)
      ) {
        switch (onTranslate) {
          case 'copy':
            if (attributeSchema.type === 'relation') {
              resultData[attr] = shouldTranslateRelations
                ? await translateRelation(
                    attributeData,
                    attributeSchema,
                    targetLocale,
                    String(attr)
                  )
                : undefined
            } else {
              resultData[attr] = attributeData
            }
            break
          case 'delete':
            resultData[attr] = undefined
            break
          case 'translate':
          default:
            if (attributeSchema.type === 'relation') {
              resultData[attr] = shouldTranslateRelations
                ? await translateRelation(
                    attributeData,
                    attributeSchema,
                    targetLocale,
                    String(attr)
                  )
                : undefined
            } else if (attributeSchema.type === 'component') {
              resultData[attr] = await translateComponent(
                attributeData,
                attributeSchema,
                targetLocale
              )
            } else if (attributeSchema.type === 'dynamiczone') {
              resultData[attr] = await Promise.all(
                attributeData.map((object: Modules.Documents.AnyDocument) =>
                  translateComponent(object, attributeSchema, targetLocale)
                )
              )
            }
            break
        }
      }
    })
  )
  return resultData
}

async function translateComponent<TSchemaUID extends UID.Component>(
  data: Modules.Documents.Document<TSchemaUID>,
  componentReference: Schema.Attribute.AnyAttribute,
  targetLocale: string
) {
  if (!data) {
    return undefined
  }
  const componentSchema =
    componentReference.type === 'dynamiczone'
      ? strapi.components[data['__component']]
      : strapi.components[componentReference['component']]
  if (componentReference['repeatable'] && Array.isArray(data)) {
    return Promise.all(
      data.map((value) =>
        translateRelations(value, componentSchema, targetLocale)
      )
    )
  }
  return translateRelations(data, componentSchema, targetLocale)
}

/**
 * Log relations that could not be mapped to the target locale.
 *
 * A related document without a `targetLocale` localization is dropped here and
 * nothing revisits it later, which is how links silently went missing for
 * months. The reverse pass in `relink-relations.ts` repairs these once the
 * missing localization appears — this log makes the gap visible in the meantime.
 */
function logDroppedRelations(
  dropped: number,
  attr: string,
  target: string,
  targetLocale: string
) {
  if (dropped > 0) {
    strapi.log.debug(
      `[translate] dropped ${dropped} unresolved ${attr} relation(s) to ${target} for locale ${targetLocale} (no localization yet)`
    )
  }
}

async function translateRelation(
  attributeData: any,
  attributeSchema: Schema.Attribute.Relation,
  targetLocale: string,
  attr = 'relation'
) {
  const relationSchema = strapi.contentTypes[attributeSchema['target']]

  const relationIsLocalized = get(
    relationSchema,
    'pluginOptions.i18n.localized',
    false
  ) as boolean

  const onTranslate = get(
    attributeSchema,
    'pluginOptions.translate.translate',
    'translate'
  ) as TranslatePluginOptions['translate']

  const relationIsBothWays =
    has(attributeSchema, 'inversedBy') || has(attributeSchema, 'mappedBy')

  if (onTranslate === 'delete') {
    return undefined
  }

  if (onTranslate === 'copy') {
    if (relationIsLocalized || relationIsBothWays) {
      return ['oneToMany', 'manyToMany'].includes(attributeSchema.relation)
        ? []
        : undefined
    } else {
      return attributeData
    }
  }

  // If the relation is localized, the relevant localizations from the relation should be selected
  if (relationIsLocalized) {
    // for oneToMany and manyToMany relations there are multiple relations possible, so all of them need to be considered
    if (
      ['oneToMany', 'manyToMany'].includes(attributeSchema.relation) &&
      Array.isArray(attributeData) &&
      attributeData.length > 0
    ) {
      const localizations = await Promise.all(
        attributeData.map(async (prevRelation) =>
          getRelevantLocalization(
            attributeSchema['target'],
            prevRelation['documentId'],
            targetLocale
          )
        )
      )
      const resolved = compact(localizations)
      logDroppedRelations(
        localizations.length - resolved.length,
        attr,
        attributeSchema['target'],
        targetLocale
      )
      return resolved
    } else if (
      ['oneToOne', 'manyToOne'].includes(attributeSchema.relation) &&
      attributeData
    ) {
      const localization = await getRelevantLocalization(
        attributeSchema['target'],
        attributeData['documentId'],
        targetLocale
      )
      logDroppedRelations(
        localization ? 0 : 1,
        attr,
        attributeSchema['target'],
        targetLocale
      )
      return localization
    }
  } else if (
    relationIsBothWays &&
    ['oneToOne', 'oneToMany'].includes(attributeSchema.relation)
  ) {
    // In this case the relations in other locales or in the referenced relations would be deleted
    // so there is not really a different option than to not include these relations
    return attributeSchema.relation == 'oneToMany' ? [] : undefined
  }
  return attributeData
}
