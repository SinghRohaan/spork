import { Navigate, Route, Routes } from 'react-router-dom'
import Welcome from './screens/onboarding/Welcome'
import SignIn from './screens/onboarding/SignIn'
import VerifyCode from './screens/onboarding/VerifyCode'
import AuthCallback from './screens/auth/AuthCallback'
import { Privacy, Terms } from './screens/legal/Legal'
import PublicPost from './screens/public/PublicPost'
// Pre-auth onboarding (no session required)
import Basics from './screens/onboarding/Basics'
import Goal from './screens/onboarding/Goal'
import Activity from './screens/onboarding/Activity'
import FoodLifestyle from './screens/onboarding/FoodLifestyle'
import Experience from './screens/onboarding/Experience'
import YourPlan from './screens/onboarding/YourPlan'
import CreateAccount from './screens/onboarding/CreateAccount'
// Post-auth onboarding (session required)
import ProfileSetup from './screens/onboarding/ProfileSetup'
import AddFirstFriends from './screens/onboarding/AddFirstFriends'
// App
import Feed from './screens/feed/Feed'
import InsightsScreen from './screens/insights/Insights'
import DayReview from './screens/insights/DayReview'
import NewChallenge from './screens/challenges/NewChallenge'
import ChallengeDetail from './screens/challenges/ChallengeDetail'
import LogFlow from './screens/log/LogFlow'
import MealDetail from './screens/log/MealDetail'
import EditPost from './screens/log/EditPost'
import Connections from './screens/friends/Connections'
import StreaksRewards from './screens/rewards/StreaksRewards'
import Badges from './screens/badges/Badges'
import ProfileScreen from './screens/profile/ProfileScreen'
import SettingsScreen from './screens/profile/SettingsScreen'
import Friends from './screens/friends/Friends'
import FriendProfile from './screens/friends/FriendProfile'
import NotificationsInbox from './screens/notifications/NotificationsInbox'
import { HomeShell } from './screens/home/HomeShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RequireOnboarded } from './components/RequireOnboarded'
import { RequireNotOnboarded } from './components/RequireNotOnboarded'
import { RootRedirect } from './components/RootRedirect'

export default function App() {
  return (
    <div className="mx-auto min-h-screen max-w-[430px] bg-background">
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
    </div>
  )
}
