import { Outlet, useLocation } from 'react-router-dom'
import { BottomTabBar } from '../../components/BottomTabBar'
import { BadgeCelebration } from '../../components/Badges'

export function HomeShell() {
  const { pathname } = useLocation()
  return (
    <div className="screen screen-nav">
      {/* key forces remount on route change, triggering page-enter animation */}
      <div key={pathname} className="page-enter">
        <Outlet />
      </div>
      <BottomTabBar />
      {/* Held back while logging; the Logged! screen shows its own */}
      <BadgeCelebration paused={pathname === '/home/log'} />
    </div>
  )
}
