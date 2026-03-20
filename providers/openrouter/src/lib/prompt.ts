type Format = 'plain' | 'markdown' | 'html' | 'jsonb'

const FORMAT_RULES: Record<string, string> = {
  plain: 'The text is plain text. Do not add any formatting.',
  markdown:
    'The text is Markdown. Preserve all Markdown formatting, including headings, lists, links, bold, italic, and code blocks.',
  html: 'The text is HTML. Preserve all HTML tags, attributes, and structure exactly. Only translate text content within elements.',
  jsonb:
    'The text is HTML converted from a rich text editor. Preserve all HTML tags, attributes, and structure exactly. Only translate text content within elements.',
}

export function buildSystemPrompt(
  sourceLocale: string,
  targetLocale: string,
  format: Format = 'plain',
  customPrompt?: string
): string {
  const formatRule = FORMAT_RULES[format] || FORMAT_RULES.plain

  const lines = [
    `You are a professional translator. Translate from ${sourceLocale} to ${targetLocale}.`,
    '',
    'Rules:',
    `- ${formatRule}`,
    '- Do not add explanations, commentary, or notes.',
    '- Preserve code blocks, URLs, HTML tags, and variable placeholders (e.g., {{variable}}) unchanged.',
    '- Return valid JSON only: { "translations": [...] } where the array matches the input array in order and count.',
    '- Each element in the output array must correspond to the element at the same index in the input array.',
  ]

  if (customPrompt) {
    lines.push('', 'Additional instructions:', customPrompt)
  }

  return lines.join('\n')
}
