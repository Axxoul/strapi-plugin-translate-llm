import { Schema } from '@strapi/strapi'
import { JSDOM } from 'jsdom'
import { createCache } from 'cache-manager'
import { TRANSLATE_BLOCKS_IMAGE_CACHE_TTL } from '../../utils/constants'

const dom = new JSDOM()

export const blocksImageCache = createCache({
  ttl: TRANSLATE_BLOCKS_IMAGE_CACHE_TTL,
})

/**
 *
 * @param {Array} blocks
 */
export async function cacheImages(
  blocks: Schema.Attribute.BlocksValue | Schema.Attribute.BlocksValue[]
) {
  for (const block of blocks.flat(2)) {
    if (block.type === 'image') {
      await blocksImageCache.set(block.image.url, block.image)
    }
  }
}
/**
 *
 * @param {ChildNode} childNode
 * @returns {Array<string>}
 */
function collectFormattings(
  childNode: ChildNode
): Array<'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'> {
  if (childNode.nodeName === '#text' || childNode.childNodes.length === 0) {
    return []
  }
  if (childNode.childNodes.length > 1) {
    throw new Error('collectFormattings expects an element with a single child')
  }
  const formattings = collectFormattings(childNode.childNodes[0])
  if (childNode.ELEMENT_NODE === 1) {
    const element = childNode as Element
    if (element.tagName === 'STRONG') {
      formattings.push('bold')
    }
    if (element.tagName === 'EM') {
      formattings.push('italic')
    }
    if (element.tagName === 'U') {
      formattings.push('underline')
    }
    if (element.tagName === 'S') {
      formattings.push('strikethrough')
    }
    if (element.tagName === 'CODE') {
      formattings.push('code')
    }
  }
  return formattings
}
const emptyText: [{ type: 'text'; text: '' }] = [
  {
    type: 'text',
    text: '',
  },
]
function convertInlineTextElementToBlocks(element: Element) {
  const elements: Schema.Attribute.BlocksTextNode[] = []
  for (const child of element.childNodes) {
    try {
      const formattings = collectFormattings(child)
      const element: Schema.Attribute.BlocksTextNode = {
        type: 'text',
        text: child.textContent,
      }
      for (const formatting of formattings) {
        element[formatting] = true
      }
      elements.push(element)
    } catch (error) {
      strapi.log.error(
        `Error while converting inline element ${element.outerHTML} to blocks, falling back to no formatting`,
        error
      )
      elements.push({
        type: 'text',
        text: child.textContent,
      })
    }
  }
  if (elements.length === 0) {
    elements.push({
      type: 'text',
      text: element.textContent,
    })
  }
  return elements
}
/**
 *
 * @param {Element} element
 * @returns
 */
function convertInlineElementToBlocks(element: Element) {
  const elements: Array<
    Schema.Attribute.LinkInlineNode | Schema.Attribute.BlocksTextNode
  > = []
  for (const child of element.childNodes) {
    if (child.ELEMENT_NODE === 1) {
      const childElement = child as Element
      if (childElement.tagName === 'A') {
        const anchorElement = childElement as HTMLAnchorElement
        elements.push({
          type: 'link',
          url: anchorElement.getAttribute('href'),
          children: convertInlineTextElementToBlocks(anchorElement),
          rel: anchorElement.getAttribute('rel'),
          target: anchorElement.getAttribute('target'),
        })
        continue
      }
    }
    try {
      const formattings = collectFormattings(child)
      const element: Schema.Attribute.BlocksTextNode = {
        type: 'text',
        text: child.textContent,
      }
      for (const formatting of formattings) {
        element[formatting] = true
      }
      elements.push(element)
    } catch (error) {
      strapi.log.error(
        `Error while converting inline element ${element.outerHTML} to blocks, falling back to no formatting`,
        error
      )
      elements.push({
        type: 'text',
        text: child.textContent,
      })
    }
  }
  if (elements.length === 0) {
    elements.push({
      type: 'text',
      text: element.textContent,
    })
  }
  return elements
}
export async function convertHtmlToBlock(html: string) {
  const root = dom.window.document.createElement('div')
  root.innerHTML = html

  const blocks: Schema.Attribute.BlocksValue = []

  for (const child of root.children) {
    if (child.tagName === 'P') {
      blocks.push({
        type: 'paragraph',
        children: convertInlineElementToBlocks(child),
      })
    }
    if (/^H[1-6]$/.test(child.tagName)) {
      const level = parseInt(child.tagName[1], 10) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({
        type: 'heading',
        level,
        children: convertInlineElementToBlocks(child),
      })
    }
    if (/^[UO]L$/.test(child.tagName)) {
      const listItems = Array.from(child.children).map((li) => ({
        type: 'list-item' as const,
        children: convertInlineElementToBlocks(li),
      }))
      blocks.push({
        type: 'list',
        format: child.tagName === 'UL' ? 'unordered' : 'ordered',
        children: listItems,
      })
    }
    if (child.tagName === 'BLOCKQUOTE') {
      blocks.push({
        type: 'quote',
        children: convertInlineElementToBlocks(child),
      })
    }
    if (child.tagName === 'PRE') {
      // pre also has a code child
      const code = child.querySelector('code')
      blocks.push({
        type: 'code',
        language:
          code?.getAttribute('class')?.replace('language-', '') || undefined,
        children: [
          {
            type: 'text',
            text: code.textContent,
          },
        ],
      })
    }
    if (child.tagName === 'IMG') {
      const imageElement = child as HTMLImageElement
      const cachedImage = await blocksImageCache.get(imageElement.src)
      const image =
        cachedImage != null
          ? cachedImage
          : {
              url: imageElement.src,
              alt: imageElement.alt,
            }
      blocks.push({
        type: 'image',
        image,
        children: emptyText,
      })
    }
  }
  return blocks
}
