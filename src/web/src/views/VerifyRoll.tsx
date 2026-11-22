import VerificationPanel from "../components/VerificationPanel";
import { useProfile } from "../useProfile";
import { useTelegramIdentity } from "../useTelegramIdentity";

/**
 * The hidden verification page, opened by the channel board's Verify button.
 *
 * It puts the college-mailbox check on its own screen instead of making the
 * reader hunt through the profile: a saved roll goes straight into the existing
 * VerificationPanel; no saved roll gets a one-tap way back to the profile form.
 * Verified students are named by their roll and score for their section.
 */
export default function VerifyRoll() {
  const { tgUser, initData } = useTelegramIdentity();
  const { status } = useProfile(tgUser, initData);

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Verification</p>
        <h2 className="page-title">Verify your roll</h2>
        <p className="page-note">
          We send a code to your college email, &lt;roll&gt;@nbkrist.org.
          Verified students are named by their roll on the boards, and their
          points count for their section in Section Wars.
        </p>
      </div>

      <div className="page-body">
        {!tgUser ? (
          <div className="state-block">
            <p className="title">Open this from Telegram</p>
            <p className="sub">
              The college mailbox check needs the Telegram account that saved
              your roll.
            </p>
          </div>
        ) : status.state === "loading" ? (
          <div className="form-block" aria-hidden="true">
            <div className="sk" style={{ height: 48 }} />
            <div className="sk" style={{ height: 44, marginTop: 12 }} />
          </div>
        ) : status.state === "error" ? (
          <div className="state-block">
            <p className="title">Couldn&rsquo;t read your profile</p>
            <p className="sub">Close this and try again in a moment.</p>
          </div>
        ) : status.profile.roll ? (
          <div className="form-block">
            <VerificationPanel
              identity={{ initData, userId: tgUser }}
              roll={status.profile.roll}
            />
          </div>
        ) : (
          <div className="form-block">
            <p className="form-title">Save your roll first</p>
            <p className="hint-line">
              Verification proves the roll you saved. Save it on your profile,
              then come back here.
            </p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                window.location.hash = "#/";
              }}
            >
              Open my profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
