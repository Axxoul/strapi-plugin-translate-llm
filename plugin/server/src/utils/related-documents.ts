import { UID } from '@strapi/strapi'
import { populateAll } from './populate-all'
import { CascadeRef } from './cascade-plan'

/**
 * Collect the documents a single document points at through relations the
 * cascade is allowed to follow.
 *
 * Deep-populated on purpose: `buildDependencyGraph()` recurses into components
 * and dynamic zones at the *type* level, so a document-level walk that only read
 * top-level attributes would miss most relations in a real project.
 *
 * Skipped, and why:
 * - non-localized targets — they are copied, never translated, so there is
 *   nothing to create in the target locale;
 * - `translate: 'copy' | 'delete'` — the editor asked for the link to be reused
 *   verbatim or dropped, so a target-locale twin is not wanted;
 * - **morph relations** — they carry no `.target`, so neither the type graph nor
 *   this walk can see where they point. A documented limit, not an oversight;
 * - virtual / non-writable relations such as i18n's own `localizations`.
 */
export async function getRelatedDocuments(
  uid: UID.ContentType,
  documentId: string,
  sourceLocale: string
): Promise<CascadeRef[]> {
  const schema = strapi.contentTypes[uid]
  if (!schema) return []

  const populate = populateAll(schema, {
    populateMedia: false,
    populateRelations: true,
  })

  const document = await strapi.documents(uid).findOne({
    documentId,
    locale: sourceLocale,
    populate,
  })

  if (!document) return []

  const out: CascadeRef[] = []
  collectRelationRefs(document as Record<string, any>, schema.attributes, out)
  return dedupe(out)
}

/**
 * Walk a (populated) document and collect every localized relation target it
 * points at, descending into components and dynamic zones. Exported because the
 * published-row check needs exactly the same traversal over data that is about
 * to be written.
 */
export function collectRelationRefs(
  data: Record<string, any> | null | undefined,
  attributes: Record<string, any>,
  out: CascadeRef[]
) {
  if (!data || !attributes) return

  for (const attr of Object.keys(attributes)) {
    const schema = attributes[attr]
    const value = data[attr]
    if (value === null || value === undefined) continue

    const onTranslate = schema?.pluginOptions?.translate?.translate ?? 'translate'
    if (onTranslate === 'copy' || onTranslate === 'delete') continue

    if (schema.type === 'relation') {
      if (schema.writable === false || schema.unstable_virtual === true) continue

      const target = schema.target as string | undefined
      if (!target) continue // morph — no known target
      if (
        strapi.contentTypes[target]?.pluginOptions?.i18n?.['localized'] !== true
      ) {
        continue
      }

      for (const related of Array.isArray(value) ? value : [value]) {
        const relatedDocumentId = related?.documentId
        if (relatedDocumentId) {
          out.push({ uid: target, documentId: relatedDocumentId })
        }
      }
    } else if (schema.type === 'component') {
      const componentSchema = strapi.components?.[schema.component]
      if (!componentSchema) continue
      for (const item of Array.isArray(value) ? value : [value]) {
        collectRelationRefs(item, componentSchema.attributes, out)
      }
    } else if (schema.type === 'dynamiczone') {
      for (const item of Array.isArray(value) ? value : [value]) {
        const componentSchema = strapi.components?.[item?.__component]
        if (!componentSchema) continue
        collectRelationRefs(item, componentSchema.attributes, out)
      }
    }
  }
}

function dedupe(refs: CascadeRef[]): CascadeRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = `${ref.uid}:${ref.documentId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
