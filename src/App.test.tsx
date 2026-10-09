import { Children, isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('./lib/supabase', () => ({ supabase: {} }))
import App from './App'

describe('home routes', () => {
  it('renders Feed at the /home/feed route inside HomeShell', () => {
    // App → page wrapper → Suspense (screens load lazily) → Routes
    const routes = App().props.children.props.children.props.children
    const home = Children.toArray(routes).find(
      route => isValidElement<{ path?: string }>(route) && route.props.path === '/home'
    )
    if (!isValidElement<{ children: React.ReactNode }>(home)) throw new Error('Missing home route')
    const children = Children.toArray(home.props.children).filter(
      isValidElement<{ path?: string; element: React.ReactElement }>
    )
    expect(children.some(route => route.props.path === 'feed')).toBe(true)
    expect(children.some(route => route.props.path === 'log')).toBe(true)
    expect(children.some(route => route.props.path === 'profile')).toBe(true)
  })
})
