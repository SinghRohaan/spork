// Deno runtime — deploy as the "meal-photos" Edge Function.
//
// Meal photos move from Supabase Storage to Cloudflare R2 (10 GB free,
// zero egress). Where a photo lives is recorded in logs.photo_url itself:
//
//   "<user>/<log>.jpg"      → still in Supabase Storage (legacy, app signs it directly)
//   "r2/<user>/<log>.jpg"   → in R2 under key "<user>/<log>.jpg" (signed by this function)
//
// A row only flips to "r2/…" after its file is verified in R2, so every
// photo is readable at every moment of the migration.
//
// The R2 bucket is private and its keys never leave this function.
//
//   sign     JSON { action, paths }             → { urls: { [path]: url } }  only photos the caller may see (RLS on logs)
//   upload   multipart { action, path, file }   → { path }                   caller's own folder, images ≤ 8 MB
//   delete   JSON { action, paths }             → { deleted }                caller's own photos only
//   migrate  JSON { action, secret, cursor? }   → copies legacy photos into R2, flips their rows
//   purge    JSON { action, secret, cursor? }   → empties Supabase's meal-photos bucket of files no longer needed
//
// Secrets (Edge Functions → Secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET. MIGRATE_SECRET only while migrating —
// delete it afterwards and migrate/purge are switched off.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are built in.

import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? ''
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? ''
const MIGRATE_SECRET = Deno.env.get('MIGRATE_SECRET') ?? ''

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
  // aws4fetch defaults to 10 retries with exponential backoff (~50 s) — far
  // too long inside a request. Two quick retries, then fail and report.
  retries: 2,
})

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const R2_PREFIX = 'r2/'
const LEGACY_BUCKET = 'meal-photos'
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const HALF_DAY_MS = 12 * 60 * 60 * 1000
// Short enough that the dashboard's Test window gets a reply before it gives up.
const TIME_BUDGET_MS = 40_000
/** "<user uuid>/<log uuid>.<ext>" — the only object keys the app ever writes. */
const PHOTO_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function objectUrl(key: string): URL {
  return new URL(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`)
}

/**
 * Signed GET URL. The signing time is rounded down to a 12-hour window so a
 * photo keeps the same URL all window long and phones serve it from cache.
 * Valid 24 h from the window start — at least 12 h after it's handed out.
 */
async function signGet(key: string): Promise<string> {
  const url = objectUrl(key)
  url.searchParams.set('X-Amz-Expires', String(24 * 60 * 60))
  const windowStart = new Date(Math.floor(Date.now() / HALF_DAY_MS) * HALF_DAY_MS)
  const datetime = windowStart.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const signed = await r2.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true, datetime } })
  return signed.url
}

/** Content type from the file's first bytes — never trust the client's label. */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await r2.fetch(objectUrl(key), {
    method: 'PUT',
    body: bytes,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=31536000, immutable' },
  })
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`)
}

/** Size of the object in R2, or null if it isn't there. */
async function r2Size(key: string): Promise<number | null> {
  const res = await r2.fetch(objectUrl(key), { method: 'HEAD' })
  if (!res.ok) return null
  return Number(res.headers.get('content-length') ?? '0')
}

const stringList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === 'string' && p.length < 200))].slice(0, max) : []

// ── One-off admin jobs ───────────────────────────────────────────────────────

/**
 * Copy each legacy photo into R2, verify it landed intact, then flip its row
 * to "r2/…". Resumable: pass back `cursor` until `done`. Safe to re-run —
 * already-flipped rows are skipped, and a failed row is left exactly as it was.
 */
async function migrate(cursor: string) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const started = Date.now()
  const result = { moved: 0, failed: [] as string[], cursor, done: false }

  while (Date.now() - started < TIME_BUDGET_MS) {
    let query = admin
      .from('logs').select('id, photo_url')
      .not('photo_url', 'is', null).not('photo_url', 'like', `${R2_PREFIX}%`)
    // ids are uuids — an empty cursor isn't one, so only filter once we have a real id.
    if (result.cursor) query = query.gt('id', result.cursor)
    const { data: rows, error } = await query.order('id').limit(20)
    if (error) throw error
    if (!rows?.length) { result.done = true; break }

    for (const row of rows as { id: string; photo_url: string }[]) {
      result.cursor = row.id
      const key = row.photo_url
      try {
        if (!PHOTO_KEY.test(key)) throw new Error('unexpected path format — left as is')
        const { data: blob, error: dlError } = await admin.storage.from(LEGACY_BUCKET).download(key)
        if (dlError || !blob) throw new Error(`download failed: ${dlError?.message ?? 'empty'}`)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await putObject(key, bytes, sniffImageType(bytes) || blob.type || 'image/jpeg')
        if ((await r2Size(key)) !== bytes.length) throw new Error('size check after copy failed')
        // Flip only if nobody changed the row meanwhile.
        const { error: upError } = await admin.from('logs')
          .update({ photo_url: `${R2_PREFIX}${key}` }).eq('id', row.id).eq('photo_url', key)
        if (upError) throw upError
        result.moved++
      } catch (err) {
        result.failed.push(`${row.id}: ${err instanceof Error ? err.message : 'error'}`)
      }
    }
  }
  return result
}

/**
 * Empty Supabase's meal-photos bucket, folder by folder. A file is deleted
 * only if no post still reads it from Supabase — i.e. its post has moved to
 * R2 (and R2 has the file), or the post was deleted long ago. Files still
 * used by a legacy row, or younger than a day, are kept.
 */
