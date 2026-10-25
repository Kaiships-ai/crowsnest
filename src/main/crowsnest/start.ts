import { join } from 'node:path'
import { app, protocol } from 'electron'
import { startMcpHttp } from './mcp-http'

export const CROWSNEST_MEDIA_SCHEME: Electron.CustomScheme = {
  scheme: 'cn-media',
  privileges: {
    standard: true,
    secure: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}

/**
 * Runs crowsnest's `src/server` in this process on the checkout's `data/crowsnest.db`, or
 * on CROWSNEST_DB_PATH when a verify lane sets it: migrations, the MCP on a free 127.0.0.1
 * port, `cn-media:` assets, and the jobs. Call after app ready.
 */
export async function startCrowsnest(): Promise<void> {
  const checkout = app.getAppPath()
  const userData = app.getPath('userData')
  process.env.CROWSNEST_DB_PATH ??= join(checkout, 'data/crowsnest.db')
  process.env.MEDIA_ROOT ??= join(checkout, 'data/media')

  const server = await import('../../server/start')
  const stopJobs = server.startInApp({ migrationsFolder: join(checkout, 'drizzle') })
  const stopMcp = await startMcpHttp(server.handleMcpRequest, join(userData, 'mcp.port'))
  protocol.handle(CROWSNEST_MEDIA_SCHEME.scheme, async (request) => {
    const params = Promise.resolve({ assetId: new URL(request.url).pathname.slice(1) })
    const res = await (request.method === 'HEAD' ? server.headMedia : server.getMedia)(request, {
      params
    })
    res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  })
  app.once('will-quit', () => {
    stopMcp()
    stopJobs()
  })
  console.log(
    `[crowsnest] db ${process.env.CROWSNEST_DB_PATH}, mcp.port written, publish jobs ${process.env.LEAD_STUDIO_PUBLISH_JOBS === '1' ? 'on' : 'off'}`
  )
}
