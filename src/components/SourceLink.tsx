import { useEffect, useState } from 'react'
import { useSourceUrl } from '../lib/sourceUrl'

/**
 * The AGPL §13 source offer: a deployment that sets DOOP_SOURCE_URL gets a
 * small "Source code" link in the bottom-right corner of every page, signed
 * in or out — except the canvas, whose panels and bottom sheet own that
 * corner; there the offer sits in the Connect AI dialog (ConnectModal),
 * reachable at every width. Unset (the default), nothing renders.
 */
export function SourceLink() {
  const url = useSourceUrl()
  const onCanvas = useOnCanvas()
  if (!url || onCanvas) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed right-2 bottom-[calc(4px+env(safe-area-inset-bottom))] z-[800] rounded-[6px] bg-paper/80 px-1.5 py-0.5 text-[10.5px] text-ink-faint opacity-70 backdrop-blur-[4px] hover:text-ink hover:opacity-100 print:hidden"
    >
      Source code
    </a>
  )
}

/** Whether the current route is a canvas (/c/<id>); follows navigate(). */
function useOnCanvas(): boolean {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path.startsWith('/c/')
}
