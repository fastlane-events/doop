import type express from 'express'
import * as actions from './actions.ts'
import * as persist from './db/persist.ts'
import { store } from './store.ts'
import { isGuidelineKind } from '../shared/types.ts'
import type { InheritedScope } from '../shared/types.ts'

/**
 * The REST bodies for workspace and instance guidelines, shared by the
 * workspace router (server/workspaces.ts) and the admin router
 * (server/admin.ts). Each router checks who may read or write first; these
 * mirror the canvas guideline routes in server/index.ts.
 */

export function listScoped(res: express.Response, scope: InheritedScope, scopeId: string) {
  res.json(store.getScopedGuidelines(scope, scopeId))
}

/* doc history, newest first — '' markdown rows mark deletions */
export async function sendScopedHistory(
  req: express.Request<{ name: string }>,
  res: express.Response,
  scope: InheritedScope,
  scopeId: string,
) {
  const rows = await persist.listScopedGuidelineVersions(scope, scopeId, req.params.name.toLowerCase())
  res.json(rows.map((v) => ({ markdown: v.markdown, savedAt: v.savedAt, savedBy: v.savedBy })))
}

/* upsert a named doc; empty markdown deletes it */
export function putScoped(
  req: express.Request<{ name: string }>,
  res: express.Response,
  scope: InheritedScope,
  scopeId: string,
) {
  const { markdown, title, kind } = req.body ?? {}
  if (kind !== undefined && !isGuidelineKind(kind))
    return res.status(400).json({ error: "kind must be 'style' or 'instructions'" })
  const actor = actions.resolveActor({ name: req.user!.name, kind: 'user' })
  try {
    const doc = actions.setScopedGuideline(
      scope,
      scopeId,
      req.params.name,
      String(markdown ?? ''),
      actor,
      typeof title === 'string' ? title : undefined,
      kind,
    )
    res.json(doc ? { ok: true, doc } : { ok: true, deleted: true })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid doc' })
  }
}
