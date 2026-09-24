import { useState, type FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useSession } from '../../hooks/useSession'
import { TopBar } from '../../components/TopBar'
import { GoogleButton } from '../../components/GoogleButton'
import { isValidEmail, routeAfterSignIn, sendEmailCode } from '../../lib/auth'
import { SporkWordmark } from '../../components/brand/SporkWordmark'

/**
 * Sign-in for RETURNING users: email → 6-digit code (or Google).
 * A password fallback stays for accounts created before codes existed.
 * New users go through /onboarding/basics → /onboarding/create-account instead.
 */
export default function SignIn() {
  const navigate      = useNavigate()
  const { session, loading } = useSession()
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in — no need to sign in again
  if (!loading && session) return <Navigate to="/home/feed" replace />

  async function handleSendCode(e: FormEvent) {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!isValidEmail(addr)) { setError('Enter a valid email address.'); return }
    setError(null)
    setSubmitting(true)
    const { error: sendError } = await sendEmailCode(addr)
    setSubmitting(false)
    if (sendError) { setError(sendError); return }
    navigate('/sign-in/code', { state: { email: addr } })
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (authError) {
      setSubmitting(false)
      setError(authError.message.toLowerCase().includes('invalid') ? 'Incorrect email or password. Try again.' : authError.message)
      return
    }
    const next = data.user ? await routeAfterSignIn(data.user.id) : '/home/feed'
    setSubmitting(false)
    navigate(next, { replace: true })
  }

  return (
    <div className="screen min-h-screen animate-fade-in">
      <TopBar title="" back="/welcome" />

      <div className="icon-box mx-auto" style={{ width: 120, height: 120, marginTop: 24 }}><SporkWordmark size={28} play="once" /></div>
      <div style={{ height: 28 }} />

      <h2>Your usual?</h2>
      <p className="muted">Welcome back. Your people are right where you left them</p>
      <div style={{ height: 20 }} />

      <form onSubmit={usePassword ? handlePassword : handleSendCode}>
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {usePassword && (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={submitting} className="btn">
          {submitting ? (usePassword ? 'Signing in…' : 'Sending code…') : usePassword ? 'Sign in' : 'Send me a sign-in code →'}
        </button>
      </form>

      <GoogleButton onError={setError} />

      <button type="button" onClick={() => { setUsePassword((v) => !v); setError(null) }} className="btn ghost">
        {usePassword ? 'Use a sign-in code instead' : 'Use password instead'}
      </button>
      <button type="button" onClick={() => navigate('/onboarding/basics')} className="btn ghost" style={{ marginTop: 0 }}>
        New here? Create an account
      </button>
    </div>
  )
}
