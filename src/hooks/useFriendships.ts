import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useSession } from './useSession'
import { PUBLIC_USER_COLUMNS, type PublicUser } from './useCurrentUser'

type UserRow = PublicUser

export interface FriendshipsData {
  accepted: UserRow[]
  incoming: { friendshipId: string; user: UserRow }[]
  outgoing: { friendshipId: string; user: UserRow }[]
}

/**
 * Fetches every friendship row RLS allows the caller to see (both
 * directions, any status), then batch-fetches the "other party" in each
 * row and classifies client-side into accepted / incoming-pending /
 * outgoing-pending. Two plain queries, no embedded selects — same
 * reasoning as useFeed and useFriendProfile.
 */
export function useFriendships() {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user.id

  const query = useQuery({
    queryKey: ['friendships', userId],
    queryFn: async (): Promise<FriendshipsData> => {
      const { data: friendships, error: friendshipsError } = await supabase.from('friendships').select('*')

      if (friendshipsError) throw friendshipsError

      const rows = friendships ?? []
      const otherPartyIdByFriendshipId = new Map<string, string>()
      for (const f of rows) {
        const otherId = f.requester_id === userId ? f.recipient_id : f.requester_id
        otherPartyIdByFriendshipId.set(f.id, otherId)
      }

      const otherPartyIds = [...new Set(otherPartyIdByFriendshipId.values())]
      const { data: users, error: usersError } =
        otherPartyIds.length > 0
          ? await supabase.from('users').select(PUBLIC_USER_COLUMNS).in('id', otherPartyIds)
          : { data: [] as UserRow[], error: null }

      if (usersError) throw usersError

      const usersById = new Map((users ?? []).map((u) => [u.id, u]))

      const accepted: UserRow[] = []
      const incoming: { friendshipId: string; user: UserRow }[] = []
      const outgoing: { friendshipId: string; user: UserRow }[] = []

      for (const f of rows) {
        const otherId = otherPartyIdByFriendshipId.get(f.id)!
        const otherUser = usersById.get(otherId)
        if (!otherUser) continue

        if (f.status === 'accepted') {
          accepted.push(otherUser)
        } else if (f.requester_id === userId) {
          outgoing.push({ friendshipId: f.id, user: otherUser })
        } else {
          incoming.push({ friendshipId: f.id, user: otherUser })
        }
      }

      return { accepted, incoming, outgoing }
    },
    enabled: Boolean(userId),
  })

  return {
    ...query,
    isLoading: sessionLoading || (Boolean(userId) && query.isLoading),
  }
}

export function useAcceptFriendRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['friendProfile'] })
    },
  })
}

export function useDeclineFriendRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] })
    },
  })
}

export function useSendFriendRequest() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (recipientId: string) => {
      if (!session) throw new Error('Not signed in')
      const { error } = await supabase
        .from('friendships')
        .insert({ requester_id: session.user.id, recipient_id: recipientId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] })
    },
  })
}

/** Who `otherId` is to the viewer, from the friendships list. */
export type Relationship = { kind: 'friends' } | { kind: 'requested' } | { kind: 'incoming'; friendshipId: string } | { kind: 'none' }
export function relationshipWith(data: FriendshipsData | undefined, otherId: string): Relationship {
  if (data?.accepted.some((u) => u.id === otherId)) return { kind: 'friends' }
  if (data?.outgoing.some((r) => r.user.id === otherId)) return { kind: 'requested' }
  const incoming = data?.incoming.find((r) => r.user.id === otherId)
  return incoming ? { kind: 'incoming', friendshipId: incoming.friendshipId } : { kind: 'none' }
}

/** Unsend a pending request or unfollow a friend — removes the row between the two of you. */
export function useRemoveFriendship() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (otherId: string) => {
      const me = session!.user.id
      const { data, error } = await supabase.from('friendships').delete()
        .or(`and(requester_id.eq.${me},recipient_id.eq.${otherId}),and(requester_id.eq.${otherId},recipient_id.eq.${me})`)
        .select('id')
      if (error) throw error
      // RLS turns a disallowed delete into "0 rows" rather than an error.
      if (!data?.length) throw new Error('Nothing was removed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friendships'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['friendProfile'] })
      queryClient.invalidateQueries({ queryKey: ['recommendedUsers'] })
    },
  })
}
