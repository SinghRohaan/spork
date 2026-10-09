import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Welcome from './screens/onboarding/Welcome'
import Feed from './screens/feed/Feed'
import { HomeShell } from './screens/home/HomeShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RequireOnboarded } from './components/RequireOnboarded'
import { RequireNotOnboarded } from './components/RequireNotOnboarded'
import { RootRedirect } from './components/RootRedirect'

// Screens load on first visit (keeps the first screen fast), and all of them
// are fetched in the background once the app is idle, so taps never wait.
const preloads: (() => Promise<unknown>)[] = []
function screen(load: () => Promise<{ default: ComponentType }>) {
  preloads.push(load)
  return lazy(load)
}
const SignIn = screen(() => import('./screens/onboarding/SignIn'))
const VerifyCode = screen(() => import('./screens/onboarding/VerifyCode'))
const AuthCallback = screen(() => import('./screens/auth/AuthCallback'))
const Privacy = screen(() => import('./screens/legal/Legal').then((m) => ({ default: m.Privacy })))
const Terms = screen(() => import('./screens/legal/Legal').then((m) => ({ default: m.Terms })))
const PublicPost = screen(() => import('./screens/public/PublicPost'))
const Basics = screen(() => import('./screens/onboarding/Basics'))
const Goal = screen(() => import('./screens/onboarding/Goal'))
const Activity = screen(() => import('./screens/onboarding/Activity'))
const FoodLifestyle = screen(() => import('./screens/onboarding/FoodLifestyle'))
const Experience = screen(() => import('./screens/onboarding/Experience'))
const YourPlan = screen(() => import('./screens/onboarding/YourPlan'))
const CreateAccount = screen(() => import('./screens/onboarding/CreateAccount'))
const ProfileSetup = screen(() => import('./screens/onboarding/ProfileSetup'))
const AddFirstFriends = screen(() => import('./screens/onboarding/AddFirstFriends'))
const InsightsScreen = screen(() => import('./screens/insights/Insights'))
const DayReview = screen(() => import('./screens/insights/DayReview'))
const NewChallenge = screen(() => import('./screens/challenges/NewChallenge'))
const ChallengeDetail = screen(() => import('./screens/challenges/ChallengeDetail'))
const LogFlow = screen(() => import('./screens/log/LogFlow'))
const MealDetail = screen(() => import('./screens/log/MealDetail'))
const EditPost = screen(() => import('./screens/log/EditPost'))
const Connections = screen(() => import('./screens/friends/Connections'))
const StreaksRewards = screen(() => import('./screens/rewards/StreaksRewards'))
const Badges = screen(() => import('./screens/badges/Badges'))
const ProfileScreen = screen(() => import('./screens/profile/ProfileScreen'))
const SettingsScreen = screen(() => import('./screens/profile/SettingsScreen'))
const Friends = screen(() => import('./screens/friends/Friends'))
const FriendProfile = screen(() => import('./screens/friends/FriendProfile'))
const NotificationsInbox = screen(() => import('./screens/notifications/NotificationsInbox'))

if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
  idle(() => preloads.forEach((load) => load().catch(() => null)))
}

export default function App() {
  return (
    <div className="mx-auto min-h-screen max-w-[430px] bg-background">
      <Suspense fallback={null}>
      <Routes>
        {/* ── Root — smart redirect based on auth state ─────────────
            Returning signed-in users land here and go straight to feed.
            New / signed-out users go to /welcome.                      */}
        <Route path="/" element={<RootRedirect />} />

        {/* ── Public entry points ─────────────────────────────────── */}
        <Route path="/welcome"  element={<Welcome />} />
        <Route path="/sign-in"  element={<SignIn />} />
        <Route path="/sign-in/code" element={<VerifyCode />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/p/:logId" element={<PublicPost />} />

        {/* ── Pre-auth onboarding — NO session required ────────────
            Users fill these out BEFORE creating an account.
            The Zustand onboarding store holds the data in memory.    */}
        <Route path="/onboarding/basics"         element={<Basics />} />
        <Route path="/onboarding/goal"           element={<Goal />} />
        <Route path="/onboarding/activity"       element={<Activity />} />
        <Route path="/onboarding/food"           element={<FoodLifestyle />} />
        <Route path="/onboarding/experience"     element={<Experience />} />
        <Route path="/onboarding/your-plan"      element={<YourPlan />} />
        <Route path="/onboarding/create-account" element={<CreateAccount />} />

        {/* ── Post-auth onboarding — session required ──────────────
            User has created an account; store data is still in memory. */}
        <Route path="/onboarding/profile"
          element={<ProtectedRoute><RequireNotOnboarded><ProfileSetup /></RequireNotOnboarded></ProtectedRoute>} />
        {/* The "who sees your meals" step was removed — new accounts share with friends. */}
        <Route path="/onboarding/privacy" element={<Navigate to="/onboarding/friends" replace />} />
        <Route path="/onboarding/friends"
          element={<ProtectedRoute><RequireNotOnboarded><AddFirstFriends /></RequireNotOnboarded></ProtectedRoute>} />

        {/* ── Main app ─────────────────────────────────────────────── */}
        <Route path="/home" element={<ProtectedRoute><RequireOnboarded><HomeShell /></RequireOnboarded></ProtectedRoute>}>
          {/* Default: /home → feed */}
          <Route index element={<Navigate to="feed" replace />} />
          <Route path="feed"             element={<Feed />} />
          <Route path="insights"         element={<InsightsScreen />} />
          <Route path="insights/:view"   element={<InsightsScreen />} />
          <Route path="insights/review"  element={<DayReview />} />
          <Route path="log"              element={<LogFlow />} />
          <Route path="rewards"          element={<StreaksRewards />} />
          <Route path="badges"           element={<Badges />} />
          <Route path="friends"          element={<Friends />} />
          <Route path="friend/:username" element={<FriendProfile />} />
          <Route path="challenges/new"   element={<NewChallenge />} />
          <Route path="challenges/:id"   element={<ChallengeDetail />} />
          <Route path="connections/:username" element={<Connections />} />
          <Route path="log/:logId"       element={<MealDetail />} />
          <Route path="log/:logId/edit"  element={<EditPost />} />
          <Route path="notifications"    element={<NotificationsInbox />} />
          <Route path="profile"          element={<ProfileScreen />} />
          <Route path="settings"         element={<SettingsScreen />} />
        </Route>

        {/* ── Fallback — same smart redirect as root ───────────────── */}
        <Route path="*" element={<RootRedirect />} />
      </Routes>
      </Suspense>
    </div>
  )
}
