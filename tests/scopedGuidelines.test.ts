import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'

/**
 * Workspace and instance guidelines against the real server: who may write
 * which scope (REST and MCP), how a canvas resolves a name across scopes,
 * what get_guide hands every connecting agent, the unread nudge for
 * inherited docs, version history, and that the docs survive a reboot.
 */

let server: Server

beforeAll(async () => {
  server = await startServer({ ADMIN_EMAILS: 'boss@test.dev' })
}, 70_000)

afterAll(() => server?.stop())

interface ToolResult {
  content: { type: string; text?: string }[]
  isError?: boolean
}

/** One stateless MCP tool call, authenticated by an agent key. */
async function callTool(secret: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await fetch(`${server.base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const body = await res.json()
  if (!body.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(body)}`)
  return body.result as ToolResult
}

async function initializeInstructions(secret: string): Promise<string> {
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
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'scoped-test', version: '1' } },
    }),
  })
  return (await res.json()).result.instructions
}

const textOf = (result: ToolResult) => result.content.map((c) => c.text ?? '').join('\n')

async function mintKey(client: Client): Promise<string> {
  const res = await client.post('/api/agent-keys', { name: 'test' })
  return (await res.json()).secret
}

function put(client: Client, path: string, body: unknown) {
  return client.req(path, { method: 'PUT', body: JSON.stringify(body) })
}

