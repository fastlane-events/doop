import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'

/**
 * The AGPL §13 source offer: DOOP_SOURCE_URL reaches the public config the
 * signed-out app reads (and from there the "Source code" link) and the MCP
 * initialize instructions; unset, neither mentions it.
 */

let withUrl: Server
let without: Server

beforeAll(async () => {
  ;[withUrl, without] = await Promise.all([
    startServer({ DOOP_SOURCE_URL: 'https://github.com/example/doop/' }),
    startServer(),
  ])
}, 70_000)

afterAll(() => {
  withUrl?.stop()
  without?.stop()
})

describe('source offer', () => {
  it('serves DOOP_SOURCE_URL without a session, trailing slash trimmed', async () => {
    const config = await (await fetch(`${withUrl.base}/api/oidc-config`)).json()
    expect(config.sourceUrl).toBe('https://github.com/example/doop')
  })

  it('leaves it out when unset', async () => {
    const config = await (await fetch(`${without.base}/api/oidc-config`)).json()
    expect(config).not.toHaveProperty('sourceUrl')
  })

  it('names the source in the MCP initialize instructions only when set', async () => {
    expect(await instructions(withUrl)).toContain(
      '- Source code of this Doop deployment: https://github.com/example/doop',
    )
    expect(await instructions(without)).not.toContain('Source code of this Doop deployment')
  })
})

/** Sign up, mint an agent key and return the server's initialize instructions. */
async function instructions(server: Server): Promise<string> {
  const client = await new Client(server).signUp(`source-${server.port}@test.dev`, 'Reader')
  const { secret } = await (await client.post('/api/agent-keys', { name: 'source' })).json()
  const res = await fetch(`${server.base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'source-test', version: '1' } },
    }),
  })
  return (await res.json()).result.instructions
}
