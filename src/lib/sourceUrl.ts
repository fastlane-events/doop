import { useEffect, useState } from 'react'

/* One fetch per page load: the URL is server config and does not change. */
let pending: Promise<string | null> | null = null

/** DOOP_SOURCE_URL as the server reports it on the public /api/oidc-config —
 *  the one config endpoint the signed-out app reads too. null = unset. */
export function loadSourceUrl(): Promise<string | null> {
  pending ??= fetch('/api/oidc-config')
    .then((res) => (res.ok ? res.json() : {}))
    .then((config: { sourceUrl?: string }) => config.sourceUrl ?? null)
    .catch(() => null) // no offer to show; nothing else depends on it
  return pending
}

/** The AGPL §13 source offer's URL, or null while loading / when unset. */
export function useSourceUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void loadSourceUrl().then((next) => live && setUrl(next))
    return () => {
      live = false
    }
  }, [])
  return url
}
