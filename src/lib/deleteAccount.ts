import { supabase } from './supabase'

const AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif']

/**
 * Permanently deletes the signed-in user's account.
 *
 * 1. Removes their photos from Storage (best effort — the Storage API is
 *    the only way to delete files; a leftover file is unreachable anyway
 *    once the account is gone).
 * 2. Calls delete_my_account(), which deletes the auth user; every table
 *    cascades from it (migration 0011).
 */
export async function deleteAccount(userId: string): Promise<void> {
  const { data: logs } = await supabase.from('logs').select('photo_url').eq('user_id', userId)
  const mealPhotos = (logs ?? [])
    .map((l) => l.photo_url as string | null)
    .filter((p): p is string => !!p && p.startsWith(`${userId}/`))
  for (let i = 0; i < mealPhotos.length; i += 100) {
    await supabase.storage.from('meal-photos').remove(mealPhotos.slice(i, i + 100))
  }
  await supabase.storage.from('avatars').remove(AVATAR_EXTENSIONS.map((ext) => `${userId}/avatar.${ext}`))

  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw error
}
