import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useUpdateProfile } from '../../hooks/useProfile'
import { useLogDraftStore } from '../../store/logDraft'
import { useOnboardingStore } from '../../store/onboardingStore'
import { ThemeToggle } from '../../components/ThemeToggle'
import { Skeleton } from '../../components/Skeleton'
import { useToast } from '../../components/Toast'
import { TopBar } from '../../components/TopBar'
import { isValidUsernameFormat } from '../../lib/username'
import { deleteAccount } from '../../lib/deleteAccount'

export default function SettingsScreen() {
  const queryClient   = useQueryClient()
  const { data: user, isLoading } = useCurrentUser()
  const updateProfile = useUpdateProfile()
  const { toast }     = useToast()

  const [calorieGoalVal, setCalorieGoalVal] = useState('')
  const [proteinGoalVal, setProteinGoalVal] = useState('')
  const [reminderTime,   setReminderTime]   = useState('')
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameVal,     setUsernameVal]     = useState('')
  const [usernameError,   setUsernameError]   = useState<string | null>(null)
  const [usernameSaving,  setUsernameSaving]  = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteText,       setDeleteText]       = useState('')
  const [deleting,         setDeleting]         = useState(false)
  const [deleteError,      setDeleteError]      = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <TopBar title="Settings" back="/home/profile" />
        <Skeleton className="h-16 !rounded-[27px]" />
        <Skeleton className="mt-3 h-28 !rounded-[27px]" />
        <Skeleton className="mt-3 h-16 !rounded-[27px]" />
      </div>
    )
  }
  if (!user) return null

  const calorieGoal = user.calorie_goal ?? 2000
  const proteinGoal = (user as unknown as { protein_goal?: number }).protein_goal ?? 0

  function saveField(fields: Parameters<typeof updateProfile.mutate>[0]) {
    updateProfile.mutate(fields, {
      onSuccess: () => toast('Saved ✓'),
      onError:   () => toast('Could not save — try again', 'error'),
    })
  }

  // Same rules + availability check as onboarding ProfileSetup; the DB
  // unique constraint is the final guard (23505 → "already taken").
  async function saveUsername() {
    if (!user) return
    const next = usernameVal.trim().toLowerCase().replace(/^@/, '')
    setUsernameError(null)
    if (next === user.username) { setEditingUsername(false); return }
    if (!isValidUsernameFormat(next)) {
      setUsernameError('3–20 characters: lowercase letters, numbers, underscores.')
      return
    }
    setUsernameSaving(true)
    const { data: existing, error: lookupError } = await supabase
      .from('users').select('id').eq('username', next).maybeSingle()
    if (lookupError) { setUsernameSaving(false); setUsernameError('Could not check availability — try again.'); return }
    if (existing)    { setUsernameSaving(false); setUsernameError('That username is already taken.'); return }
    updateProfile.mutate({ username: next }, {
      onSuccess: () => { setUsernameSaving(false); setEditingUsername(false); toast('Username updated ✓') },
      onError:   (err) => {
        setUsernameSaving(false)
        const code = (err as { code?: string }).code
        setUsernameError(code === '23505' ? 'That username is already taken.' : 'Could not save — try again.')
      },
    })
  }

  async function handleSignOut() {
    if (!window.confirm('Sign out of Spork?')) return
    await supabase.auth.signOut()
    queryClient.clear()
    useLogDraftStore.getState().reset()
    useOnboardingStore.getState().reset()
  }

  async function handleDeleteAccount() {
    if (!user) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccount(user.id)
    } catch {
      setDeleting(false)
      setDeleteError('Could not delete your account — check your connection and try again.')
      return
    }
    // The account no longer exists server-side — just clear this device.
    await supabase.auth.signOut({ scope: 'local' })
    queryClient.clear()
    useLogDraftStore.getState().reset()
    useOnboardingStore.getState().reset()
  }

  const inlineInput = 'editable w-20 bg-transparent text-right font-semibold outline-none'

  return (
    <div>
      <TopBar title="Settings" back="/home/profile" />

      {/* ── Appearance ─────────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Appearance</span>
        <div className="card" style={{ margin: 0 }}>
          <div className="flex items-center justify-between">
            <b className="font-semibold">Theme</b>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* ── Nutrition goals ────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Nutrition goals</span>
        <div className="card" style={{ margin: 0 }}>
          <div className="flex items-center justify-between">
            <label htmlFor="cal-goal">Daily calories</label>
            <input
              id="cal-goal"
              type="number"
              inputMode="numeric"
              value={calorieGoalVal || calorieGoal}
              onChange={(e) => setCalorieGoalVal(e.target.value)}
              onBlur={() => {
                const n = Number(calorieGoalVal)
                if (n >= 800 && n <= 6000) saveField({ calorie_goal: n })
                setCalorieGoalVal('')
              }}
              className={inlineInput}
            />
          </div>
          <div className="divider" />
          <div className="flex items-center justify-between">
            <label htmlFor="protein-goal">Daily protein · g</label>
            <input
              id="protein-goal"
              type="number"
              inputMode="numeric"
              value={proteinGoalVal || proteinGoal || ''}
              placeholder="0"
              onChange={(e) => setProteinGoalVal(e.target.value)}
              onBlur={() => {
                const n = Number(proteinGoalVal)
                if (n >= 0 && n <= 500) saveField({ protein_goal: n })
                setProteinGoalVal('')
              }}
              className={inlineInput}
            />
          </div>
        </div>
      </div>

      {/* ── Privacy ───────────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Privacy</span>
        <div className="card" style={{ margin: 0 }}>
          <div className="flex items-center justify-between">
            <span>
              <b className="block font-semibold">Posts visible to friends</b>
              <p className="small muted">{user.privacy_default === 'public' ? 'Public by default' : 'Private by default'}</p>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={user.privacy_default === 'public'}
              aria-label="Posts visible to friends"
              onClick={() => saveField({ privacy_default: user.privacy_default === 'public' ? 'private' : 'public' })}
              className={`switch ${user.privacy_default === 'public' ? '' : 'off'}`}
            />
          </div>
        </div>
      </div>

      {/* ── Reminders ─────────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Reminders</span>
        <div className="card" style={{ margin: 0 }}>
          <div className="flex items-center justify-between">
            <span>
              <b className="block font-semibold">Daily logging reminder</b>
              <p className="tiny muted">UI only · no push notification yet</p>
            </span>
            <input
              type="time"
              value={reminderTime || user.reminder_time || ''}
              onChange={(e) => setReminderTime(e.target.value)}
              onBlur={() => { if (reminderTime) saveField({ reminder_time: reminderTime }) }}
              className="editable bg-transparent font-semibold outline-none"
              aria-label="Reminder time"
            />
          </div>
        </div>
      </div>

      {/* ── Account ───────────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Account</span>
        <div className="card" style={{ margin: 0 }}>
          {editingUsername ? (
            <form onSubmit={(e) => { e.preventDefault(); saveUsername() }}>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="username">Username</label>
                <span className="flex items-center gap-1 font-semibold">
                  @
                  <input
                    id="username"
                    value={usernameVal}
                    onChange={(e) => setUsernameVal(e.target.value)}
                    className={inlineInput}
                    style={{ width: 130, textAlign: 'left' }}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="username"
                    maxLength={21}
                    autoFocus
                  />
                </span>
              </div>
              {usernameError && <p className="error-text" style={{ marginTop: 8 }}>{usernameError}</p>}
              <div className="flex justify-end gap-4" style={{ marginTop: 10 }}>
                <button type="button" className="muted" onClick={() => { setEditingUsername(false); setUsernameError(null) }}>Cancel</button>
                <button type="submit" className="font-semibold" disabled={usernameSaving}>{usernameSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between">
              <span>Username</span>
              <button
                type="button"
                onClick={() => { setUsernameVal(user.username); setEditingUsername(true) }}
                className="flex items-center gap-2"
                aria-label="Change username"
              >
                <span className="muted">@{user.username}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />
                </svg>
              </button>
            </div>
          )}
          <div className="divider" />
          <button type="button" onClick={handleSignOut} className="font-semibold">Sign out →</button>
          <div className="divider" />
          {confirmingDelete ? (
            <div>
              <b className="block font-semibold text-error">Delete your account?</b>
              <p className="small muted" style={{ marginTop: 4 }}>
                This permanently deletes your profile, meals, photos, streaks, friends, likes and comments. It can’t be undone.
              </p>
              <div className="field" style={{ margin: '12px 0 0' }}>
                <label htmlFor="delete-confirm">Type DELETE to confirm</label>
                <input id="delete-confirm" value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
                  autoCapitalize="characters" autoCorrect="off" autoComplete="off" />
              </div>
              {deleteError && <p className="error-text" style={{ marginTop: 8 }}>{deleteError}</p>}
              <div className="flex items-center justify-end gap-4" style={{ marginTop: 10 }}>
                <button type="button" className="muted" disabled={deleting}
                  onClick={() => { setConfirmingDelete(false); setDeleteText(''); setDeleteError(null) }}>Cancel</button>
                <button type="button" className="font-semibold text-error" onClick={handleDeleteAccount}
                  disabled={deleting || deleteText.trim().toUpperCase() !== 'DELETE'}>
                  {deleting ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="small text-error">Delete account</button>
          )}
        </div>
      </div>
    </div>
  )
}
