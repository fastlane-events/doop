import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, startServer, type Server } from './harness.ts'

/**
 * scripts/set-guideline.ts, the operator CLI that seeds workspace and
 * instance guidelines from files: run against a real server's database
 * while the server is stopped (PGlite allows one process), then read back
 * through the server after it restarts — the documented way a running
 * server picks the change up.
 */

const ROOT = process.cwd()
let server: Server
let owner: Client
let workspaceId: string
let canvasId: string

beforeAll(async () => {
  server = await startServer()
  owner = new Client(server)
  await owner.signUp('cli-owner@test.dev', 'Owner')
  workspaceId = (await (await owner.post('/api/workspaces', { name: 'Acme' })).json()).id
  canvasId = (await (await owner.post('/api/canvases', { name: 'Launch', workspaceId })).json()).id
}, 70_000)

afterAll(() => server?.stop())

/** Run the CLI in the server's data directory; resolves with its exit code and output. */
function cli(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      path.join(ROOT, 'node_modules', '.bin', 'tsx'),
      [path.join(ROOT, 'scripts', 'set-guideline.ts'), ...args],
      {
        cwd: server.dataDir,
        env: { ...process.env, NODE_ENV: undefined as unknown as string, DATABASE_URL: '' },
      },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
    )
  })
}

function file(name: string, content: string): string {
  const at = path.join(server.dataDir, name)
  writeFileSync(at, content)
  return at
}

async function stop() {
  server.stop({ keepData: true })
  await server.stopped
}

async function restart() {
  server = await startServer({}, server.dataDir)
}

describe('set-guideline CLI', () => {
  it('writes instance and workspace docs that a restarted server serves, with history by "cli"', async () => {
    await stop()
    const rules = file('rules.md', '# Alt text\n\nDescribe every image.')
    const brand = file('brand.md', '# Brand\n\nInk blue.')
    const instance = await cli('--scope', 'instance', '--name', 'alt-text', '--kind', 'instructions', '--file', rules)
    expect(instance.code, instance.out).toBe(0)
    expect(instance.out).toContain('created instructions guideline "alt-text" on the instance')
    expect(instance.out).toContain('restart')
    const ws = await cli('--scope', 'workspace', '--workspace', workspaceId, '--name', 'brand', '--file', brand)
    expect(ws.code, ws.out).toBe(0)
    expect(ws.out).toContain(`created style guideline "brand" on workspace ${workspaceId}`)

    await restart()
    const canvas = await (await owner.get(`/api/canvases/${canvasId}`)).json()
    expect(
      canvas.inheritedGuidelines.map(
        (d: { scope: string; name: string; kind: string }) => `${d.scope}:${d.name}:${d.kind}`,
      ),
    ).toEqual(['instance:alt-text:instructions', 'workspace:brand:style'])
    const history = await (await owner.get(`/api/workspaces/${workspaceId}/guidelines/brand/history`)).json()
    expect(history).toMatchObject([{ markdown: '# Brand\n\nInk blue.', savedBy: 'cli' }])
  }, 70_000)

  it('refuses bad input without writing anything', async () => {
    await stop()
    const md = file('x.md', '# X')
    const missingWorkspace = await cli('--scope', 'workspace', '--workspace', 'nope', '--name', 'x', '--file', md)
    expect(missingWorkspace.code).toBe(1)
    expect(missingWorkspace.out).toContain('no workspace with id nope')
    const shadow = await cli('--scope', 'workspace', '--workspace', workspaceId, '--name', 'alt-text', '--file', md)
    expect(shadow.code).toBe(1)
    expect(shadow.out).toContain('instance rule')
    const empty = await cli('--scope', 'instance', '--name', 'x', '--file', file('empty.md', '  \n'))
    expect(empty.code).toBe(1)
    expect(empty.out).toContain('use --delete')
    const both = await cli('--scope', 'instance', '--name', 'x', '--file', md, '--delete')
    expect(both.code).toBe(1)
    const badKind = await cli('--scope', 'instance', '--name', 'x', '--kind', 'odd', '--file', md)
    expect(badKind.code).toBe(1)
    await restart()
    const canvas = await (await owner.get(`/api/canvases/${canvasId}`)).json()
    expect(canvas.inheritedGuidelines.map((d: { name: string }) => d.name)).toEqual(['alt-text', 'brand'])
  }, 70_000)

  it('deletes with --delete, recording the deletion', async () => {
    await stop()
    const res = await cli('--scope', 'workspace', '--workspace', workspaceId, '--name', 'brand', '--delete')
    expect(res.code, res.out).toBe(0)
    expect(res.out).toContain(`deleted guideline "brand" from workspace ${workspaceId}`)
    const again = await cli('--scope', 'workspace', '--workspace', workspaceId, '--name', 'brand', '--delete')
    expect(again.out).toContain('no guideline "brand"')
    await restart()
    const canvas = await (await owner.get(`/api/canvases/${canvasId}`)).json()
    expect(canvas.inheritedGuidelines.map((d: { name: string }) => d.name)).toEqual(['alt-text'])
    const history = await (await owner.get(`/api/workspaces/${workspaceId}/guidelines/brand/history`)).json()
    expect(history.map((v: { markdown: string; savedBy: string }) => [v.markdown, v.savedBy])).toEqual([
      ['', 'cli'],
      ['# Brand\n\nInk blue.', 'cli'],
    ])
  }, 70_000)
})
