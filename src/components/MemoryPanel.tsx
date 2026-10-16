import { useMemo, useState } from 'react'
import { mergeGuidelines } from '../../shared/types'
import type { InheritedScope, MemoryReference } from '../../shared/types'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { timeAgo } from '../lib/time'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { PanelBody } from './ui/panel'
import { ListHint, ListItem, ListMeta, ListRow, ListSection, ListTitle } from './ui/list'
import { Modal, ModalActions, ModalLede, ModalSpacer, ModalTitle } from './ui/modal'
import { DoopMark } from './Logo'
import { GuideModal, GuideRow, guideTitle, type GuideSource } from './GuideModal'

/* Timestamp/author line under a modal heading. */
const meta = 'mt-1.5 text-[11.5px] text-ink-faint'
const modalHead = 'flex flex-wrap items-baseline gap-2.5'

const SCOPE_BADGES: Record<InheritedScope, string> = { workspace: 'Workspace', instance: 'Instance' }

/** The Memory tab in the side panel: the canvas's design brain. References
 *  (pinned exemplar frames), Rules (the style guides), Decisions (captured
 *  feedback) — plus pending distiller proposals to accept or dismiss. */
export function MemoryPanel() {
  const canvasId = useStore((s) => s.canvas?.id)
  const docs = useStore((s) => s.canvas?.guidelines)
  const inheritedDocs = useStore((s) => s.canvas?.inheritedGuidelines)
  const references = useStore((s) => s.canvas?.references ?? [])
  const decisions = useStore((s) => s.decisions)
  const proposals = useStore((s) => s.proposals)
  /** slug of the open guide, '' = create a new one, null = closed */
  const [openGuide, setOpenGuide] = useState<string | null>(null)
  const [openRef, setOpenRef] = useState<string | null>(null)
  /** name of the open inherited (read-only) guide */
  const [openInherited, setOpenInherited] = useState<string | null>(null)

  /* the workspace and instance docs this canvas follows: merged the way the
     server merges them — a style doc a canvas doc of the same name
     overrides drops out, an organisation rule (instructions) never does */
  const inherited = useMemo(() => {
    const own = new Set((docs ?? []).map((d) => d.name))
    const layers = inheritedDocs ?? []
    return mergeGuidelines([
      layers.filter((d) => d.scope === 'instance'),
      layers.filter((d) => d.scope === 'workspace'),
    ]).filter((d) => d.kind === 'instructions' || !own.has(d.name))
  }, [docs, inheritedDocs])
  const source = useMemo<GuideSource | null>(
    () =>
      canvasId
        ? {
            history: (name) => api.guidelineHistory(canvasId, name),
            save: (name, markdown, title, kind) => api.setGuideline(canvasId, name, markdown, title, kind),
          }
        : null,
    [canvasId],
  )

  if (!canvasId || !source) return null

  const ownDocs = docs ?? []
  const inheritedOpen = inherited.find((d) => d.name === openInherited)
  const pending = proposals.filter((p) => p.status === 'pending')
  const empty =
    ownDocs.length === 0 &&
    inherited.length === 0 &&
    references.length === 0 &&
    decisions.length === 0 &&
    pending.length === 0

  return (
    <PanelBody className="flex flex-col py-2">
      {empty && (
        <div className="border-b border-line-soft px-4 py-3.5">
          <p className="text-[12.5px] leading-[1.5] font-semibold text-ink">
            Memory is how this canvas remembers your taste — and how every agent designs with it.
          </p>
          <ul className="mt-2.5 flex flex-col gap-2 pl-4">
            <li className="text-[12px] leading-[1.5] text-ink-soft">
              <b>References</b> — pin a frame you love (the 🧠 on its corner). Agents copy its colors, type and layout
              when they design something new.
            </li>
            <li className="text-[12px] leading-[1.5] text-ink-soft">
              <b>Rules</b> — style guides agents read before designing. Write them, or let them grow.
            </li>
            <li className="text-[12px] leading-[1.5] text-ink-soft">
              <b>Decisions</b> — feedback you give agents is captured here automatically once it’s addressed. When a
              preference keeps recurring, Doop suggests adding it to your rules.
            </li>
          </ul>
        </div>
      )}

      {pending.map((p) => (
        <div key={p.id} className="mx-4 mt-3 rounded-[12px] border border-brand bg-surface px-3.5 py-3 shadow-card">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-accent-ink">
            <DoopMark size={11} /> Memory suggestion
          </div>
          <div className="mt-1.5 text-[13px] font-semibold leading-[1.45] text-ink">{p.rule.replace(/^-\s*/, '')}</div>
          <div className="mt-1.5 text-[11.5px] leading-[1.45] text-ink-faint">
            {p.rationale} · from {p.basedOn.length} decision{p.basedOn.length === 1 ? '' : 's'} → “
            {p.guideTitle ?? guideTitle({ name: p.guideName })}”
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-[11.5px]"
              onClick={() => api.resolveProposal(canvasId, p.id, false).catch(console.error)}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="text-[11.5px]"
              onClick={() => api.resolveProposal(canvasId, p.id, true).catch(console.error)}
            >
              Add to rules
            </Button>
          </div>
        </div>
      ))}

      <ListSection>
        <span>References</span>
      </ListSection>
      {references.length === 0 ? (
        <ListHint>
          No references yet. Pin a frame you like (the 🧠 on its corner) and agents will copy its colors, type and
          layout in new designs.
        </ListHint>
      ) : (
        references.map((r) => (
          <ListRow key={r.id} className="gap-1 py-2.5" onClick={() => setOpenRef(r.id)}>
            <RefThumb reference={r} />
            <ListTitle>{r.title}</ListTitle>
            <ListMeta>
              {r.pinnedBy} · {timeAgo(r.pinnedAt)}
            </ListMeta>
          </ListRow>
        ))
      )}

      <ListSection>
        <span>Rules</span>
        <Button
          variant="solid"
          size="sm"
          className="flex-none text-[11.5px] font-bold"
          onClick={() => setOpenGuide('')}
        >
          + New
        </Button>
      </ListSection>
      {ownDocs.length === 0 && inherited.length === 0 && (
        <ListHint>Style guides every agent reads before designing here.</ListHint>
      )}
      {ownDocs.map((d) => (
        <GuideRow key={d.name} doc={d} onOpen={() => setOpenGuide(d.name)} />
      ))}
      {inherited.map((d) => (
        <GuideRow
          key={`${d.scope}:${d.name}`}
          doc={d}
          badge={SCOPE_BADGES[d.scope as InheritedScope]}
          onOpen={() => setOpenInherited(d.name)}
        />
      ))}

      {decisions.length > 0 && (
        <>
          <ListSection>
            <span>Decisions</span>
          </ListSection>
          {decisions.slice(0, 20).map((d) => (
            <ListItem key={d.id} title={d.summary ? `${d.from}: “${d.text}”` : undefined}>
              <span className="text-[12.5px] leading-[1.45] text-ink">{d.summary ?? `“${d.text}”`}</span>
              <ListMeta>
                {d.from}
                {d.agentName ? ` → ${d.agentName}` : ''} · {timeAgo(d.at)}
                {d.distilledAt ? ' · distilled' : ''}
              </ListMeta>
            </ListItem>
          ))}
        </>
      )}

      {openGuide !== null && (
        <GuideModal
          doc={ownDocs.find((d) => d.name === openGuide) ?? null}
          creating={openGuide === ''}
          source={source}
          onClose={() => setOpenGuide(null)}
        />
      )}
      {openInherited !== null && (
        <GuideModal
          doc={inheritedOpen ?? null}
          creating={false}
          source={null}
          badge={inheritedOpen && SCOPE_BADGES[inheritedOpen.scope as InheritedScope]}
          onClose={() => setOpenInherited(null)}
        />
      )}
      {openRef !== null && (
        <RefModal
          canvasId={canvasId}
          reference={references.find((r) => r.id === openRef) ?? null}
          onClose={() => setOpenRef(null)}
        />
      )}
    </PanelBody>
  )
}

