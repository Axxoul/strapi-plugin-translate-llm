import { get } from 'lodash'
import { ContentTypeSchema, ComponentSchema } from '@strapi/types/dist/struct'
import { Attribute } from '@strapi/types/dist/schema'

/**
 * Safety net: walk data + schema recursively and truncate any string
 * field that exceeds its maxLength constraint. This runs right before
 * saving to Strapi to prevent validation errors from LLM-generated content.
 *
 * Mutates `data` in-place (caller should pass a cloned copy).
 */
export function enforceMaxLengths(
  data: Record<string, any>,
  schema: ContentTypeSchema | ComponentSchema
): void {
  if (!data) return

  const attributesSchema = get(schema, 'attributes', {}) as Record<
    string,
    Attribute.AnyAttribute
  >

  for (const attr of Object.keys(attributesSchema)) {
    const attrSchema = attributesSchema[attr]
    const value = data[attr]

    if (value == null) continue

    const type = attrSchema.type

    if (type === 'string' || type === 'text' || type === 'richtext') {
      const maxLength = (attrSchema as any).maxLength as number | undefined
      if (
        maxLength != null &&
        typeof value === 'string' &&
        value.length > maxLength
      ) {
        strapi.log.warn(
          `[translate] Safety net: "${attr}" exceeded maxLength (${value.length}/${maxLength}), truncating`
        )
        data[attr] = value.substring(0, maxLength)
      }
    } else if (type === 'component') {
      const componentAttr = attrSchema as Attribute.Component
      const componentSchema = strapi.components[componentAttr.component]
      if (!componentSchema) continue

      if (componentAttr['repeatable'] && Array.isArray(value)) {
        for (const item of value) {
          enforceMaxLengths(item, componentSchema)
        }
      } else if (typeof value === 'object') {
        enforceMaxLengths(value, componentSchema)
      }
    } else if (type === 'dynamiczone') {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!item?.__component) continue
          const dzSchema = strapi.components[item.__component]
          if (dzSchema) {
            enforceMaxLengths(item, dzSchema)
          }
        }
      }
    }
  }
}
