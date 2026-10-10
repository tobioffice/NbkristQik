import { useState } from "react";
import { ROLL_REGEX } from "../api";
import { REPORT_URL } from "../constants";
import { useProfile } from "../useProfile";

interface ProfileViewProps {
  tgUser: string | null;
  initData?: string;
}

export default function ProfileView({ tgUser, initData }: ProfileViewProps) {
  const { status, save } = useProfile(tgUser, initData);
  const [roll, setRoll] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // prefill once, when the profile data first arrives (user edits take over after)
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const profileReady =
    status.state === "ready" ? status.profile.roll ?? "" : null;
  const displayNameReady =
    status.state === "ready" ? status.profile.displayName ?? "" : null;
  if (status.state === "ready" && prefilledFor === null) {
    setPrefilledFor(tgUser);
    setRoll(profileReady ?? "");
    setDisplayName(displayNameReady ?? "");
  }

  if (!tgUser) {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-3xl">🔒</p>
        <h2 className="text-white font-semibold">Open this inside Telegram</h2>
        <p className="text-sm text-slate-500 max-w-xs mx-auto">
          Your profile is tied to your Telegram account. Open the bot and
          send /register to set it up.
        </p>
      </div>
    );
  }

  if (status.state === "loading") {
    return (
      <div className="space-y-4 py-8">
        <div className="h-10 rounded-xl bg-slate-800 animate-pulse" />
        <div className="h-10 rounded-xl bg-slate-800/70 animate-pulse" />
        <div className="h-12 rounded-xl bg-slate-800/50 animate-pulse" />
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-3xl">⚠️</p>
        <p className="text-sm text-slate-400">Could not load your profile.</p>
      </div>
    );
  }

  const registered = status.profile.registered;
  const stale = status.profile.stale;

  const submit = async () => {
    setError(null);
    setSaved(null);
    setSuggestions([]);

    const cleanRoll = roll.trim().toUpperCase();
    if (!ROLL_REGEX.test(cleanRoll)) {
      setError("That roll number doesn't look right. Check it and try again.");
      return;
    }

    setSaving(true);
    const { error: saveError, suggestions: sugg } = await save(
      cleanRoll,
      displayName.trim(),
    );
    setSaving(false);
    if (saveError) {
      setError(saveError);
      if (sugg) setSuggestions(sugg);
    } else {
      setSaved(registered ? "Saved" : "Saved. /attendance, /midmarks and /bunk are ready now.");
    }
  };

  return (
    <div className="space-y-5">
      {stale && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Your saved roll is no longer in the college records. If the
          semester changed, update it below.
        </div>
      )}

      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5 space-y-4">
        <div>
          <h2 className="text-white font-semibold">
            {registered ? "Edit your roll" : "Save your roll number"}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Optional. Set it once and /attendance, /midmarks and /bunk answer
            instantly, no roll to type.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Roll number</span>
          <input
            value={roll}
            onChange={(e) => {
              setRoll(e.target.value.toUpperCase());
              setSaved(null);
            }}
            placeholder="26KB5A0218"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500/50"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">
            Display name (optional)
          </span>
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(null);
            }}
            placeholder="How should we show you?"
            maxLength={40}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50"
          />
        </label>

        {status.state === "ready" && status.profile.studentName && (
          <p className="text-xs text-slate-500">
            College record: <span className="text-slate-300">{status.profile.studentName}</span>
          </p>
        )}

        {saved && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {saved}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
            {suggestions.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-slate-400">Did you mean:</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setRoll(s.toUpperCase());
                      setError(null);
                      setSuggestions([]);
                    }}
                    className="block text-xs font-mono text-indigo-300 underline underline-offset-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={submit}
          disabled={saving || !roll.trim()}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : registered ? "Save changes" : "Register"}
        </button>
      </div>

      <a
        href={REPORT_URL}
        className="block text-center text-xs text-slate-500 hover:text-indigo-300 transition-colors"
      >
        Found a problem with the bot? Report an issue
      </a>
    </div>
  );
}