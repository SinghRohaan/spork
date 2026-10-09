import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, Heart, MessageCircle, Reply, type LucideIcon } from 'lucide-react'
import { useClearNotifications, useMarkNotificationsRead, useNotifications, type NotificationItem } from '../../hooks/useNotifications'
import { relativeTime } from '../../lib/relativeTime'
import { NotificationSkeleton } from '../../components/Skeleton'
import { TopBar } from '../../components/TopBar'
import { Avatar } from '../../components/Avatar'
import { useToast } from '../../components/Toast'

const TYPE_CONFIG: Record<NotificationItem['type'], { Icon: LucideIcon; verb: string }> = {
  like:    { Icon: Heart, verb: 'liked your meal' },
  comment: { Icon: MessageCircle, verb: 'commented on your meal' },
  reply:   { Icon: Reply, verb: 'replied on your meal' },
}

export default function NotificationsInbox() {
  const navigate = useNavigate()
  const { data: notifications, isLoading, isError } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const clearAll = useClearNotifications()
  const { toast } = useToast()
  const hasMarkedRead = useRef(false)

  useEffect(() => {
    if (hasMarkedRead.current) return
    hasMarkedRead.current = true
    markRead.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClearAll() {
    if (!window.confirm('Clear all notifications?')) return
    clearAll.mutate(undefined, { onError: () => toast('Couldn’t clear — try again', 'error') })
  }

  return (
    <div>
      <TopBar
        title="Notifications"
        back="/home/feed"
        right={notifications?.length ? (
          <button type="button" onClick={handleClearAll} disabled={clearAll.isPending} className="small muted font-semibold" style={{ minWidth: 42, textAlign: 'right' }}>
            Clear all
          </button>
        ) : undefined}
      />

      <div className="list" style={notifications?.length ? { gap: 0 } : undefined}>
        {/* Loading */}
        {isLoading && [1, 2, 3, 4].map((i) => <NotificationSkeleton key={i} />)}

        {/* Error */}
        {isError && (
          <div className="card tint text-center" style={{ margin: 0, padding: 40 }}>
            <div style={{ fontSize: 40, lineHeight: 1 }}>◌</div>
            <p className="small muted" style={{ marginTop: 8 }}>Couldn’t load notifications</p>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && (!notifications || notifications.length === 0) && (
          <div className="card tint text-center" style={{ margin: 0, padding: 40 }}>
            <BellOff size={36} className="mx-auto muted" aria-hidden="true" />
            <h4 style={{ marginTop: 12 }}>All clear</h4>
            <p className="small muted">When someone likes or comments on your meals, you’ll see it here</p>
          </div>
        )}

        {/* Notifications */}
        {notifications && notifications.map((n, i) => {
          const cfg = TYPE_CONFIG[n.type]
          const isUnread = !n.readAt
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => navigate(`/home/log/${n.logId}`)}
              className="notif-row no-press animate-slide-up"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <Avatar name={n.actor.name} photoUrl={n.actor.photo_url} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate"><b>@{n.actor.username}</b> {cfg.verb}</span>
                <small className="muted block truncate">{n.log.name ?? n.log.meal_type} · {relativeTime(n.createdAt)}</small>
              </span>
              <cfg.Icon size={18} className={n.type === 'like' ? 'notif-like' : 'muted'} fill={n.type === 'like' ? 'currentColor' : 'none'} aria-hidden="true" />
              <span className={`notif-dot ${isUnread ? '' : 'read'}`} aria-label={isUnread ? 'New' : undefined} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
