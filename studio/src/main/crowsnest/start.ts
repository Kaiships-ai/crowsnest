import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, protocol } from 'electron'
import { JIRA_IMAGE_CUSTOM_SCHEME } from '../jira/attachments/image-protocol'
import { MEDIA_PREVIEW_CUSTOM_SCHEME } from '../media/media-preview-protocol'
import { startMcpHttp } from './mcp-http'

const CROWSNEST_MEDIA_SCHEME: Electron.CustomScheme = {
  scheme: 'cn-media',
  privileges: {
    standard: true,
    secure: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}

export const PRIVILEGED_CUSTOM_SCHEMES = [
  MEDIA_PREVIEW_CUSTOM_SCHEME,
  JIRA_IMAGE_CUSTOM_SCHEME,
  CROWSNEST_MEDIA_SCHEME
]

// Copied as files, never opened: the :3000 server still owns the source DB.
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
  process.env.CROWSNEST_DB_PATH = dbPath
  process.env.MEDIA_ROOT ??= join(checkout, 'data/media')

  const server = await import('../../../../src/server/start')
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
    `[crowsnest] db ${dbPath}, mcp.port written, jobs ${process.env.LEAD_STUDIO_PRIMARY === '1' ? 'on' : 'off'}`
  )
}
