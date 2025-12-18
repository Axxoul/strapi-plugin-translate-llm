import { Schema } from '@strapi/strapi'
import { Converter } from 'showdown'
import { JSDOM } from 'jsdom'
import { FormatService } from '@shared/services/format'

import { renderBlock } from './blocks-to-html'
import { cacheImages, convertHtmlToBlock } from './html-to-blocks'

export const dom = new JSDOM()
const showdownConverter = new Converter({
  noHeaderId: true,
  strikethrough: true,
})

function markdownToHtml(singleText: string): string {
  return showdownConverter.makeHtml(singleText)
}

function htmlToMarkdown(singleText: string): string {
  return showdownConverter
    .makeMarkdown(singleText, dom.window.document)
    .replace(/<!-- -->\n/g, '')
    .trim()
}

export default (): FormatService => ({
  markdownToHtml(text) {
    if (Array.isArray(text)) {
      return text.map(markdownToHtml)
    }
    return markdownToHtml(text)
  },
  htmlToMarkdown(text) {
    if (Array.isArray(text)) {
      return text.map(htmlToMarkdown)
    }
    return htmlToMarkdown(text)
  },
  async blockToHtml(block) {
    if (!Array.isArray(block)) {
      throw new Error(
        'blockToHtml expects an array of blocks or a single block. Got ' +
          typeof block
      )
    }
    await cacheImages(block)
    if (block.length > 0) {
      if (!('type' in block[0])) {
        return (block as Schema.Attribute.BlocksValue[]).map(renderBlock)
      }
      return renderBlock(block as Schema.Attribute.BlocksValue)
    }
  },
  async htmlToBlock(html) {
    if (Array.isArray(html)) {
      return Promise.all(html.map(convertHtmlToBlock))
    }
    return convertHtmlToBlock(html)
  },
})
