import { useEffect, useRef, useState } from "react";
import {
  cacheThread,
  fetchThread,
  peekThread,
  sendThreadMessage,
  type MyReport,
  type ReportThread,
  type ThreadMessage,
} from "../api";
import { useClosingConfirmation } from "../telegram";

interface ReportThreadViewProps {
  identity: { initData?: string; userId?: string };
  issueId: string;
  /** the row the caller already has: enough to paint the thread immediately */
  seed: MyReport | null;
  onBack: () => void;
  onNewReport: () => void;
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
 * What the reports list already knows about an issue is enough to paint its
 * thread immediately: the opening message, and the admin's latest reply if
 * there is one. The fetch that follows silently replaces the sketch with
 * the full conversation.
 */
const threadFromSeed = (seed: MyReport): ReportThread => ({
  issueId: seed.issueId,
  status: seed.status,
  createdAt: seed.createdAt,
  messageCount: seed.messageCount,
  messages: [
    { id: 0, author: "user", body: seed.message, createdAt: seed.createdAt },
    ...(seed.adminReply
      ? [
          {
            id: 1,
            author: "admin" as const,
            body: seed.adminReply,
            createdAt: seed.repliedAt ?? seed.createdAt,
          },
        ]
      : []),
  ],
});

const knownThread = (
  issueId: string,
  seed: MyReport | null,
): ReportThread | null =>
  peekThread(issueId) ?? (seed ? threadFromSeed(seed) : null);

/**
 * One issue, as a conversation. It paints the moment the row is tapped —
 * from the warm cache, or from the sketch the reports list already holds —
 * and then re-reads the thread quietly so the authoritative copy replaces
 * the sketch without a skeleton flash. While the page is open it polls
 * every few seconds, so a reply typed on the other side lands without a
 * reload — the same reply also arrives in Telegram.
 */
export default function ReportThreadView({
  identity,
  issueId,
  seed,
  onBack,
  onNewReport,
}: ReportThreadViewProps) {
  const [initial] = useState(() => knownThread(issueId, seed));
  const [thread, setThread] = useState<ReportThread | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const seenCount = useRef(initial?.messageCount ?? 0);

  useClosingConfirmation(draft.trim().length > 0);

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

  // paint what we know, then refresh silently when anything is on screen
  useEffect(() => {
    const known = knownThread(issueId, seed);
    setThread(known);
    setLoading(known === null);
    seenCount.current = known?.messageCount ?? 0;
    load(known !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

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

    // the message shows immediately; the quiet refetch below reconciles it
    const optimistic: ThreadMessage = {
      id: -Date.now(),
      author: "user",
      body: clean,
      createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    if (thread) {
      const next: ReportThread = {
        ...thread,
        messages: [...thread.messages, optimistic],
        messageCount: thread.messageCount + 1,
      };
      cacheThread(next);
      setThread(next);
    }

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
            {thread.status === "resolved"
              ? " The thread is closed."
              : " Replies reach the admin in Telegram."}
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
            <div className="thread-closed">
              <p className="form-note">
                This issue is resolved, so the thread is closed. If it came
                back, file it as a new report and mention {issueId}.
              </p>
              {error ? <p className="note note--err mt-4">{error}</p> : null}
              <button onClick={onNewReport} className="btn-ink w-full mt-4">
                File a new report
              </button>
            </div>
          ) : (
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
              {error ? <p className="note note--err mt-4">{error}</p> : null}
              <button
                type="submit"
                disabled={sending || draft.trim().length === 0}
                className="btn-ink w-full mt-4"
              >
                {sending ? "Sending..." : "Send message"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
