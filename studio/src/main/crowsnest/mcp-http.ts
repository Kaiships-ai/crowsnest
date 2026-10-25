import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { rmSync, writeFileSync } from 'node:fs'

type McpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/**
 * Serves crowsnest's MCP at `/api/mcp` on 127.0.0.1 with a free port, written to
 * `portFile` so `scripts/lead-studio-mcp.mjs` and `mcp.sh` can find it.
 */
export async function startMcpHttp(handle: McpHandler, portFile: string): Promise<() => void> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/mcp')) {
      void handle(req, res)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  writeFileSync(portFile, String((server.address() as AddressInfo).port))
  return () => {
    rmSync(portFile, { force: true })
    server.close()
  }
}
