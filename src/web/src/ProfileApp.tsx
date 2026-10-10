import ProfileView from "./views/Profile";
import { useTelegramIdentity } from "./useTelegramIdentity";

/**
 * Standalone registration mini app (separate page from the leaderboard).
 * Opened by /register and the "Register your roll" buttons; the Telegram
 * back button returns to the bot chat.
 */
function ProfileApp() {
  const { tgUser, initData } = useTelegramIdentity();

  return (
    <div className="bg-slate-900 min-h-screen text-slate-200">
      <div className="max-w-lg mx-auto p-4 md:p-6">
        <header className="mt-8 mb-6 space-y-1">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            My{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
              profile
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Optional. Save it once, change it anytime.
          </p>
        </header>
        <ProfileView tgUser={tgUser} initData={initData} />
      </div>
    </div>
  );
}

export default ProfileApp;