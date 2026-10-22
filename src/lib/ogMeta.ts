/**
 * Link-preview tags for a shared post (spork.fit/p/<id>). WhatsApp, iMessage,
 * X and friends read these from the HTML without running the app, so the
 * server (api/share-page.ts) writes them into index.html for each post.
 */
import type { PublicPost } from './shareLink'

export interface OgMeta {
  title: string
  description: string
  url: string
  image: string
  /** True when `image` is the meal photo (large card) rather than the logo. */
  photo: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Title, macros line and image for one post; the plain Spork card when there's no post. */
export function postMeta(post: PublicPost | null, origin: string, path: string): OgMeta {
  const fallback = { title: 'Spork', description: 'Track meals, build streaks, share with friends.', url: origin + path, image: `${origin}/pwa-512x512.png`, photo: false }
  if (!post) return fallback
  const first = post.author.name.trim().split(/\s+/)[0] || post.author.username
  const meal = post.name?.trim() || cap(post.meal_type)
  const macros = [
    post.calories != null && `${Math.round(post.calories).toLocaleString('en-IN')} kcal`,
    post.protein_g != null && `${Math.round(post.protein_g)} g protein`,
    post.carbs_g != null && `${Math.round(post.carbs_g)} g carbs`,
    post.fat_g != null && `${Math.round(post.fat_g)} g fat`,
  ].filter(Boolean).join(' · ')
  return {
    title: `${first}’s ${post.meal_type} on Spork: ${meal}`,
    description: macros || (post.caption?.trim() ?? fallback.description),
    url: origin + path,
    image: post.photo_url ?? fallback.image,
    photo: Boolean(post.photo_url),
  }
}

/** Replaces the block between <!--og:start--> and <!--og:end--> in index.html (and the <title>). */
export function injectMeta(html: string, m: OgMeta): string {
  const tags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Spork" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(m.url)}" />`,
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta name="twitter:card" content="${m.photo ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(m.image)}" />`,
  ].join('\n    ')
  return html
    .replace(/<!--og:start-->[\s\S]*?<!--og:end-->/, `<!--og:start-->\n    ${tags}\n    <!--og:end-->`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(m.title)}</title>`)
}
