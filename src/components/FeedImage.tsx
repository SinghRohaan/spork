import { useState } from 'react'

interface FeedImageProps {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  /** Near the top of the screen: load straight away, ahead of other images. */
  priority?: boolean
}

/**
 * FeedImage — a lazy-loaded photo shown at its real aspect ratio (no cropping):
 * 1. Reserves a 4:3 shimmer box until the image has loaded
 * 2. Then renders the image at natural height (capped by `.photo.natural`)
 */
export function FeedImage({ src, alt, className = '', style, onClick, priority = false }: FeedImageProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative" style={style}>
      {!loaded && <div className={`skeleton ${className}`} style={{ aspectRatio: '4 / 3', height: 'auto' }} aria-hidden="true" />}
      <img
        src={src}
        alt={alt}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        className={`${className} natural transition-opacity duration-300 ${loaded ? 'opacity-100' : 'absolute inset-0 opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onClick={onClick}
        style={onClick ? { cursor: 'zoom-in' } : undefined}
      />
    </div>
  )
}
