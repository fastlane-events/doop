import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GuidelineDoc, GuidelineKind } from '../../shared/types'
import type { GuidelineVersion } from '../lib/api'
import { timeAgo } from '../lib/time'
import { Sel } from './AutomateShell'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { ListHint, ListMeta, ListRow, ListSection, ListSummary, ListTitle } from './ui/list'
import { MarkdownBlock, Modal, ModalActions, ModalLede, ModalSpacer, ModalTitle } from './ui/modal'
import { ConfirmDialog } from './ui/alert-dialog'

const MAX_GUIDELINE_CHARS = 24_000
const MAX_TITLE_CHARS = 80

/* Timestamp/author line under a modal heading. */
const meta = 'mt-1.5 text-[11.5px] text-ink-faint'
const errorText = 'mt-2.5 text-[13px] text-accent-ink'
const modalHead = 'flex flex-wrap items-baseline gap-2.5'

const KIND_LABELS: Record<GuidelineKind, string> = { style: 'Style guide', instructions: 'Agent instructions' }

/** Pretty display name: explicit title, else the prettified slug. */
export function guideTitle(doc: Pick<GuidelineDoc, 'name' | 'title'>): string {
  return doc.title ?? doc.name.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export function summarize(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line) return line.length > 90 ? line.slice(0, 87) + '…' : line
  }
  return ''
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Where a set of guides is read and written: a canvas, a workspace, or the
 *  install. Saving empty markdown deletes the guide. */
export interface GuideSource {
  history(name: string): Promise<GuidelineVersion[]>
  save(name: string, markdown: string, title?: string, kind?: GuidelineKind): Promise<unknown>
}

type Mode = 'read' | 'edit' | 'history'

/** One design guide in a modal: read, edit (title, kind + markdown), version
 *  history with restore, delete. creating opens in create mode; no source
 *  makes it read-only, with `badge` naming where the guide comes from. */
