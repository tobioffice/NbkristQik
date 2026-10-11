import Leaderboard from "./Leaderboard";
import { PROFILE_URL } from "./constants";

function App() {
  return (
    <div className="app">
      <div className="sheet">
        <Leaderboard />
      </div>
      <div className="profile-dock">
        <a href={PROFILE_URL} className="profile-tab">
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c1.6-3.4 4.6-5 8-5s6.4 1.6 8 5" />
          </svg>
          My profile
        </a>
      </div>
    </div>
  );
}

export default App;
