// Public Privacy Policy and Terms pages. Google's OAuth consent screen requires
// live URLs for both, and the sign-in screens already link to them.
// Plain-language first draft — review the wording before relying on it legally.
import { TopBar } from '../../components/TopBar'

const UPDATED = '24 September 2026'

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="screen min-h-screen animate-fade-in legal">
      <TopBar title={title} back="/" />
      <p className="tiny muted">Last updated {UPDATED}</p>
      {children}
    </div>
  )
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <h3>What we collect</h3>
      <p>Your email address (or Google account email) to sign you in; the profile details you enter during onboarding (height, weight, age, sex, goals, dietary preferences); the meals you log, including photos and calorie/macro estimates; and friend connections, likes and comments you make in the app.</p>
      <h3>How we use it</h3>
      <p>To calculate your calorie and protein targets, show your history and insights, run streaks and rewards, and show your posts to friends you have connected with. Meal photos are sent to an AI model (Google Gemini) to estimate calories; the photo is used only for that estimate.</p>
      <h3>Where it lives</h3>
      <p>Data is stored with Supabase (Postgres and file storage) and the app is hosted on Vercel. Meal photos are private to you and your friends; profile pictures are public.</p>
      <h3>What we don’t do</h3>
      <p>We don’t sell your data, and we don’t show ads. We only share data with the services above as needed to run Spork.</p>
      <h3>Your choices</h3>
      <p>You can set posts to private, remove friends, and delete individual meals at any time.</p>
      <h3 id="delete-account">Deleting your account</h3>
      <p>In the app, go to <b>Profile → Settings → Delete account</b>. This immediately and permanently deletes your profile, meals, photos, streaks, friends, likes and comments.</p>
      <p>Can’t sign in? Email <a href="mailto:sporkapp.ai@gmail.com">sporkapp.ai@gmail.com</a> from your registered address with the subject “Delete my account” and we’ll delete it and all its data within 30 days.</p>
      <h3>Contact</h3>
      <p><a href="mailto:sporkapp.ai@gmail.com">sporkapp.ai@gmail.com</a></p>
    </LegalPage>
  )
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <h3>Using Spork</h3>
      <p>Spork is a free calorie and meal tracker for personal use. You must be at least 13 to use it. You are responsible for keeping access to your email or Google account secure.</p>
      <h3>Not medical advice</h3>
      <p>Calorie targets and AI estimates are approximations for general fitness tracking. They are not medical or dietary advice. Talk to a doctor or dietitian before making significant changes to your diet, especially if you have a medical condition or are pregnant.</p>
      <h3>Your content</h3>
      <p>You own the photos and posts you share. By posting, you allow Spork to show them to the friends you’ve connected with. Don’t post content that is illegal, abusive, or belongs to someone else.</p>
      <h3>Availability</h3>
      <p>Spork is provided as-is. We may change or discontinue features, and we can suspend accounts that abuse the service.</p>
      <h3>Contact</h3>
      <p><a href="mailto:sporkapp.ai@gmail.com">sporkapp.ai@gmail.com</a></p>
    </LegalPage>
  )
}
