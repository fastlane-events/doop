// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

/* The AGPL §13 source offer in the browser: a corner link on every page but
 * the canvas, whose panels and bottom sheet own that corner; there the
 * Connect AI dialog carries it instead. */

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), capture: vi.fn() }))
vi.mock('../src/App', () => ({ navigate: mocks.navigate }))
vi.mock('../src/lib/posthog', () => ({ posthog: { capture: mocks.capture } }))
vi.mock('../src/lib/store', () => ({
  useStore: (select: (s: { presences: Record<string, never> }) => unknown) => select({ presences: {} }),
}))
import { SourceLink } from '../src/components/SourceLink'
import { ConnectModal } from '../src/components/ConnectModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SOURCE = 'https://github.com/example/doop'
let root: Root
let container: HTMLDivElement

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ enabled: false, sourceUrl: SOURCE }), { status: 200 })),
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  history.replaceState(null, '', '/')
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(node))
}

const sourceLinks = () => Array.from(document.body.querySelectorAll('a')).filter((a) => a.textContent === 'Source code')

it('shows the corner link off the canvas and drops it on a canvas route', async () => {
  history.replaceState(null, '', '/')
  await mount(<SourceLink />)
  expect(sourceLinks().map((a) => a.getAttribute('href'))).toEqual([SOURCE])

  await act(async () => {
    history.pushState(null, '', '/c/abc')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(sourceLinks()).toHaveLength(0)
})

it('offers the source in the Connect AI dialog', async () => {
  history.replaceState(null, '', '/c/abc')
  await mount(<ConnectModal canvasId="abc" onClose={() => {}} />)
  const [link] = sourceLinks()
  expect(link?.getAttribute('href')).toBe(SOURCE)
  expect(link?.getAttribute('target')).toBe('_blank')
})
