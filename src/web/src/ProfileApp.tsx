import ProfileView from "./views/Profile";
import Band from "./components/Band";
import { useTelegramIdentity } from "./useTelegramIdentity";

/**
 * Standalone registration mini app (separate page from the leaderboard).
 * Opened by /register and the "Register your roll" buttons; the Telegram
 * back button returns to the bot chat.
 */
function ProfileApp() {
  const { tgUser, initData } = useTelegramIdentity();

  return (
    <div className="app">
      <div className="sheet">
        <Band sub="Student profile" />
        <div className="form-wrap">
          <div className="form-block">
            <h1 className="form-title form-title--lg">My profile</h1>
            <p className="form-note">
              Optional. Save it once, change it anytime.
            </p>
          </div>
          <ProfileView tgUser={tgUser} initData={initData} />
        </div>
      </div>
    </div>
  );
}

export default ProfileApp;
