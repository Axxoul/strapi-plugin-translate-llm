/**
 * Wraps an async operation with periodic heartbeat writes to prevent
 * reverse proxy timeouts (Heroku 30s, ALB 60s).
 *
 * Writes space characters every 15s. The final JSON response is appended
 * after the spaces — JSON.parse tolerates leading whitespace by spec.
 */
export async function withKeepAlive(
  ctx: any,
  work: () => Promise<any>
): Promise<void> {
  ctx.respond = false
  ctx.res.writeHead(200, { 'Content-Type': 'application/json' })

  const heartbeat = setInterval(() => {
    if (!ctx.res.writableEnded) ctx.res.write(' ')
  }, 15_000)

  try {
    const result = await work()
    clearInterval(heartbeat)
    ctx.res.end(JSON.stringify(result))
  } catch (error: any) {
    clearInterval(heartbeat)
    ctx.res.end(
      JSON.stringify({
        data: null,
        error: { message: error.message || 'Translation failed' },
      })
    )
  }
}
