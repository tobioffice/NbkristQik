import { useState } from "react";
import { ROLL_REGEX } from "../api";
import { REPORT_URL } from "../constants";
import { useProfile } from "../useProfile";

interface ProfileViewProps {
  tgUser: string | null;
  initData?: string;
  /**
   * Drop the view's own heading. On inside the app, where the printed page
   * head already names the form; off on the standalone profile page.
   */
  compact?: boolean;
  /** Where "report an issue" goes; the standalone page links out instead. */
  onReportIssue?: () => void;
}

const LockIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="30"
    height="30"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="10.5" width="14" height="9.5" rx="1" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14.5v2" />
  </svg>
);

const WarnIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="30"
    height="30"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 4 21 19.5H3z" />
    <path d="M12 10.5v4" />
    <path d="M12 17.2v.01" />
  </svg>
);

export default function ProfileView({
  tgUser,
  initData,
  compact = false,
  onReportIssue,
}: ProfileViewProps) {
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
      <div className="form-block">
        <div className="state-block">
          <LockIcon />
          <p className="title">Open this inside Telegram</p>
          <p className="sub">
            Your profile is tied to your Telegram account. Open the bot and
            send /register to set it up.
          </p>
        </div>
      </div>
    );
  }

  if (status.state === "loading") {
    return (
      <div className="form-block" aria-hidden="true">
        <div className="sk" style={{ height: 44, marginTop: 22 }} />
        <div className="sk" style={{ height: 44, marginTop: 12 }} />
        <div className="sk" style={{ height: 48, marginTop: 16 }} />
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="form-block">
        <div className="state-block">
          <WarnIcon />
          <p>Could not load your profile.</p>
        </div>
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
    <>
      <div className="form-block">
        {stale && (
          <div className="note note--warn mb-5">
            Your saved roll is no longer in the college records. If the
            semester changed, update it below.
          </div>
        )}

        {compact ? null : (
          <>
            <h2 className="form-title">
              {registered ? "Edit your roll" : "Save your roll number"}
            </h2>
            <p className="form-note">
              Optional. Set it once and /attendance, /midmarks and /bunk answer
              instantly, no roll to type.
            </p>
          </>
        )}

        <label className="field">
          <span>Roll number</span>
          <input
            value={roll}
            onChange={(e) => {
              setRoll(e.target.value.toUpperCase());
              setSaved(null);
            }}
            placeholder="26KB5A0218"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>Display name (optional)</span>
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(null);
            }}
            placeholder="How should we show you?"
            maxLength={40}
          />
        </label>

        {status.state === "ready" && status.profile.studentName && (
          <p className="hint-line">
            College record: <b>{status.profile.studentName}</b>
          </p>
        )}

        {saved && <div className="note note--ok mt-4">{saved}</div>}

        {error && (
          <div className="note note--err mt-4">
            {error}
            {suggestions.length > 0 && (
              <div className="mt-2">
                <p className="hint-line" style={{ marginTop: 0 }}>
                  Did you mean:
                </p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setRoll(s.toUpperCase());
                      setError(null);
                      setSuggestions([]);
                    }}
                    className="suggestion"
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
          className="btn-ink w-full mt-5"
        >
          {saving ? "Saving..." : registered ? "Save changes" : "Register"}
        </button>
      </div>

      {onReportIssue ? (
        <button className="foot-link" onClick={onReportIssue}>
          Found a problem with the bot? Report an issue
        </button>
      ) : (
        <a href={REPORT_URL} className="foot-link">
          Found a problem with the bot? Report an issue
        </a>
      )}
    </>
  );
}
