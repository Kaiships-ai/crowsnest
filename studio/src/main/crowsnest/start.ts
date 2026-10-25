import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, protocol } from 'electron'
import { startMcpHttp } from './mcp-http'

export const CROWSNEST_MEDIA_SCHEME: Electron.CustomScheme = {
  scheme: 'cn-media',
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
}

/**
 * Copies the checkout's `data/crowsnest.db` to `target` once, with its WAL so writes
 * :3000 has not checkpointed yet come along. The source is only read as files, never
 * opened as a database, because :3000 still owns it.
 */
function copyDbOnce(source: string, target: string): void {
  if (existsSync(target) || !existsSync(source)) {
    return
  }
  for (const suffix of ['-wal', '']) {
    if (existsSync(source + suffix)) {
      copyFileSync(source + suffix, `${target}.copy${suffix}`)
    }
  }
  if (existsSync(`${target}.copy-wal`)) {
    renameSync(`${target}.copy-wal`, `${target}-wal`)
  }
  renameSync(`${target}.copy`, target)
}

/**
 * Runs crowsnest's `src/server` in this process on `<userData>/crowsnest.db`: migrations,
 * the MCP on a free 127.0.0.1 port, `cn-media:` assets, and the jobs when
 * LEAD_STUDIO_PRIMARY=1. Call after app ready.
 */
export async function startCrowsnest(): Promise<void> {
  const checkout = resolve(app.getAppPath(), '..')
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'crowsnest.db')
  copyDbOnce(join(checkout, 'data/crowsnest.db'), dbPath)
  // src/server reads both at import time, so they are set before the import below.
  process.env.CROWSNEST_DB_PATH = dbPath
  process.env.MEDIA_ROOT ??= join(checkout, 'data/media')

  const server = await import('../../../../src/server/start')
  const stopJobs = server.startInApp({ migrationsFolder: join(checkout, 'drizzle') })
  const stopMcp = await startMcpHttp(server.handleMcpRequest, join(userData, 'mcp.port'))
  protocol.handle(CROWSNEST_MEDIA_SCHEME.scheme, (request) => {
    const params = Promise.resolve({ assetId: new URL(request.url).pathname.slice(1) })
    return request.method === 'HEAD'
      ? server.headMedia(request, { params })
      : server.getMedia(request, { params })
  })
  app.once('will-quit', () => {
    stopMcp()
    stopJobs()
  })
  console.log(
    `[crowsnest] db ${dbPath}, mcp.port written, jobs ${process.env.LEAD_STUDIO_PRIMARY === '1' ? 'on' : 'off'}`
  )
}
