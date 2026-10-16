/**
 * Set (or delete) a workspace or instance guideline from a file — for
 * operators who keep their organisation's rules in git and seed them at
 * deploy time. Agents cannot write these scopes (MCP refuses), so this, the
 * settings UI and the REST API are the ways in.
 *
 * Writes through the same path as the UI (actions.setScopedGuideline):
 * same validation, same no-shadowing rule, a version in the doc's history
 * saved by "cli". Runs against the database this process is configured
 * for: DATABASE_URL, or the local PGlite under ./data when unset (stop the
 * server first then — PGlite allows one process at a time).
 *
 * A running server keeps the guidelines it loaded at boot: restart it to
 * pick the change up. There is no cross-process signal to reuse.
 *
 * Usage (in the server container: npx tsx scripts/set-guideline.ts …):
 *   bun x tsx --env-file-if-exists=.env scripts/set-guideline.ts \
 *     --scope instance|workspace [--workspace <id>] --name <slug> \
 *     [--kind style|instructions] [--title <title>] (--file <path> | --delete)
 */

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import { db, initDb } from '../server/db/index.ts'
import * as persist from '../server/db/persist.ts'
import * as t from '../server/db/schema.ts'
import * as actions from '../server/actions.ts'
import { store } from '../server/store.ts'
import { isGuidelineKind } from '../shared/types.ts'
import type { Actor, GuidelineKind, InheritedScope } from '../shared/types.ts'

const USAGE =
  'usage: set-guideline --scope instance|workspace [--workspace <id>] --name <slug> [--kind style|instructions] [--title <title>] (--file <path> | --delete)'

/* every version this script saves is attributed to the operator's CLI */
const CLI: Actor = { name: 'cli', kind: 'user', color: '#6b7280' }

interface Options {
  scope: InheritedScope
  scopeId: string
  name: string
  markdown: string
  title?: string
  kind?: GuidelineKind
}

function fail(message: string): never {
  console.error(`set-guideline: ${message}\n${USAGE}`)
  process.exit(1)
}

function parse(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: 'string' },
      workspace: { type: 'string' },
      name: { type: 'string' },
      kind: { type: 'string' },
      title: { type: 'string' },
      file: { type: 'string' },
      delete: { type: 'boolean' },
    },
  })
  const scope = values.scope
  if (scope !== 'instance' && scope !== 'workspace') fail('--scope must be instance or workspace')
  if (scope === 'workspace' && !values.workspace) fail('--scope workspace needs --workspace <id>')
  if (scope === 'instance' && values.workspace) fail('--workspace only goes with --scope workspace')
  if (!values.name) fail('--name is required')
  if (values.kind !== undefined && !isGuidelineKind(values.kind)) fail('--kind must be style or instructions')
  if (!!values.file === !!values.delete) fail('pass exactly one of --file and --delete')
  const markdown = values.file ? readFileSync(values.file, 'utf8') : ''
  /* empty markdown deletes: never let an empty file do that by accident */
  if (values.file && !markdown.trim()) fail(`${values.file} is empty — use --delete to delete a guideline`)
  return {
    scope,
    scopeId: scope === 'workspace' ? values.workspace! : actions.INSTANCE_SCOPE_ID,
    name: values.name,
    markdown,
    title: values.title,
    kind: values.kind as GuidelineKind | undefined,
  }
}

/** The canvases whose own doc of this name the rule now hides — read from
 *  the database, since this process holds no canvases (the server's
 *  equivalent is actions.shadowedCanvasDocs). */
async function shadowedCanvasDocs(opts: Options, name: string) {
  const rows = await db
    .select({ id: t.canvases.id, name: t.canvases.name, workspaceId: t.canvases.workspaceId })
    .from(t.guidelines)
    .innerJoin(t.canvases, eq(t.canvases.id, t.guidelines.canvasId))
    .where(eq(t.guidelines.name, name))
  return rows.filter((c) => opts.scope === 'instance' || c.workspaceId === opts.scopeId)
}

async function main() {
  const opts = parse(process.argv.slice(2))
  await initDb()
  if (opts.scope === 'workspace') {
    const [ws] = await db.select({ id: t.workspaces.id }).from(t.workspaces).where(eq(t.workspaces.id, opts.scopeId))
    if (!ws) fail(`no workspace with id ${opts.scopeId}`)
  }
  store.initScopedGuidelines(await persist.loadScopedGuidelines())
  const slug = opts.name.trim().toLowerCase()
  const existed = store.getScopedGuidelines(opts.scope, opts.scopeId).some((d) => d.name === slug)
  const doc = actions.setScopedGuideline(opts.scope, opts.scopeId, opts.name, opts.markdown, CLI, opts.title, opts.kind)
  const failed = await persist.drain()
  if (failed) {
    console.error(`set-guideline: ${failed} database write(s) failed — see above`)
    process.exit(1)
  }
  const where = opts.scope === 'workspace' ? `workspace ${opts.scopeId}` : 'the instance'
  if (!doc) {
    console.log(existed ? `deleted guideline "${slug}" from ${where}` : `no guideline "${slug}" on ${where}`)
  } else {
    console.log(`${existed ? 'updated' : 'created'} ${doc.kind} guideline "${doc.name}" on ${where}`)
    /* a rule hides any same-named canvas doc below it: say which */
    const hidden = doc.kind === 'instructions' ? await shadowedCanvasDocs(opts, doc.name) : []
    if (hidden.length)
      console.warn(
        `warning: this rule hides the canvas doc "${doc.name}" on ${hidden.length} canvas(es): ${hidden.map((c) => `${c.name} (${c.id})`).join(', ')}`,
      )
  }
  console.log('a running server picks this up on its next restart')
  process.exit(0)
}

main().catch((e) => {
  console.error(`set-guideline: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
