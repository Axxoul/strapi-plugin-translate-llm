const RETRYABLE_STATUS_CODES = [429, 500, 502, 503]

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      const status = error?.status || error?.response?.status
      if (attempt >= maxRetries || !RETRYABLE_STATUS_CODES.includes(status)) {
        throw error
      }
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt))
    }
  }
}