export function GuideModal({
  doc,
  creating,
  source,
  badge,
  onClose,
}: {
  doc: GuidelineDoc | null
  creating: boolean
  source: GuideSource | null
  badge?: string
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('read')
  const [titleDraft, setTitleDraft] = useState('')
  const [kindDraft, setKindDraft] = useState<GuidelineKind>('style')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save(slug: string, markdown: string, title?: string, kind?: GuidelineKind) {
    if (busy || !source) return
    setBusy(true)
    setError(null)
    try {
      await source.save(slug, markdown, title, kind)
      if (markdown.trim() && !creating) setMode('read')
      else onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+\s*/, '') : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const editing = !!source && (creating || mode === 'edit')

  return (
    <Modal size="xl" onClose={() => !busy && onClose()}>
      <>
        {editing ? (
          <>
            <ModalTitle className="sr-only">{creating ? 'New rule' : 'Edit rule'}</ModalTitle>
            <Input
              inputSize="lg"
              className="rounded-[10px] bg-paper font-display font-extrabold focus:ring-0 md:text-[19px]"
              autoFocus={creating}
              placeholder="Name, e.g. “Featured Images”"
              value={titleDraft}
              maxLength={MAX_TITLE_CHARS}
              disabled={busy}
              onChange={(e) => setTitleDraft(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <div className={meta}>id: {creating ? slugify(titleDraft) || '…' : doc?.name}</div>
              <ModalSpacer />
              <Sel
                className="mt-1.5"
                value={kindDraft}
                disabled={busy}
                onChange={(e) => setKindDraft(e.target.value as GuidelineKind)}
                aria-label="Kind"
              >
                <option value="style">{KIND_LABELS.style} — how frames look</option>
                <option value="instructions">{KIND_LABELS.instructions} — how agents work</option>
              </Sel>
            </div>
            <Textarea
              className="mt-3 min-h-[38dvh] resize-y rounded-[12px] bg-surface px-4 py-3.5 font-mono leading-[1.65] focus:ring-0 sm:min-h-[46vh] md:text-[12.5px]"
              autoFocus={!creating}
              placeholder={'# Rules\n\nPalette, fonts, layout recipes, asset URLs…'}
              value={draft}
              maxLength={MAX_GUIDELINE_CHARS}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            {error && <p className={errorText}>{error}</p>}
            <ModalActions className="items-center">
              <span className={meta}>
                {draft.length.toLocaleString()} / {MAX_GUIDELINE_CHARS.toLocaleString()}
              </span>
              <ModalSpacer />
              <Button variant="ghost" disabled={busy} onClick={() => (creating ? onClose() : setMode('read'))}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || !draft.trim() || (creating && !slugify(titleDraft))}
                onClick={() =>
                  creating
                    ? save(slugify(titleDraft), draft, titleDraft.trim(), kindDraft)
                    : save(doc!.name, draft, titleDraft.trim() || undefined, kindDraft)
                }
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </ModalActions>
          </>
        ) : !doc ? (
          /* deleted while open (possibly by someone else) */
          <>
            <ModalTitle className="sr-only">Rule</ModalTitle>
            <ModalLede>This design guide no longer exists.</ModalLede>
            <ModalActions>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </ModalActions>
          </>
        ) : mode === 'history' && source ? (
          <GuideHistory
            source={source}
            doc={doc}
            busy={busy}
            onRestore={(markdown) => save(doc.name, markdown)}
            onBack={() => setMode('read')}
          />
        ) : (
          <>
            <div className={modalHead}>
              <ModalTitle>{guideTitle(doc)}</ModalTitle>
              <Badge tone="outline" className="rounded-full px-2 py-px">
                {doc.name}
              </Badge>
              {doc.kind === 'instructions' && (
                <Badge className="rounded-full px-2 py-px">{KIND_LABELS.instructions}</Badge>
              )}
              {badge && (
                <Badge tone="accent" className="rounded-full px-2 py-px">
                  {badge}
                </Badge>
              )}
            </div>
            <div className={meta}>
              edited by {doc.updatedBy} · {new Date(doc.updatedAt).toLocaleString()}
              {!source && badge ? ` — inherited from the ${badge.toLowerCase()}; only its admins can change it` : ''}
            </div>
            <MarkdownBlock>{doc.markdown}</MarkdownBlock>
            {error && <p className={errorText}>{error}</p>}
            <ModalActions>
              {source && (
                <>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                  <ConfirmDialog
                    open={confirmDelete}
                    onOpenChange={setConfirmDelete}
                    title={`Delete “${guideTitle(doc)}”?`}
                    description="Agents stop designing with this rule from their next task. Its version history is kept, so you can restore it later."
                    confirmLabel="Delete guide"
                    destructive
                    onConfirm={() => save(doc.name, '')}
                  />
                </>
              )}
              <ModalSpacer />
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Close
              </Button>
              {source && (
                <>
                  <Button variant="ghost" disabled={busy} onClick={() => setMode('history')}>
                    History
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      setTitleDraft(guideTitle(doc))
                      setKindDraft(doc.kind)
                      setDraft(doc.markdown)
                      setError(null)
                      setMode('edit')
                    }}
                  >
                    Edit
                  </Button>
                </>
              )}
            </ModalActions>
          </>
        )}
      </>
    </Modal>
  )
}

function GuideHistory({
  source,
  doc,
  busy,
  onRestore,
  onBack,
}: {
  source: GuideSource
  doc: GuidelineDoc
  busy: boolean
  onRestore: (markdown: string) => void
  onBack: () => void
}) {
  const [versions, setVersions] = useState<GuidelineVersion[] | null>(null)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    source
      .history(doc.name)
      .then((h) => alive && setVersions(h))
      .catch((e) => alive && setError(e instanceof Error ? e.message.replace(/^\d+\s*/, '') : 'could not load history'))
    return () => {
      alive = false
    }
  }, [source, doc.name])

  const preview = previewIdx !== null ? versions?.[previewIdx] : undefined

  return (
    <>
      <div className={modalHead}>
        <ModalTitle>{guideTitle(doc)} — history</ModalTitle>
      </div>
      {error && <p className={errorText}>{error}</p>}
      {preview ? (
        <>
          <div className={meta}>
            {preview.markdown ? 'saved' : 'deleted'} by {preview.savedBy} · {new Date(preview.savedAt).toLocaleString()}
          </div>
          {preview.markdown ? (
            <MarkdownBlock>{preview.markdown}</MarkdownBlock>
          ) : (
            <ModalLede>This version marks a deletion — there is nothing to show.</ModalLede>
          )}
          <ModalActions>
            <Button variant="ghost" disabled={busy} onClick={() => setPreviewIdx(null)}>
              Back
            </Button>
            <ModalSpacer />
            <Button
              variant="primary"
              disabled={busy || !preview.markdown || preview.markdown === doc.markdown}
              onClick={() => onRestore(preview.markdown)}
            >
              {busy ? 'Restoring…' : 'Restore this version'}
            </Button>
          </ModalActions>
        </>
      ) : (
        <>
          <div className="mt-3.5 overflow-hidden rounded-[12px] border border-line bg-surface">
            {versions?.length === 0 && <ModalLede>No versions recorded yet.</ModalLede>}
            {(versions ?? []).map((v, i) => (
              <ListRow
                key={v.savedAt + v.savedBy}
                className="border-b-0 border-t border-line-soft first:border-t-0"
                onClick={() => setPreviewIdx(i)}
              >
                <ListTitle>
                  {v.markdown === ''
                    ? 'deleted'
                    : v.markdown === doc.markdown
                      ? 'current'
                      : `v${(versions?.length ?? 0) - i}`}
                </ListTitle>
                <ListSummary>{v.markdown ? summarize(v.markdown) : '—'}</ListSummary>
                <ListMeta>
                  {v.savedBy} · {new Date(v.savedAt).toLocaleString()}
                </ListMeta>
              </ListRow>
            ))}
          </div>
          <ModalActions>
            <Button variant="ghost" disabled={busy} onClick={onBack}>
              Back
            </Button>
          </ModalActions>
        </>
      )}
    </>
  )
}