async function purge(cursor: string) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const started = Date.now()
  const result = { deleted: 0, kept: [] as string[], cursor, done: false }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000

  const { data: folders, error: folderError } = await admin.storage.from(LEGACY_BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (folderError) throw folderError
  const todo = (folders ?? []).map((f) => f.name).filter((name) => name > result.cursor)

  for (const folder of todo) {
    if (Date.now() - started > TIME_BUDGET_MS) return result
    // Read the whole folder first (deleting while paging would shift offsets).
    const allKeys: { key: string; created: number }[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data: files, error } = await admin.storage.from(LEGACY_BUCKET).list(folder, { limit: 1000, offset })
      if (error) throw error
      for (const f of files ?? []) if (f.id) allKeys.push({ key: `${folder}/${f.name}`, created: Date.parse(f.created_at ?? '') })
      if ((files?.length ?? 0) < 1000) break
    }

    // Small chunks keep the .in() lookups well under URL-length limits.
    for (let start = 0; start < allKeys.length; start += 50) {
      const keys = allKeys.slice(start, start + 50)

      const [{ data: legacyRows, error: legacyError }, { data: movedRows, error: movedError }] = await Promise.all([
        admin.from('logs').select('photo_url').in('photo_url', keys.map((k) => k.key)),
        admin.from('logs').select('photo_url').in('photo_url', keys.map((k) => `${R2_PREFIX}${k.key}`)),
      ])
      if (legacyError || movedError) throw legacyError ?? movedError
      const stillLegacy = new Set((legacyRows ?? []).map((r) => r.photo_url as string))
      const moved = new Set((movedRows ?? []).map((r) => (r.photo_url as string).slice(R2_PREFIX.length)))

      const toDelete: string[] = []
      for (const { key, created } of keys) {
        if (stillLegacy.has(key)) { result.kept.push(`${key} (post not moved yet — run migrate)`); continue }
        if (moved.has(key)) {
          if ((await r2Size(key)) === null) { result.kept.push(`${key} (post moved but file missing in R2 — kept)`); continue }
          toDelete.push(key)
          continue
        }
        // No post points at it: a deleted post's photo. Skip very new files — their post may be mid-save.
        if (created < dayAgo) toDelete.push(key)
        else result.kept.push(`${key} (uploaded < 1 day ago)`)
      }
      for (let i = 0; i < toDelete.length; i += 100) {
        const { error: rmError } = await admin.storage.from(LEGACY_BUCKET).remove(toDelete.slice(i, i + 100))
        if (rmError) throw rmError
      }
      result.deleted += toDelete.length
    }
    result.cursor = folder
  }
  result.done = true
  return result
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!R2_ACCOUNT_ID || !R2_BUCKET) return json({ error: 'Server misconfigured: R2 secrets missing' }, 500)

  try {
    const isMultipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
    const form = isMultipart ? await req.formData() : null
    const body: Record<string, unknown> = form ? {} : await req.json().catch(() => ({}))
    const action = form ? form.get('action') : body.action

    // Admin one-offs: gated by a temporary secret, not by a user session.
    if (action === 'migrate' || action === 'purge') {
      if (!MIGRATE_SECRET || body.secret !== MIGRATE_SECRET) return json({ error: 'Forbidden' }, 403)
      const cursor = typeof body.cursor === 'string' ? body.cursor : ''
      return json(action === 'migrate' ? await migrate(cursor) : await purge(cursor))
    }

    // Everything else acts as the signed-in user.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })

    // Signing needs no separate login lookup: the logs query below runs with
    // the caller's token, so the database itself checks it and applies RLS.
    if (action === 'sign') {
      const paths = stringList(body.paths, 60).filter((p) => p.startsWith(R2_PREFIX))
      if (paths.length === 0) return json({ urls: {} })
      // RLS on logs decides visibility — paths the caller may not see don't come back.
      const { data: rows, error } = await supabase.from('logs').select('photo_url').in('photo_url', paths)
      if (error) throw error
      const urls: Record<string, string> = {}
      for (const { photo_url } of (rows ?? []) as { photo_url: string }[]) {
        if (!urls[photo_url]) urls[photo_url] = await signGet(photo_url.slice(R2_PREFIX.length))
      }
      return json({ urls })
    }

    // Uploads and deletes act on the caller's own folder, so they need to know who that is.
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    if (action === 'upload') {
      const key = String(form?.get('path') ?? '')
      const file = form?.get('file')
      if (!PHOTO_KEY.test(key) || !key.startsWith(`${user.id}/`)) return json({ error: 'Invalid path' }, 400)
      if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) return json({ error: 'File missing or too large' }, 400)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const type = sniffImageType(bytes)
      if (!type) return json({ error: 'Not an image' }, 400)
      await putObject(key, bytes, type)
      return json({ path: `${R2_PREFIX}${key}` })
    }

    if (action === 'delete') {
      const keys = stringList(body.paths, 500)
        .filter((p) => p.startsWith(R2_PREFIX)).map((p) => p.slice(R2_PREFIX.length))
        .filter((k) => PHOTO_KEY.test(k) && k.startsWith(`${user.id}/`))
      let deleted = 0
      for (const key of keys) {
        const res = await r2.fetch(objectUrl(key), { method: 'DELETE' })
        if (res.ok || res.status === 404) deleted++
      }
      return json({ deleted })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('meal-photos error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
