import { useEffect, useState } from "react";
import { ROLL_REGEX } from "../api";
import { useIdentity } from "../identity";
import { useProfile } from "../useProfile";
import VerificationPanel from "../components/VerificationPanel";
import { RunHistory } from "../components/RunHistory";
import { SkeletonRows } from "../components/FeedbackStates";

interface ProfileViewProps {
  tgUser: string | null;
  initData?: string;
  /** Opens the issue desk; the app owns this navigation. */
  onReportIssue: () => void;
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

const PencilIcon = () => (
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
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const ProfileHead = ({ title, note }: { title: string; note?: string }) => (
  <div className="page-head">
    <h2 className="page-title">{title}</h2>
    {note ? <p className="page-note">{note}</p> : null}
  </div>
);

const ProfileSkeleton = () => <SkeletonRows rows={4} />;

export default function ProfileView({
  tgUser,
  initData,
  onReportIssue,
}: ProfileViewProps) {
  const { status, save, forgetLookup } = useProfile(tgUser, initData);
  const identity = useIdentity();
  const [roll, setRoll] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Prefill once, when the profile data first arrives (user edits take over
  // after). A registered profile opens read-only; an unregistered one opens
  // straight into the form.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  useEffect(() => {
    if (status.state !== "ready" || prefilledFor !== null) return;
    setPrefilledFor(tgUser);
    const profile = status.profile;
    setRoll(profile.registered ? (profile.roll ?? "") : "");
    setDisplayName(profile.registered ? (profile.displayName ?? "") : "");
    setEditing(!profile.registered);
  }, [status, prefilledFor, tgUser]);

  if (!tgUser) {
    return (
      <div className="page">
        <ProfileHead title="Your roll" />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <LockIcon />
              <p className="title">Open this inside Telegram</p>
              <p className="sub">
                Open the bot and send /register to set up your profile.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status.state === "loading") {
    return (
      <div className="page">
        <ProfileHead title="Your roll" />
        <div className="page-body">
          <ProfileSkeleton />
        </div>
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="page">
        <ProfileHead title="Your roll" />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <WarnIcon />
              <p className="title">Could not load your profile.</p>
              <p className="sub">
                Check your connection and open this page again.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // the values are filled in an effect; hold the skeleton for that one frame
  // instead of flashing an empty form at a registered student
  if (prefilledFor === null) {
    return (
      <div className="page">
        <ProfileHead title="Your roll" />
        <div className="page-body">
          <ProfileSkeleton />
        </div>
      </div>
    );
  }

  const profile = status.profile;
  const registered = profile.registered;
  const stale = profile.stale;
  const student = profile.student;
  const lastLookup = profile.lastLookup;
  const showForm = !registered || editing;

  // Year, section and branch from the college record. Any part may be
  // missing, so the line is built from what is there.
  const classLine = [
    student?.year ? `Year ${student.year}` : null,
    student?.section ? `Section ${student.section}` : null,
    student?.branch || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const title = showForm
    ? registered
      ? "Edit your roll"
      : "Save your roll number"
    : "Your roll";
  const note =
    showForm && !registered
      ? "Optional. Save it once and /attendance, /midmarks and /bunk answer in one tap."
      : undefined;

  const startEdit = () => {
    setRoll(profile.roll ?? "");
    setDisplayName(profile.displayName ?? "");
    setError(null);
    setSuggestions([]);
    setSaved(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setRoll(profile.roll ?? "");
    setDisplayName(profile.displayName ?? "");
    setError(null);
    setSuggestions([]);
    setSaved(null);
    setEditing(false);
  };

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
      return;
    }

    setEditing(false);
    setSaved(
      registered
        ? "Saved."
        : "Saved. /attendance, /midmarks and /bunk are ready now.",
    );
    // the shell's identity is now this registration; ask it again
    identity.refresh();
  };

  const forget = async () => {
    setError(null);
    setSaved(null);
    setForgetting(true);
    try {
      await forgetLookup();
      // keep the shared identity's suggestion in step with the profile
      identity.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not forget that roll.");
    } finally {
      setForgetting(false);
    }
  };

  return (
    <div className="page">
      <ProfileHead title={title} note={note} />

      <div className="page-body">
        {showForm ? (
          <div className="form-block">
            {stale && (
              <div className="note note--warn mb-5">
                Your saved roll is no longer in the college records. If the
                semester changed, update it below.
              </div>
            )}

            {!registered && lastLookup ? (
              <div className="note mt-4">
                <button
                  type="button"
                  className="suggestion"
                  style={{ marginTop: 0 }}
                  onClick={() => {
                    setRoll(lastLookup.toUpperCase());
                    setSaved(null);
                    setError(null);
                  }}
                >
                  Last looked up: {lastLookup}. Use it?
                </button>
                <button
                  type="button"
                  className="link-btn mt-2"
                  onClick={forget}
                  disabled={forgetting}
                >
                  {forgetting ? "Forgetting..." : "That's not me, forget it"}
                </button>
              </div>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="field">
                <span>Roll number</span>
                <input
                  value={roll}
                  onChange={(event) => {
                    setRoll(event.target.value.toUpperCase());
                    setSaved(null);
                  }}
                  placeholder="99KB9A9998"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label className="field">
                <span>Display name (optional)</span>
                <input
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setSaved(null);
                  }}
                  maxLength={40}
                />
              </label>

              {student?.name && (
                <p className="hint-line">
                  College record: <b>{student.name}</b>
                </p>
              )}

              {error && (
                <div className="note note--err mt-4">
                  {error}
                  {suggestions.length > 0 && (
                    <div className="mt-2">
                      <p className="hint-line" style={{ marginTop: 0 }}>
                        Did you mean:
                      </p>
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            setRoll(suggestion.toUpperCase());
                            setError(null);
                            setSuggestions([]);
                          }}
                          className="suggestion"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {registered ? (
                <div className="btn-row mt-5">
                  <button
                    type="submit"
                    disabled={saving || !roll.trim()}
                    className="btn-ink"
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="btn-outline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={saving || !roll.trim()}
                  className="btn-ink w-full mt-5"
                >
                  {saving ? "Saving..." : "Register"}
                </button>
              )}
            </form>
          </div>
        ) : (
          <>
            {saved && (
              <div className="form-block">
                <div className="note note--ok">{saved}</div>
              </div>
            )}

            {stale && (
              <div className="form-block">
                <div className="note note--warn">
                  Your saved roll is no longer in the college records. If the
                  semester changed, edit it.
                </div>
              </div>
            )}

            <div className="form-block">
              <div className="profile-group">
                <div className="profile-row">
                  <span className="profile-row__label">Roll number</span>
                  <span className="profile-row__value">{profile.roll}</span>
                </div>

                <div className="profile-row">
                  <span className="profile-row__label">Display name</span>
                  <span
                    className={`profile-row__value${
                      profile.displayName ? "" : " profile-row__value--quiet"
                    }`}
                  >
                    {profile.displayName || "Not set"}
                  </span>
                </div>

                <div className="profile-row">
                  <span className="profile-row__label">College record</span>
                  <span
                    className={`profile-row__value${
                      student?.name ? "" : " profile-row__value--quiet"
                    }`}
                  >
                    {student?.name || (stale ? "Not in the records" : "—")}
                  </span>
                </div>

                {classLine && (
                  <div className="profile-row">
                    <span className="profile-row__label">Class</span>
                    <span className="profile-row__value profile-row__value--quiet">
                      {classLine}
                    </span>
                  </div>
                )}
              </div>

              <p className="profile-hint">
                The leaderboard shows your display name when set, otherwise the
                name on your college record.
              </p>

              <button
                type="button"
                className="btn-ink w-full mt-4 profile-edit"
                onClick={startEdit}
              >
                <PencilIcon />
                Edit profile
              </button>
            </div>

            <RunHistory runs={profile.runs} />

            {profile.roll && (
              <div className="form-block">
                <VerificationPanel
                  identity={{ initData, userId: tgUser ?? undefined }}
                  roll={profile.roll}
                />
              </div>
            )}
          </>
        )}

        <button className="foot-link" onClick={onReportIssue}>
          Found a problem with the bot? Report an issue
        </button>
      </div>
    </div>
  );
}
