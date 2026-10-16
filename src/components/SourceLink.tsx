import { useEffect, useState } from 'react'

/**
 * The AGPL §13 source offer: a deployment that sets DOOP_SOURCE_URL gets a
 * small "Source code" link in the bottom-right corner of every page, signed
 * in or out. Unset (the default), nothing renders. The URL comes from the
 * public /api/oidc-config, the one config endpoint the signed-out app reads.
 */
export function SourceLink() {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/oidc-config')
      .then((res) => (res.ok ? res.json() : {}))
      .then((config: { sourceUrl?: string }) => setUrl(config.sourceUrl ?? null))
      .catch(() => {}) // no offer to show; nothing else depends on it
  }, [])
  if (!url) return null
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
