import { Schema } from '@strapi/strapi'

/* -------------------------------------------------------------------------------------------------
 * MIT License
 * Copyright (c) 2024 Aeneas Meier
 * Small modifications to the original code to fix an issue with strapi types
 * -----------------------------------------------------------------------------------------------*/

const renderChildren = (
  children: (
    | Schema.Attribute.BlocksTextNode
    | Schema.Attribute.BlocksInlineNode
    | Schema.Attribute.ListBlockNode
  )[]
): string => {
  let html = ''
  children.forEach((child) => {
    if (child.type === 'text') {
      html += renderText(child)
    } else if (child.type === 'link') {
      html += `<a href="${child.url}" rel="${child.rel}" target="${child.target}">${renderChildren(child.children)}</a>`
    } else if (child.type === 'list-item') {
      html += `<li>${renderChildren(child.children)}</li>`
    } else if (child.type === 'list') {
      html += renderList(child)
    }
  })
  return html
}

const renderText = (node: Schema.Attribute.BlocksTextNode): string => {
  let html = node.text
  if (node.bold) {
    html = `<strong>${html}</strong>`
  }

  if (node.italic) {
    html = `<em>${html}</em>`
  }

  if (node.underline) {
    html = `<u>${html}</u>`
  }

  if (node.strikethrough) {
    html = `<s>${html}</s>`
  }

  if (node.code) {
    html = `<code>${html}</code>`
  }

  return html
}

const renderList = (node: Schema.Attribute.ListBlockNode): string => {
  const items: string[] = []
  let pendingPieces: string[] | null = null

  const flushPending = () => {
    if (pendingPieces && pendingPieces.length > 0) {
      items.push(`<li>${pendingPieces.join('')}</li>`)
      pendingPieces = null
    }
  }

  node.children.forEach((child) => {
    if (child.type === 'list-item') {
      flushPending()
      pendingPieces = [renderChildren(child.children)]
    } else if (child.type === 'list') {
      const nestedHtml = renderList(child)
      if (pendingPieces) {
        pendingPieces.push(nestedHtml)
      } else {
        items.push(`<li>${nestedHtml}</li>`)
      }
    }
  })

  flushPending()

  const tag = node.format === 'ordered' ? 'ol' : 'ul'
  return `<${tag}>${items.join('')}</${tag}>`
}

export const renderBlock = (block: Schema.Attribute.BlocksValue): string => {
  if (!block) return ''
  let html = ''
  block.forEach((block) => {
    if (block.type === 'paragraph') {
      html += `<p>${renderChildren(block.children)}</p>`
    } else if (block.type === 'quote') {
      html += `<blockquote>${renderChildren(block.children)}</blockquote>`
    } else if (block.type === 'code') {
      html += `<pre><code class="language-${block.language}">${renderChildren(block.children)}</code></pre>`
    } else if (block.type === 'heading') {
      switch (block.level) {
        case 1:
          html += `<h1>${renderChildren(block.children)}</h1>`
          return
        case 2:
          html += `<h2>${renderChildren(block.children)}</h2>`
          return
        case 3:
          html += `<h3>${renderChildren(block.children)}</h3>`
          return
        case 4:
          html += `<h4>${renderChildren(block.children)}</h4>`
          return
        case 5:
          html += `<h5>${renderChildren(block.children)}</h5>`
          return
        case 6:
          html += `<h6>${renderChildren(block.children)}</h6>`
          return
      }
    } else if (block.type === 'list') {
      html += renderList(block)
    } else if (block.type === 'image') {
      html += `<img src="${block.image.url}" alt="${block.image.alternativeText || undefined}" />`
    }
  })
  return html
}
