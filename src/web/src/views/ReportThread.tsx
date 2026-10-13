import { useEffect, useRef, useState } from "react";
import { fetchThread, sendThreadMessage, type ReportThread } from "../api";

interface ReportThreadViewProps {
  identity: { initData?: string; userId?: string };
  issueId: string;
  onBack: () => void;
}

/** Wall-clock times read IST, 12-hour AM/PM — same as everywhere else. */
const istTime = (utc: string): string => {
  const t = Date.parse(String(utc).replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(t);
};

const istDay = (utc: string): string => {
  const t = Date.parse(String(utc).replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  }).format(t);
};

const STATUS_NOTE: Record<ReportThread["status"], string> = {
  open: "waiting on the admin",
  answered: "the admin has written back",
  resolved: "closed",
};

/**
 * One issue, as a conversation. Every message from either side sits in the
 * same ruled column; the admin's entries are marked in the margin. While the
 * page is open it re-reads the thread every few seconds, so a reply typed on
 * the other side lands without a reload — the same reply also arrives in
 * Telegram.
 */
export default function ReportThreadView({
  identity,
  issueId,
  onBack,
}: ReportThreadViewProps) {
  const [thread, setThread] = useState<ReportThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const seenCount = useRef(0);

  const load = (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    fetchThread(identity, issueId)
      .then((t) => {
        setThread(t);
        setError(null);
      })
      .catch((e) => {
        // a failed background poll must not blank a thread already on screen
        if (!silent) setError((e as Error).message || "That didn't load.");
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(false), [issueId]);

  // light polling so the admin's side of the conversation shows up live
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  // keep the newest message in view as the thread grows
  useEffect(() => {
    const count = thread?.messageCount ?? 0;
    if (count !== seenCount.current) {
      seenCount.current = count;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [thread]);

  const send = async () => {
    const clean = draft.trim();
    if (!clean || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendThreadMessage(identity, issueId, clean);
      setDraft("");
      load(true);
    } catch (e) {
      setError((e as Error).message || "Could not send that.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="form-block">
      <div className="thread-head">
        <button onClick={onBack} className="link-btn">
          ← My reports
        </button>
        <div className="thread-head__ids">
          <span className="issue-id">{issueId}</span>
          {thread && (
            <span className={`status-mark status-mark--${thread.status}`}>
              <i aria-hidden="true" />
              {thread.status}
            </span>
          )}
        </div>
        {thread && (
          <p className="thread-head__note">
            Opened {istDay(thread.createdAt)} · {STATUS_NOTE[thread.status]}.
            Replies reach the admin in Telegram.
          </p>
        )}
      </div>

      {loading && (
        <div aria-hidden="true">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="sk" style={{ height: 58, marginTop: 10 }} />
          ))}
        </div>
      )}

      {!loading && error && !thread && (
        <p className="form-note">
          That thread didn't load.{" "}
          <button onClick={() => load(false)} className="link-btn">
            Retry
          </button>
        </p>
      )}

      {thread && (
        <>
          <ol className="thread" aria-live="polite">
            {thread.messages.map((m) => (
              <li key={m.id} className={`thread__msg thread__msg--${m.author}`}>
                <p className="thread__meta">
                  <b>{m.author === "admin" ? "admin" : "you"}</b>
                  <span className="thread__time">
                    {istDay(m.createdAt)} {istTime(m.createdAt)}
                  </span>
                </p>
                <p className="thread__body">{m.body}</p>
              </li>
            ))}
          </ol>
          <div ref={bottom} />

          {thread.status === "resolved" ? (
            <p className="form-note">
              This one is closed. Sending a message reopens it for the admin.
            </p>
          ) : null}

          <form
            className="thread-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            noValidate
          >
            <label className="field">
              <span>Add to this thread</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Anything else that helps: what you tried, what you expected."
              />
              <span className="char-count">{draft.length}/1000</span>
            </label>
            {error && thread ? (
              <p className="note note--err mt-4">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              className="btn-ink w-full mt-4"
            >
              {sending ? "Sending..." : "Send message"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
