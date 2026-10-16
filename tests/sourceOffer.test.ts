import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type Server } from './harness.ts'

/**
 * The AGPL §13 source offer: DOOP_SOURCE_URL reaches the public config the
 * signed-out app reads (and from there the "Source code" link); unset, the
 * field is absent and nothing renders.
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
})
