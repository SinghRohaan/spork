// Vercel Edge Function behind spork.fit/p/<id> (see vercel.json). Serves the
// normal app page, but with the shared meal's photo, title and macros in the
// link-preview tags, so WhatsApp / iMessage / X show the meal instead of the
// plain Spork logo. People who open the link get the usual app.
import { injectMeta, postMeta } from '../src/lib/ogMeta'
import type { PublicPost } from '../src/lib/shareLink'

export const config = { runtime: 'edge' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The same public data the share page shows: only posts their owner shared, never private ones. */
async function fetchPost(id: string): Promise<PublicPost | null> {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key || !UUID.test(id)) return null
  try {
    const res = await fetch(`${base}/functions/v1/public-post`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    return ((await res.json()) as { post?: PublicPost }).post ?? null
  } catch {
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  const [html, post] = await Promise.all([
    fetch(`${url.origin}/index.html`).then((r) => r.text()),
    fetchPost(id),
  ])
  return new Response(injectMeta(html, postMeta(post, url.origin, `/p/${id}`)), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short CDN cache: the photo link inside is signed for ~24 h.
      'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600',
    },
  })
}
