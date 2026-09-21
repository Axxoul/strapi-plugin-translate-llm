import { jest } from '@jest/globals'
import { Context } from 'koa'

export default (
  body: unknown,
  query?: unknown,
  headers?: Record<string, string>
): Context => {
  const chunks: string[] = []
  return {
    body: {},
    request: {
      body,
      headers: headers ?? {},
    },
    query: query ?? {},
    respond: true,
    res: {
      writableEnded: false,
      writeHead: jest.fn(),
      write: jest.fn((chunk: string) => chunks.push(chunk)),
      end: jest.fn((data?: string) => {
        if (data) chunks.push(data)
      }),
      _chunks: chunks,
    },
    badRequest: jest.fn(),
    notFound: jest.fn(),
    unauthorized: jest.fn(),
    forbidden: jest.fn(),
    payloadTooLarge: jest.fn(),
    uriTooLong: jest.fn(),
    tooManyRequests: jest.fn(),
    paymentRequired: jest.fn(),
    internalServerError: jest.fn(),
  } as any as Context
}
