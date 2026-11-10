import { useMemo, useState } from 'react'
import { mergeGuidelines } from '../../shared/types'
import type { InheritedScope, MemoryReference } from '../../shared/types'
import { canEditOpenCanvas, useStore } from '../lib/store'
import { api } from '../lib/api'
import { timeAgo } from '../lib/time'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { PanelBody } from './ui/panel'
import { ListHint, ListItem, ListMeta, ListRow, ListSection, ListTitle } from './ui/list'
import { Modal, ModalActions, ModalLede, ModalSpacer, ModalTitle } from './ui/modal'
import { DoopMark } from './Logo'
import { GuideModal, GuideRow, guideTitle, type GuideSource } from './GuideModal'
import { getLocale, useT } from '@/lib/i18n'

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
  /* view and comment links read Memory; they do not curate it */
  const readOnly = useStore((s) => !canEditOpenCanvas(s))
  /** slug of the open guide, '' = create a new one, null = closed */
  const [openGuide, setOpenGuide] = useState<string | null>(null)
  const [openRef, setOpenRef] = useState<string | null>(null)
  /** name of the open inherited (read-only) guide */
  const [openInherited, setOpenInherited] = useState<string | null>(null)
  const t = useT()

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
  /* a view or comment link reads the guides but gets no save or history */
  const source = useMemo<GuideSource | null>(
    () =>
      canvasId && !readOnly
        ? {
            history: (name) => api.guidelineHistory(canvasId, name),
            save: (name, markdown, title, kind) => api.setGuideline(canvasId, name, markdown, title, kind),
          }
        : null,
    [canvasId, readOnly],
  )

  if (!canvasId) return null

  const ownDocs = docs ?? []
  /* an organisation rule hides a canvas doc that shares its name (one that
     predates the rule — new ones are refused); it can still be deleted */
  const ruleNames = new Set(inherited.filter((d) => d.kind === 'instructions').map((d) => d.name))
  const inheritedOpen = inherited.find((d) => d.name === openInherited)
  const pending = readOnly ? [] : proposals.filter((p) => p.status === 'pending')
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
          <p className="text-[12.5px] leading-[1.5] font-semibold text-ink">{t('panels.memoryIntro')}</p>
          <ul className="mt-2.5 flex flex-col gap-2 pl-4">
            <li className="text-[12px] leading-[1.5] text-ink-soft">
              <b>{t('panels.memoryReferences')}</b> {t('panels.memoryIntroReferences')}
            </li>
            <li className="text-[12px] leading-[1.5] text-ink-soft">
              <b>{t('panels.memoryRules')}</b> {t('panels.memoryIntroRules')}
            </li>
            <li className="text-[12px] leading-[1.5] text-ink-soft">
              <b>{t('panels.memoryDecisions')}</b> {t('panels.memoryIntroDecisions')}
            </li>
          </ul>
        </div>
      )}

      {pending.map((p) => (
        <div key={p.id} className="mx-4 mt-3 rounded-[12px] border border-brand bg-surface px-3.5 py-3 shadow-card">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-accent-ink">
            <DoopMark size={11} /> {t('panels.memorySuggestion')}
          </div>
          <div className="mt-1.5 text-[13px] font-semibold leading-[1.45] text-ink">{p.rule.replace(/^-\s*/, '')}</div>
          <div className="mt-1.5 text-[11.5px] leading-[1.45] text-ink-faint">
            {p.rationale} · {t('panels.memoryFromDecisions', { count: p.basedOn.length })} → “
            {p.guideTitle ?? guideTitle({ name: p.guideName })}”
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-[11.5px]"
              onClick={() => api.resolveProposal(canvasId, p.id, false).catch(console.error)}
            >
              {t('panels.memoryDismiss')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="text-[11.5px]"
              onClick={() => api.resolveProposal(canvasId, p.id, true).catch(console.error)}
            >
              {t('panels.memoryAddToRules')}
            </Button>
          </div>
        </div>
      ))}

      <ListSection>
        <span>{t('panels.memoryReferences')}</span>
      </ListSection>
      {references.length === 0 ? (
        <ListHint>{t('panels.memoryNoReferences')}</ListHint>
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
        <span>{t('panels.memoryRules')}</span>
        {!readOnly && (
          <Button
            variant="solid"
            size="sm"
            className="flex-none text-[11.5px] font-bold"
            onClick={() => setOpenGuide('')}
          >
            {t('panels.memoryNew')}
          </Button>
        )}
      </ListSection>
      {ownDocs.length === 0 && inherited.length === 0 && <ListHint>{t('panels.memoryRulesHint')}</ListHint>}
      {ownDocs.map((d) => (
        <GuideRow
          key={d.name}
          doc={d}
          warning={ruleNames.has(d.name) ? 'Hidden by an organisation rule of the same name' : undefined}
          onOpen={() => setOpenGuide(d.name)}
        />
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
            <span>{t('panels.memoryDecisions')}</span>
          </ListSection>
          {decisions.slice(0, 20).map((d) => (
            <ListItem key={d.id} title={d.summary ? `${d.from}: “${d.text}”` : undefined}>
              <span className="text-[12.5px] leading-[1.45] text-ink">{d.summary ?? `“${d.text}”`}</span>
              <ListMeta>
                {d.from}
                {d.agentName ? ` → ${d.agentName}` : ''} · {timeAgo(d.at)}
                {d.distilledAt ? ` · ${t('panels.memoryDistilled')}` : ''}
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
  const readOnly = useStore((s) => !canEditOpenCanvas(s))
  const t = useT()
  if (!reference) {
    return (
      <Modal size="xl" onClose={onClose}>
        <ModalTitle className="sr-only">{t('panels.memoryReference')}</ModalTitle>
        <ModalLede>{t('panels.memoryReferenceGone')}</ModalLede>
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
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
          {t('panels.memoryPinnedBy', {
            name: reference.pinnedBy,
            date: new Date(reference.pinnedAt).toLocaleString(getLocale()),
          })}
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
          {!readOnly && (
            <Button
              variant="ghost"
              onClick={() => {
                api.unpinReference(canvasId, reference.id).catch(console.error)
                onClose()
              }}
            >
              {t('panels.memoryUnpin')}
            </Button>
          )}
          <ModalSpacer />
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </ModalActions>
      </>
    </Modal>
  )
}
