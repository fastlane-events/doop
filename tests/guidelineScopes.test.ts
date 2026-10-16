import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as actions from '../server/actions.ts'
import { organisationRules } from '../server/guide.ts'
import { store } from '../server/store.ts'
import { mergeGuidelines } from '../shared/types.ts'
import type { Actor, Canvas, GuidelineDoc } from '../shared/types.ts'

/* the merge and the unread tracking are pure in-memory logic: only the
   write-through to the database is stubbed */
vi.mock('../server/db/persist.ts', () => ({
  saveCanvas: () => {},
  saveGuideline: () => {},
  saveGuidelineVersion: () => {},
  saveScopedGuideline: () => {},
  saveScopedGuidelineVersion: () => {},
  deleteScopedGuideline: () => {},
  saveActivity: () => {},
}))

const actor: Actor = { name: 'Ada', kind: 'user', color: '#000' }

function canvas(id: string, workspaceId?: string): Canvas {
  return {
    id,
    name: id,
    ownerId: 'u1',
    ...(workspaceId ? { workspaceId } : {}),
    createdAt: 0,
    updatedAt: 0,
    frames: [],
  }
}

const doc = (name: string, markdown: string, kind: GuidelineDoc['kind'] = 'style'): GuidelineDoc => ({
  name,
  markdown,
  kind,
  updatedAt: 0,
  updatedBy: 'Ada',
})

beforeEach(() => {
  store.canvases.clear()
  store.initScopedGuidelines([])
  store.init([canvas('team', 'ws1'), canvas('solo')])
})

describe('guideline scopes', () => {
  it('merges instance, workspace and canvas docs by name, nearest scope winning', () => {
    actions.setScopedGuideline('instance', actions.INSTANCE_SCOPE_ID, 'brand', '# Instance brand', actor)
    actions.setScopedGuideline('instance', actions.INSTANCE_SCOPE_ID, 'voice', '# Instance voice', actor)
    actions.setScopedGuideline('instance', actions.INSTANCE_SCOPE_ID, 'grid', '# Instance grid', actor)
    actions.setScopedGuideline('workspace', 'ws1', 'brand', '# Workspace brand', actor)
    actions.setScopedGuideline('workspace', 'ws1', 'voice', '# Workspace voice', actor)
    actions.setGuideline('team', 'voice', '# Canvas voice', actor)

    const team = actions.effectiveGuidelines('team').map((d) => `${d.name}:${d.scope}:${d.markdown}`)
    expect(team).toEqual([
      'brand:workspace:# Workspace brand',
      'grid:instance:# Instance grid',
      'voice:canvas:# Canvas voice',
    ])
  })

  it('gives a personal canvas the instance docs and its own, never a workspace’s', () => {
    actions.setScopedGuideline('instance', actions.INSTANCE_SCOPE_ID, 'brand', '# Instance brand', actor)
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Workspace tone', actor)
    actions.setGuideline('solo', 'layout', '# Solo layout', actor)
    expect(actions.effectiveGuidelines('solo').map((d) => `${d.name}:${d.scope}`)).toEqual([
      'brand:instance',
      'layout:canvas',
    ])
  })

  it('defaults a new doc to style and keeps the kind when an update omits it', () => {
    const created = actions.setScopedGuideline('workspace', 'ws1', 'rules', '# Rules', actor, undefined, 'instructions')
    expect(created?.kind).toBe('instructions')
    expect(actions.setScopedGuideline('workspace', 'ws1', 'rules', '# Rules v2', actor)?.kind).toBe('instructions')
    expect(actions.setGuideline('team', 'look', '# Look', actor)?.kind).toBe('style')
  })

  it('treats inherited docs as unread until the agent reads the canvas’s docs', () => {
    actions.setGuideline('team', 'look', '# Look', actor)
    actions.markGuidelinesSeen('team', 'Claude')
    expect(actions.unreadGuidelines('team', 'Claude')).toEqual([])

    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone', actor)
    expect(actions.unreadGuidelines('team', 'Claude').map((d) => `${d.scope}:${d.name}`)).toEqual(['workspace:tone'])
    /* another agent has read nothing */
    expect(actions.unreadGuidelines('team', 'Codex')).toHaveLength(2)

    actions.markGuidelinesSeen('team', 'Claude')
    expect(actions.unreadGuidelines('team', 'Claude')).toEqual([])
  })

  it('validates scoped docs like canvas docs and deletes them with empty markdown', () => {
    expect(() => actions.setScopedGuideline('workspace', 'ws1', 'Not A Slug!', '# x', actor)).toThrow(
      /invalid doc name/,
    )
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone', actor)
    expect(actions.setScopedGuideline('workspace', 'ws1', 'tone', '', actor)).toBeNull()
    expect(store.getScopedGuidelines('workspace', 'ws1')).toEqual([])
  })

  it('merges layers farthest first', () => {
    const merged = mergeGuidelines([
      [{ ...doc('a', 'instance'), scope: 'instance' }],
      [{ ...doc('a', 'canvas'), scope: 'canvas' }],
    ])
    expect(merged).toMatchObject([{ name: 'a', markdown: 'canvas', scope: 'canvas' }])
  })
})

describe('organisationRules', () => {
  it('renders only instructions docs, each headed with its name and scope', () => {
    const rules = organisationRules([
      { label: 'instance', docs: [doc('alt-text', 'Describe images.', 'instructions'), doc('brand', 'Blue.')] },
      { label: 'workspace "Acme"', docs: [{ ...doc('tone', 'Warm.', 'instructions'), title: 'Tone of voice' }] },
    ])
    expect(rules).toContain("## Your organisation's rules")
    expect(rules).toContain('### alt-text (alt-text, instance scope)\n\nDescribe images.')
    expect(rules).toContain('### Tone of voice (tone, workspace "Acme" scope)\n\nWarm.')
    expect(rules).not.toContain('Blue.')
  })

  it('is empty when there are no instructions docs', () => {
    expect(organisationRules([{ label: 'instance', docs: [doc('brand', 'Blue.')] }])).toBe('')
  })
})
