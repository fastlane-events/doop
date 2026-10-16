import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as actions from '../server/actions.ts'
import { canvasNotes, organisationRules, workspaceRules } from '../server/guide.ts'
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
  saveProposal: () => {},
}))
/* the resident module pulls in model clients; only its prompt builder is under test */
const { guidelineBlocks } = await import('../server/resident.ts')

const actor: Actor = { name: 'Ada', kind: 'user', color: '#000' }
const INSTANCE = actions.INSTANCE_SCOPE_ID

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

const names = (docs: { name: string; scope: string }[]) => docs.map((d) => `${d.name}:${d.scope}`)

beforeEach(() => {
  store.canvases.clear()
  store.initScopedGuidelines([])
  store.init([canvas('team', 'ws1'), canvas('team2', 'ws1'), canvas('other', 'ws2'), canvas('solo')])
})

describe('guideline scopes', () => {
  it('merges style docs by name, nearest scope winning', () => {
    actions.setScopedGuideline('instance', INSTANCE, 'brand', '# Instance brand', actor)
    actions.setScopedGuideline('instance', INSTANCE, 'voice', '# Instance voice', actor)
    actions.setScopedGuideline('instance', INSTANCE, 'grid', '# Instance grid', actor)
    actions.setScopedGuideline('workspace', 'ws1', 'brand', '# Workspace brand', actor)
    actions.setScopedGuideline('workspace', 'ws1', 'voice', '# Workspace voice', actor)
    actions.setGuideline('team', 'voice', '# Canvas voice', actor)

    const team = actions.effectiveGuidelines('team', true).map((d) => `${d.name}:${d.scope}:${d.markdown}`)
    expect(team).toEqual([
      'brand:workspace:# Workspace brand',
      'grid:instance:# Instance grid',
      'voice:canvas:# Canvas voice',
    ])
  })

  it('never lets a nearer scope shadow an organisation rule', () => {
    actions.setScopedGuideline('instance', INSTANCE, 'alt-text', '# Alt', actor, undefined, 'instructions')
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone', actor, undefined, 'instructions')
    /* refused on write, from every path that writes a canvas doc */
    expect(() => actions.setGuideline('team', 'alt-text', '# Mine', actor)).toThrow(/organisation rule/)
    expect(() => actions.setGuideline('team', 'tone', '# Mine', actor)).toThrow(/organisation rule/)
    expect(() => actions.setScopedGuideline('workspace', 'ws1', 'alt-text', '# Mine', actor)).toThrow(/instance rule/)
    /* a canvas outside the workspace may use the workspace rule's name */
    expect(actions.setGuideline('other', 'tone', '# Other tone', actor)?.name).toBe('tone')
    /* and a doc that predates the rule cannot shadow it in the merge */
    store.setGuideline('team', 'alt-text', '# Legacy', 'Ada')
    expect(actions.effectiveGuidelines('team', true).find((d) => d.name === 'alt-text')).toMatchObject({
      scope: 'instance',
      markdown: '# Alt',
    })
  })

  it('keeps the workspace’s docs from readers without durable access, and from personal canvases', () => {
    actions.setScopedGuideline('instance', INSTANCE, 'brand', '# Instance brand', actor)
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Workspace tone', actor)
    actions.setGuideline('team', 'layout', '# Layout', actor)
    expect(names(actions.effectiveGuidelines('team', true))).toEqual([
      'brand:instance',
      'layout:canvas',
      'tone:workspace',
    ])
    expect(names(actions.effectiveGuidelines('team', false))).toEqual(['brand:instance', 'layout:canvas'])
    expect(names(actions.effectiveGuidelines('solo', true))).toEqual(['brand:instance'])
  })

  it('defaults a new doc to style and keeps the kind when an update omits it', () => {
    const created = actions.setScopedGuideline('workspace', 'ws1', 'rules', '# Rules', actor, undefined, 'instructions')
    expect(created?.kind).toBe('instructions')
    expect(actions.setScopedGuideline('workspace', 'ws1', 'rules', '# Rules v2', actor)?.kind).toBe('instructions')
    expect(actions.setGuideline('team', 'look', '# Look', actor)?.kind).toBe('style')
  })

  it('tracks read inherited docs per agent across canvases, canvas docs per canvas', () => {
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone', actor)
    actions.setGuideline('team', 'look', '# Look', actor)
    actions.setGuideline('team2', 'look', '# Look 2', actor)
    actions.markGuidelinesSeen('team', 'u1/Claude', true)
    expect(actions.unreadGuidelines('team', 'u1/Claude', true)).toEqual([])
    /* the workspace doc was read on team; team2's own doc was not */
    expect(names(actions.unreadGuidelines('team2', 'u1/Claude', true))).toEqual(['look:canvas'])
    /* another agent has read nothing */
    expect(actions.unreadGuidelines('team', 'u2/Claude', true)).toHaveLength(2)
    /* a doc that appears later is unread */
    actions.setScopedGuideline('workspace', 'ws1', 'spacing', '# Spacing', actor)
    expect(names(actions.unreadGuidelines('team', 'u1/Claude', true))).toEqual(['spacing:workspace'])
  })

  it('leaves the instance’s rules out of the unread set — get_guide delivers them', () => {
    actions.setScopedGuideline('instance', INSTANCE, 'alt-text', '# Alt', actor, undefined, 'instructions')
    actions.setScopedGuideline('instance', INSTANCE, 'brand', '# Brand', actor)
    expect(names(actions.unreadGuidelines('team', 'u1/Claude', true))).toEqual(['brand:instance'])
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

describe('organisation rules around the canvas', () => {
  it('gives a resident run the workspace’s docs whoever asked for it', () => {
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone\n\nWarm.', actor, undefined, 'instructions')
    actions.setScopedGuideline('workspace', 'ws1', 'brand', '# Brand\n\nInk blue.', actor)
    actions.setGuideline('team', 'handoff', '# Handoff\n\nPing Sam.', actor, undefined, undefined, 'instructions')
    const [block] = guidelineBlocks('team')
    expect(block?.text).toContain('Ink blue.')
    expect(block?.text).toContain("## Your organisation's rules")
    expect(block?.text).toContain('(tone, workspace "ws1" scope)')
    /* the canvas's own instructions come last, as notes */
    expect(block!.text.indexOf('## Notes left on this canvas by its editors')).toBeGreaterThan(
      block!.text.indexOf('Warm.'),
    )
    expect(guidelineBlocks('other')[0]?.text ?? '').not.toContain('Warm.')
  })

  it('refuses to accept a proposal into a rule’s name, leaving it pending', () => {
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone', actor, undefined, 'instructions')
    const proposal = actions.addProposal('team', {
      guideName: 'tone',
      rule: '- Be terse.',
      rationale: 'test',
      basedOn: [],
    })
    expect(() => actions.resolveProposal('team', proposal.id, true, actor)).toThrow(actions.ReservedGuidelineName)
    expect(actions.getProposals('team').find((p) => p.id === proposal.id)?.status).toBe('pending')
  })

  it('names a workspace rule only to callers with durable access', () => {
    actions.setScopedGuideline('workspace', 'ws1', 'tone', '# Tone', actor, undefined, 'instructions')
    actions.setScopedGuideline('instance', INSTANCE, 'alt-text', '# Alt', actor, undefined, 'instructions')
    const caught = (name: string) => {
      try {
        actions.setGuideline('team', name, '# Mine', actor)
      } catch (e) {
        return e
      }
    }
    expect(actions.guidelineErrorFor(caught('tone'), true)).toContain('organisation rule')
    const generic = actions.guidelineErrorFor(caught('tone'), false)
    expect(generic).toContain('cannot be used for a doc on this canvas')
    expect(generic).not.toContain('organisation')
    /* the instance's rules are every account's to see */
    expect(actions.guidelineErrorFor(caught('alt-text'), false)).toContain('organisation rule')
  })

  it('lists the canvases whose doc a rule hides', () => {
    store.setGuideline('team', 'legacy', '# Old', 'Ada')
    store.setGuideline('other', 'legacy', '# Old', 'Ada')
    expect(actions.shadowedCanvasDocs('workspace', 'ws1', 'legacy')).toEqual([{ id: 'team', name: 'team' }])
    expect(actions.shadowedCanvasDocs('instance', INSTANCE, 'legacy').map((c) => c.id)).toEqual(['team', 'other'])
  })
})

describe('rule rendering', () => {
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
    expect(workspaceRules('Acme', [doc('brand', 'Blue.')])).toBe('')
    expect(canvasNotes([])).toBe('')
  })

  it('says where a workspace’s rules apply, and keeps canvas notes apart from the organisation’s', () => {
    expect(workspaceRules('Acme', [doc('tone', 'Warm.', 'instructions')])).toContain(
      'These apply on canvases of workspace "Acme"',
    )
    const notes = canvasNotes([doc('handoff', 'Ping Sam.', 'instructions')])
    expect(notes).toContain('## Notes left on this canvas by its editors')
    expect(notes).not.toContain("organisation's rules\n")
    expect(notes).toContain('Ping Sam.')
  })
})
