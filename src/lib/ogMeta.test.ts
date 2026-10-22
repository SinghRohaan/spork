import { describe, expect, it } from 'vitest'
import { injectMeta, postMeta } from './ogMeta'
import type { PublicPost } from './shareLink'
import html from '../../index.html?raw'

const post: PublicPost = {
  id: 'cb56f3d1-2e3c-4809-a042-fd83a21e5938', name: 'Chicken & rice "bowl"', caption: null, meal_type: 'lunch', created_at: '2026-10-22T07:00:00Z',
  calories: 612.4, protein_g: 45, carbs_g: 60, fat_g: 18, photo_url: 'https://acc.r2.cloudflarestorage.com/b/u/m.jpg?X-Amz-Expires=86400&X-Amz-Signature=abc',
  author: { username: 'rohaansingh', name: 'Rohaan Singh', photo_url: null },
}

describe('share link previews', () => {
  it('uses the meal photo, a readable title and the macros', () => {
    const m = postMeta(post, 'https://www.spork.fit', `/p/${post.id}`)
    expect(m).toMatchObject({ title: 'Rohaan’s lunch on Spork: Chicken & rice "bowl"', description: '612 kcal · 45 g protein · 60 g carbs · 18 g fat', photo: true })
  })
  it('writes escaped tags into index.html, replacing the defaults', () => {
    const out = injectMeta(html, postMeta(post, 'https://www.spork.fit', `/p/${post.id}`))
    expect(out).toContain('<meta property="og:image" content="https://acc.r2.cloudflarestorage.com/b/u/m.jpg?X-Amz-Expires=86400&amp;X-Amz-Signature=abc" />')
    expect(out).toContain('content="Rohaan’s lunch on Spork: Chicken &amp; rice &quot;bowl&quot;"')
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(out).toContain('<title>Rohaan’s lunch on Spork')
    expect(out.match(/property="og:image"/g)).toHaveLength(1)
    expect(out).toContain('<div id="root">') // still the normal app page
  })
  it('falls back to the plain Spork card for unshared, private or unknown posts', () => {
    const out = injectMeta(html, postMeta(null, 'https://spork-sooty.vercel.app', '/p/x'))
    expect(out).toContain('content="https://spork-sooty.vercel.app/pwa-512x512.png"')
    expect(out).toContain('<title>Spork</title>')
  })
})