/** The rows of a guide list: title, a one-line summary, who edited it last.
 *  `badge` marks a row's origin (an inherited scope) or its kind. */
export function GuideRow({ doc, badge, onOpen }: { doc: GuidelineDoc; badge?: string; onOpen: () => void }) {
  return (
    <ListRow onClick={onOpen}>
      <ListTitle>
        {guideTitle(doc)}
        {badge && (
          <Badge tone="accent" className="ml-1.5 rounded-full px-1.5 py-0 text-[10px]">
            {badge}
          </Badge>
        )}
        {doc.kind === 'instructions' && (
          <Badge className="ml-1.5 rounded-full px-1.5 py-0 text-[10px]">{KIND_LABELS.instructions}</Badge>
        )}
      </ListTitle>
      <ListSummary>{summarize(doc.markdown)}</ListSummary>
      <ListMeta>
        {doc.updatedBy} · {timeAgo(doc.updatedAt)}
      </ListMeta>
    </ListRow>
  )
}

/** A whole scope's guides — a workspace's or the install's — for the settings
 *  pages: the list, a "+ New" for those who may write, and the modal. */
export function GuideList({
  docs,
  source,
  hint,
}: {
  docs: GuidelineDoc[]
  /** null = read-only */
  source: GuideSource | null
  hint: string
}) {
  /** slug of the open guide, '' = create a new one, null = closed */
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex flex-col">
      <ListSection>
        <span>Rules</span>
        {source && (
          <Button variant="solid" size="sm" className="flex-none text-[11.5px] font-bold" onClick={() => setOpen('')}>
            + New
          </Button>
        )}
      </ListSection>
      {docs.length === 0 && <ListHint>{hint}</ListHint>}
      {docs.map((d) => (
        <GuideRow key={d.name} doc={d} onOpen={() => setOpen(d.name)} />
      ))}
      {open !== null && (
        <GuideModal
          doc={docs.find((d) => d.name === open) ?? null}
          creating={open === ''}
          source={source}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/** Reads and writes one scope's guides over REST. */
export interface ScopeGuidesApi extends GuideSource {
  list(): Promise<GuidelineDoc[]>
}

/** A workspace's or the install's guides, loaded from `scopeApi` and
 *  reloaded after every save. Pass a stable (memoized) `scopeApi`. */
export function ScopedGuides({
  scopeApi,
  canEdit,
  hint,
}: {
  scopeApi: ScopeGuidesApi
  canEdit: boolean
  hint: string
}) {
  const [docs, setDocs] = useState<GuidelineDoc[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(
    () =>
      scopeApi
        .list()
        .then(setDocs)
        .catch((e) => setError(e instanceof Error ? e.message.replace(/^\d+\s*/, '') : 'could not load the rules')),
    [scopeApi],
  )
  useEffect(() => {
    void reload()
  }, [reload])
  const source = useMemo<GuideSource | null>(
    () =>
      canEdit
        ? {
            history: (name) => scopeApi.history(name),
            save: async (name, markdown, title, kind) => {
              await scopeApi.save(name, markdown, title, kind)
              await reload()
            },
          }
        : null,
    [canEdit, scopeApi, reload],
  )
  if (error) return <p className={errorText}>{error}</p>
  if (!docs) return <ListHint>…</ListHint>
  return <GuideList docs={docs} source={source} hint={hint} />
}