/** Live thumbnail of a pinned reference: its snapshotted HTML, scaled down. */
function RefThumb({ reference }: { reference: MemoryReference }) {
  const w = 264 // panel content width
  const scale = w / reference.width
  return (
    <span
      className="block w-full overflow-hidden rounded-[8px] border border-line bg-surface"
      style={{ height: Math.min(reference.height * scale, 150) }}
    >
      <iframe
        className="pointer-events-none origin-top-left border-0"
        title={reference.title}
        srcDoc={reference.html}
        sandbox=""
        tabIndex={-1}
        style={{ width: reference.width, height: reference.height, transform: `scale(${scale})` }}
      />
    </span>
  )
}

/** One pinned reference in a modal: full-size preview + unpin. */
function RefModal({
  canvasId,
  reference,
  onClose,
}: {
  canvasId: string
  reference: MemoryReference | null
  onClose: () => void
}) {
  if (!reference) {
    return (
      <Modal size="xl" onClose={onClose}>
        <ModalTitle className="sr-only">Reference</ModalTitle>
        <ModalLede>This reference is no longer pinned.</ModalLede>
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalActions>
      </Modal>
    )
  }
  const w = Math.min(696, window.innerWidth - 110)
  const scale = Math.min(1, w / reference.width)
  return (
    <Modal size="xl" onClose={onClose}>
      <>
        <div className={modalHead}>
          <ModalTitle>{reference.title}</ModalTitle>
          <Badge tone="outline" className="rounded-full px-2 py-px">
            {Math.round(reference.width)}×{Math.round(reference.height)}
          </Badge>
        </div>
        <div className={meta}>
          pinned by {reference.pinnedBy} · {new Date(reference.pinnedAt).toLocaleString()} — agents copy this design’s
          colors, type and layout in new work
        </div>
        <div
          className="mt-3.5 overflow-auto rounded-[12px] border border-line bg-surface"
          style={{ height: Math.min(reference.height * scale, window.innerHeight * 0.55) }}
        >
          <iframe
            className="pointer-events-none origin-top-left border-0"
            title={reference.title}
            srcDoc={reference.html}
            sandbox=""
            tabIndex={-1}
            style={{ width: reference.width, height: reference.height, transform: `scale(${scale})` }}
          />
        </div>
        <ModalActions>
          <Button
            variant="ghost"
            onClick={() => {
              api.unpinReference(canvasId, reference.id).catch(console.error)
              onClose()
            }}
          >
            Unpin
          </Button>
          <ModalSpacer />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalActions>
      </>
    </Modal>
  )
}
