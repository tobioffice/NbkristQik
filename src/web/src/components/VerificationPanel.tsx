import { useEffect, useState } from "react";
import {
  confirmVerification,
  getVerification,
  setVerificationOptions,
  startVerification,
  type ApiIdentity,
  type VerificationState,
} from "../api";

interface VerificationPanelProps {
  identity: ApiIdentity;
  /** The caller's saved roll; the panel is only shown when there is one. */
  roll: string;
}

/**
 * Prove the roll with the college mailbox, then optionally hide it.
 *
 * The code always goes to `<roll>@nbkrist.org`; the address is not editable
 * here. Verification claims the roll for this Telegram account and terminates
 * every other registration for it, so the panel says that before asking for a
 * code.
 */
export default function VerificationPanel({
  identity,
  roll,
}: VerificationPanelProps) {
  const [state, setState] = useState<VerificationState | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "confirm" | "options" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getVerification(identity)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setError("Could not read your verification state.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // identity is derived from the same Telegram account for this panel's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll]);

  if (loading) {
    return (
      <p className="hint-line" role="status">
        Checking your college email…
      </p>
    );
  }

  if (state?.verified && state.roll === roll.toUpperCase()) {
    const setOption =
      (key: "hideLeaderboard" | "blockLookups" | "blockRegistration") =>
      (checked: boolean) => {
        setError(null);
        setBusy("options");
        setVerificationOptions(identity, {
          hideLeaderboard: state.hideLeaderboard,
          blockLookups: state.blockLookups,
          blockRegistration: state.blockRegistration,
          [key]: checked,
        })
          .then(setState)
          .catch((e: Error) => setError(e.message))
          .finally(() => setBusy(null));
      };

    return (
      <div className="verify-panel">
        <p className="form-title">Verified</p>
        <div className="note note--ok">
          {state.email} is proved for this roll. Choose what the register may
          do with it.
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={state.hideLeaderboard}
            disabled={busy !== null}
            onChange={(event) => setOption("hideLeaderboard")(event.target.checked)}
          />
          <span>
            <b>Hide me in the leaderboard</b>
            <br />
            Your row leaves the ranked register and its coverage counts. Nothing
            else changes.
          </span>
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={state.blockLookups}
            disabled={busy !== null}
            onChange={(event) => setOption("blockLookups")(event.target.checked)}
          />
          <span>
            <b>Stop anyone checking my data</b>
            <br />
            Attendance, mid marks and bunk refuse every other account. You and
            the admin still see them.
          </span>
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={state.blockRegistration}
            disabled={busy !== null}
            onChange={(event) =>
              setOption("blockRegistration")(event.target.checked)
            }
          />
          <span>
            <b>Only I can register this roll</b>
            <br />
            Another account cannot save this roll as its own. Your registration
            stays either way.
          </span>
        </label>

        {error ? <div className="note note--err mt-4">{error}</div> : null}
      </div>
    );
  }

  if (state?.verified && state.roll !== roll.toUpperCase()) {
    return (
      <div className="verify-panel">
        <p className="form-title">Verified roll</p>
        <div className="note note--warn">
          You verified {state.roll}. Register that roll, or verify{" "}
          {roll.toUpperCase()} to move your registration.
        </div>
      </div>
    );
  }

  const sendCode = () => {
    setError(null);
    setBusy("send");
    startVerification(identity, roll)
      .then((sent) => {
        setSentTo(sent.email);
        setCode("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const confirm = () => {
    setError(null);
    setBusy("confirm");
    confirmVerification(identity, roll, code)
      .then((next) => {
        setState(next);
        setSentTo(null);
        setCode("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <div className="verify-panel">
      <p className="form-title">Verify your college email</p>
      <p className="form-note">
        A six-digit code goes to {roll.toLowerCase()}@nbkrist.org. Verifying
        proves the roll is yours, ends every other registration for it, and
        unlocks the option to hide it.
      </p>

      {sentTo ? (
        <>
          <div className="note note--ok">Code sent to {sentTo}.</div>
          <label className="field">
            <span>Six-digit code</span>
            <input
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6))
              }
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
          <button
            className="btn-ink w-full mt-4"
            onClick={confirm}
            disabled={busy !== null || code.length !== 6}
          >
            {busy === "confirm" ? "Checking…" : "Confirm"}
          </button>
          <button
            className="link-btn mt-2"
            onClick={sendCode}
            disabled={busy !== null}
          >
            {busy === "send" ? "Sending…" : "Send another code"}
          </button>
        </>
      ) : (
        <button
          className="btn-outline w-full mt-4"
          onClick={sendCode}
          disabled={busy !== null}
        >
          {busy === "send"
            ? "Sending…"
            : `Send code to ${roll.toLowerCase()}@nbkrist.org`}
        </button>
      )}

      {error ? <div className="note note--err mt-4">{error}</div> : null}
    </div>
  );
}