describe('scoped guidelines', () => {
  let boss: Client
  let owner: Client
  let mate: Client
  let stranger: Client
  let bossKey: string
  let ownerKey: string
  let mateKey: string
  let strangerKey: string
  let workspaceId: string
  let canvasId: string

  beforeAll(async () => {
    boss = new Client(server)
    owner = new Client(server)
    mate = new Client(server)
    stranger = new Client(server)
    await boss.signUp('boss@test.dev', 'Boss')
    await owner.signUp('sg-owner@test.dev', 'Owner')
    await mate.signUp('sg-mate@test.dev', 'Mate')
    await stranger.signUp('sg-stranger@test.dev', 'Stranger')
    bossKey = await mintKey(boss)
    ownerKey = await mintKey(owner)
    mateKey = await mintKey(mate)
    strangerKey = await mintKey(stranger)
    workspaceId = (await (await owner.post('/api/workspaces', { name: 'Acme' })).json()).id
    await owner.post(`/api/workspaces/${workspaceId}/members`, { email: 'sg-mate@test.dev' })
    canvasId = (await (await owner.post('/api/canvases', { name: 'Launch', workspaceId })).json()).id
  }, 30_000)

  it('lets only workspace admins write workspace docs over REST, and members read them', async () => {
    const doc = { markdown: '# Brand\n\nUse ink blue.', title: 'Brand' }
    expect((await put(mate, `/api/workspaces/${workspaceId}/guidelines/brand`, doc)).status).toBe(403)
    expect((await put(stranger, `/api/workspaces/${workspaceId}/guidelines/brand`, doc)).status).toBe(404)
    expect((await put(owner, `/api/workspaces/${workspaceId}/guidelines/brand`, { ...doc, kind: 'odd' })).status).toBe(
      400,
    )
    const res = await put(owner, `/api/workspaces/${workspaceId}/guidelines/brand`, doc)
    expect(res.status).toBe(200)
    expect((await res.json()).doc).toMatchObject({ name: 'brand', kind: 'style', updatedBy: 'Owner' })

    const listed = await (await mate.get(`/api/workspaces/${workspaceId}/guidelines`)).json()
    expect(listed).toMatchObject([{ name: 'brand', title: 'Brand', kind: 'style' }])
    expect((await stranger.get(`/api/workspaces/${workspaceId}/guidelines`)).status).toBe(404)
  })

  it('lets only instance admins write instance docs, hiding the surface from everyone else', async () => {
    const doc = { markdown: '# Ship rules\n\nAlways write alt text.', kind: 'instructions' }
    expect((await put(owner, '/api/admin/guidelines/ship-rules', doc)).status).toBe(404)
    expect((await owner.get('/api/admin/guidelines')).status).toBe(404)
    expect((await put(boss, '/api/admin/guidelines/ship-rules', doc)).status).toBe(200)
    expect(await (await boss.get('/api/admin/guidelines')).json()).toMatchObject([
      { name: 'ship-rules', kind: 'instructions' },
    ])
  })

  it('keeps a capped version history per scoped doc, deletions included', async () => {
    const path = `/api/workspaces/${workspaceId}/guidelines/brand`
    await put(owner, path, { markdown: '# Brand\n\nUse ink blue and paper white.' })
    await put(owner, path, { markdown: '' })
    const history = await (await mate.get(`${path}/history`)).json()
    expect(history.map((v: { markdown: string }) => v.markdown)).toEqual([
      '',
      '# Brand\n\nUse ink blue and paper white.',
      '# Brand\n\nUse ink blue.',
    ])
    expect((await stranger.get(`${path}/history`)).status).toBe(404)
    expect((await (await mate.get(`/api/workspaces/${workspaceId}/guidelines`)).json()).length).toBe(0)
    /* restore, as the history panel would */
    expect((await put(owner, path, { markdown: '# Brand\n\nUse ink blue.', title: 'Brand' })).status).toBe(200)
    const adminHistory = await (await boss.get('/api/admin/guidelines/ship-rules/history')).json()
    expect(adminHistory).toHaveLength(1)
  })

  it('serves a canvas with the docs it inherits', async () => {
    const canvas = await (await mate.get(`/api/canvases/${canvasId}`)).json()
    expect(canvas.guidelines ?? []).toEqual([])
    expect(
      canvas.inheritedGuidelines.map((d: { scope: string; name: string }) => `${d.scope}:${d.name}`).sort(),
    ).toEqual(['instance:ship-rules', 'workspace:brand'])
  })

  it('refuses workspace and instance writes over MCP to those who may not make them', async () => {
    const args = { canvas_id: canvasId, name: 'tone', markdown: '# Tone\n\nWarm.', agent_name: 'Claude' }
    const asMember = await callTool(mateKey, 'set_guidelines', { ...args, scope: 'workspace' })
    expect(asMember.isError).toBe(true)
    expect(textOf(asMember)).toContain('only a workspace admin')

    const asOwnerInstance = await callTool(ownerKey, 'set_guidelines', { ...args, scope: 'instance' })
    expect(asOwnerInstance.isError).toBe(true)
    expect(textOf(asOwnerInstance)).toContain('only an instance admin')

    const asOwner = await callTool(ownerKey, 'set_guidelines', { ...args, scope: 'workspace', kind: 'instructions' })
    expect(asOwner.isError).toBeFalsy()
    expect(JSON.parse(textOf(asOwner))).toMatchObject({ ok: true, scope: 'workspace', kind: 'instructions' })

    /* the boss can write the instance scope from any canvas they can open —
       their own, here — but gains no access to anyone else's canvas */
    const bossCanvas = (await (await boss.get('/api/canvases')).json())[0].id
    const viaOwn = await callTool(bossKey, 'set_guidelines', {
      ...args,
      canvas_id: bossCanvas,
      name: 'alt-text',
      markdown: '# Alt text\n\nDescribe every image.',
      scope: 'instance',
      kind: 'instructions',
    })
    expect(viaOwn.isError).toBeFalsy()
    const viaForeign = await callTool(bossKey, 'set_guidelines', { ...args, scope: 'instance' })
    expect(viaForeign.isError).toBe(true)
    expect(textOf(viaForeign)).toContain('no canvas')

    /* a personal canvas has no workspace to write to */
    const personal = (await (await stranger.get('/api/canvases')).json())[0].id
    const noWorkspace = await callTool(strangerKey, 'set_guidelines', {
      ...args,
      canvas_id: personal,
      scope: 'workspace',
    })
    expect(textOf(noWorkspace)).toContain('not in a workspace')
  })

  it('resolves a name nearest-scope-first and says which scope served it', async () => {
    const inherited = await callTool(mateKey, 'get_guidelines', { canvas_id: canvasId, name: 'brand' })
    expect(textOf(inherited)).toContain('Use ink blue.')
    expect(textOf(inherited)).toContain('scope: workspace')

    /* a canvas doc of the same name overrides the workspace's on this canvas */
    expect(
      (await put(mate, `/api/canvases/${canvasId}/guidelines/brand`, { markdown: '# Brand\n\nGreen.' })).status,
    ).toBe(200)
    const own = await callTool(mateKey, 'get_guidelines', { canvas_id: canvasId, name: 'brand' })
    expect(textOf(own)).toContain('Green.')
    expect(textOf(own)).toContain('scope: canvas')

    const listed = JSON.parse(textOf(await callTool(mateKey, 'list_guidelines', { canvas_id: canvasId })))
    expect(
      listed.guidelines.map((d: { name: string; scope: string; kind: string }) => `${d.scope}:${d.name}:${d.kind}`),
    ).toEqual([
      'instance:alt-text:instructions',
      'canvas:brand:style',
      'instance:ship-rules:instructions',
      'workspace:tone:instructions',
    ])

    const canvas = JSON.parse(textOf(await callTool(mateKey, 'get_canvas', { canvas_id: canvasId })))
    expect(canvas.guidelines.find((d: { name: string }) => d.name === 'ship-rules')).toMatchObject({
      scope: 'instance',
      kind: 'instructions',
      summary: 'Ship rules',
    })
  })

  it("appends the organisation's rules to get_guide: the instance's and the reader's workspaces'", async () => {
    const forMate = textOf(await callTool(mateKey, 'get_guide', { topic: 'doop-instructions' }))
    expect(forMate).toContain('# Doop Agent Guide')
    const rules = forMate.slice(forMate.indexOf("## Your organisation's rules"))
    expect(rules).toContain("## Your organisation's rules")
    expect(rules).toContain('(ship-rules, instance scope)')
    expect(rules).toContain('Always write alt text.')
    expect(rules).toContain('(tone, workspace "Acme" scope)')
    expect(rules).toContain('Warm.')
    /* style docs are not working rules */
    expect(rules).not.toContain('Use ink blue.')

    const forStranger = textOf(await callTool(strangerKey, 'get_guide', { topic: 'doop-instructions' }))
    expect(forStranger).toContain('Always write alt text.')
    expect(forStranger).not.toContain('Warm.')

    const instructions = await initializeInstructions(strangerKey)
    expect(instructions).toContain('get_guide includes them after the guide')
    expect(instructions).toContain("This install's rules for agents: alt-text, ship-rules")
  })

  it('nudges an agent about inherited docs it has not read, until it reads them', async () => {
    const create = () =>
      callTool(ownerKey, 'create_frame', {
        canvas_id: canvasId,
        name: 'Hero',
        html: '<h1>Hi</h1>',
        agent_name: 'Nudged',
      })
    const first = textOf(await create())
    expect(first).toContain('style guides you have not read')
    expect(first).toContain('ship-rules (instance)')
    expect(first).toContain('tone (workspace)')

    await callTool(ownerKey, 'list_guidelines', { canvas_id: canvasId, agent_name: 'Nudged' })
    expect(textOf(await create())).not.toContain('style guides you have not read')

    /* a doc that appears later is unread again */
    await put(owner, `/api/workspaces/${workspaceId}/guidelines/spacing`, { markdown: '# Spacing\n\n8px grid.' })
    const later = textOf(await create())
    expect(later).toContain('spacing (workspace)')
    expect(later).not.toContain('tone (workspace)')
  })

  it('keeps every scope across a restart', async () => {
    server.stop({ keepData: true })
    server = await startServer({ ADMIN_EMAILS: 'boss@test.dev' }, server.dataDir)
    const canvas = await (await mate.get(`/api/canvases/${canvasId}`)).json()
    expect(canvas.guidelines).toMatchObject([{ name: 'brand', kind: 'style' }])
    expect(
      canvas.inheritedGuidelines
        .map((d: { scope: string; name: string; kind: string }) => `${d.scope}:${d.name}:${d.kind}`)
        .sort(),
    ).toEqual([
      'instance:alt-text:instructions',
      'instance:ship-rules:instructions',
      'workspace:brand:style',
      'workspace:spacing:style',
      'workspace:tone:instructions',
    ])
  }, 70_000)

  it("drops a deleted workspace's docs", async () => {
    expect((await owner.delete(`/api/workspaces/${workspaceId}`)).status).toBe(200)
    const canvas = await (await owner.get(`/api/canvases/${canvasId}`)).json()
    expect(canvas.inheritedGuidelines.map((d: { scope: string }) => d.scope)).toEqual(['instance', 'instance'])
  })
})
