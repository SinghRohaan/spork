import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { enableShareLink, shareUrl } from '../lib/shareLink'
import { mealCards, type MealShareData } from '../lib/shareCards'
import { useToast } from './Toast'

export interface ShareCardSpec {
  label: string
  render: () => Promise<Blob>
  transparent?: boolean
}

interface ShareSheetProps {
  cards: ShareCardSpec[]
  /** File name without extension. */
  fileName: string
  /** Message sent with the image (and the link, when there is one). */
  message: string
  link?: string | null
  /** Runs before the link leaves the phone (turns a post's public link on). False = don't send it. */
  prepareLink?: () => Promise<boolean>
  note: ReactNode
  onClose: () => void
}

type Rendered = { url: string; blob: Blob } | 'error' | undefined

const CAPTURE_TIMEOUT_MS = 12_000
const withTimeout = <T,>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out preparing the image')), CAPTURE_TIMEOUT_MS))])

/** Hevy-style share sheet: swipe between square cards, then share the one showing. */
export function ShareSheet({ cards, fileName, message, link = null, prepareLink, note, onClose }: ShareSheetProps) {
  const { toast } = useToast()
  const [images, setImages] = useState<Rendered[]>([])
  const [index, setIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const urls = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    cards.forEach((card, i) => {
      withTimeout(card.render())
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          urls.current.push(url)
          if (alive) setImages((prev) => { const next = [...prev]; next[i] = { url, blob }; return next })
        })
        .catch((e) => {
          console.error('Share card failed', e)
          if (alive) setImages((prev) => { const next = [...prev]; next[i] = 'error'; return next })
        })
    })
    return () => { alive = false }
    // Cards are built once per open; `attempt` re-runs them after "Try again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const current = images[index]
  const ready = current && current !== 'error' ? current : null
  const file = ready ? new File([ready.blob], `${fileName}.png`, { type: 'image/png' }) : null
  let canShareFile = false
  try { canShareFile = Boolean(file && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) } catch { /* not supported */ }

  async function withLink(): Promise<boolean> {
    if (!link) return false
    if (!prepareLink) return true
    return prepareLink()
  }

  async function handleShare() {
    if (!file) return
    const linked = await withLink()
    try {
      // The link goes in the text: some apps drop the `url` field when an image is attached.
      await navigator.share({ text: linked ? `${message} ${link}` : message, files: [file] })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error(err)
    }
  }

  async function handleWhatsApp() {
    const linked = await withLink()
    window.open(`https://wa.me/?text=${encodeURIComponent(linked ? `${message} ${link}` : message)}`, '_blank', 'noopener')
  }

  function handleSave() {
    if (!ready) return
    const a = document.createElement('a')
    a.href = ready.url
    a.download = `${fileName}.png`
    a.click()
  }

  async function handleCopyLink() {
    if (!link || !(await withLink())) return
    try {
      await navigator.clipboard.writeText(link)
      toast('Link copied ✓')
    } catch {
      toast('Couldn’t copy — long-press to copy instead', 'error')
    }
  }

  // Portal to <body> so an animated (transformed) ancestor can't trap the fixed overlay
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-end bg-black/70 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="share-sheet animate-slide-up">
        <div className="topbar" style={{ marginBottom: 12 }}>
          <span style={{ width: 42 }} />
          <span className="clay">Share</span>
          <button type="button" onClick={onClose} className="circle" aria-label="Close">✕</button>
        </div>

        {/* The previews are the actual PNGs we share — what you see is what you get */}
        <div className="share-cards" onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
          {cards.map((card, i) => {
            const img = images[i]
            return (
              <div key={card.label} className={`share-card ${card.transparent ? 'see-through' : ''}`} aria-label={card.label}>
                {img === 'error'
                  ? <div className="grid h-full place-items-center text-center"><span className="small muted">Couldn’t draw this card<br /><button type="button" className="pill" style={{ marginTop: 8 }} onClick={() => { setImages([]); setAttempt((a) => a + 1) }}>Try again</button></span></div>
                  : img ? <img src={img.url} alt={`${card.label} card`} /> : <div className="skeleton h-full w-full !rounded-none" />}
              </div>
            )
          })}
        </div>
        {cards.length > 1 && <div className="slide-dots" aria-hidden="true">{cards.map((c, i) => <i key={c.label} className={i === index ? 'on' : ''} />)}</div>}
        <p className="small muted text-center" style={{ margin: '12px 0 4px' }}>{cards[index]?.label} · {note}</p>

        <div className="share-actions">
          {canShareFile && <button type="button" onClick={handleShare} disabled={!ready}><span className="share-icon ink">↗</span>Share</button>}
          {link && <button type="button" onClick={handleWhatsApp}><span className="share-icon whatsapp">✆</span>WhatsApp</button>}
          <button type="button" onClick={handleSave} disabled={!ready}><span className="share-icon">⤓</span>Save</button>
          {link && <button type="button" onClick={handleCopyLink}><span className="share-icon">⛓</span>Copy link</button>}
        </div>
        {canShareFile && <p className="tiny muted text-center" style={{ marginTop: 8 }}>Share sends the image to Instagram, WhatsApp and more</p>}

        <button type="button" onClick={onClose} className="btn" style={{ marginTop: 14 }}>Done</button>
      </div>
    </div>,
    document.body,
  )
}

interface MealShareProps {
  meal: MealShareData
  /** Set only for the viewer's own posts — adds a public spork.fit/p/… link. */
  shareLogId?: string
  /** Private posts never get a public link. */
  isPrivate?: boolean
  onClose: () => void
}

/** Share a meal: photo, items, macro ring and sticker cards. */
export function ShareModal({ meal, shareLogId, isPrivate = false, onClose }: MealShareProps) {
  const { toast } = useToast()
  const [cards] = useState(() => mealCards(meal))
  const link = shareLogId && !isPrivate ? shareUrl(shareLogId) : null

  async function prepareLink(): Promise<boolean> {
    if (!shareLogId) return false
    try {
      await enableShareLink(shareLogId)
      return true
    } catch {
      toast('Couldn’t create the link — check your connection', 'error')
      return false
    }
  }

  return (
    <ShareSheet
      cards={cards}
      fileName={`spork-${meal.username}-meal`}
      message={link ? 'Check out my meal on Spork!' : 'Check out my meal 🍴'}
      link={link}
      prepareLink={prepareLink}
      note={link ? 'anyone with the link can see this post' : shareLogId && isPrivate ? 'private posts share as an image only' : <>tag <b>@sporkapp</b></>}
      onClose={onClose}
    />
  )
}
