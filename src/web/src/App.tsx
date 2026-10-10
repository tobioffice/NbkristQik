import Leaderboard from "./Leaderboard";
import { PROFILE_URL } from "./constants";

function App() {
  return (
    <div className="bg-slate-900 min-h-screen text-slate-200">
      <Leaderboard />
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30">
        <a
          href={PROFILE_URL}
          className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-xs font-semibold rounded-full px-4 py-2 shadow-lg shadow-indigo-500/10"
        >
          👤 My profile
        </a>
      </div>
    </div>
  );
}

export default App;