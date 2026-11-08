import { useEffect, useRef, useState } from "react";
import {
  fetchThread,
  peekThread,
  sendThreadMessage,
  type MyReport,
  type ReportThread,
} from "../api";
import { clearDraft, readDraft, threadDraftKey, writeDraft } from "../drafts";
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
const IST_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const IST_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
});

const istTime = (utc: string): string => {
  const t = Date.parse(String(utc).replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  return IST_TIME.format(t);
};

const istDay = (utc: string): string => {
  const t = Date.parse(String(utc).replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  return IST_DAY.format(t);
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

export interface ThreadPollOptions {
  /** One read of the conversation. The signal aborts when polling stops. */
  request: (signal: AbortSignal) => Promise<ReportThread>;
  onThread: (thread: ReportThread) => void;
  /** A background failure; the open thread stays as it is. */
  onError?: (error: unknown) => void;
  /** False stops the clock: a resolved thread cannot change. */
  canPoll?: () => boolean;
  /** Hidden tabs do not spend requests. */
  isVisible?: () => boolean;
  /** Another read (the opening fetch) is still in flight. */
  isBusy?: () => boolean;
  intervalMs?: number;
}

/**
 * Poll a thread every few seconds while it can still change. One request at
 * a time, none from a hidden tab, and none after the conversation is closed.
 * Stopping aborts the request already in flight.
 */
// This helper lives beside the view it drives so the fake-timer test can
// exercise the real clock instead of a copy of it.
// eslint-disable-next-line react-refresh/only-export-components
export const startThreadPoll = ({
  request,
  onThread,
  onError,
  canPoll = () => true,
  isVisible = () =>
    typeof document === "undefined" || document.visibilityState === "visible",
  isBusy = () => false,
  intervalMs = 8000,
}: ThreadPollOptions): (() => void) => {
  const controller = new AbortController();
  let inFlight = false;
  let stopped = false;
  let settled = false;
  let id: ReturnType<typeof setInterval> | null = null;

  const stopClock = () => {
    if (id !== null) {
      clearInterval(id);
      id = null;
    }
  };

  const tick = async () => {
    if (stopped || settled || inFlight) return;
    if (!canPoll()) {
      settled = true;
      stopClock();
      return;
    }
    if (!isVisible() || isBusy()) return;

    inFlight = true;
    try {
      const thread = await request(controller.signal);
      if (stopped) return;
      onThread(thread);
      if (thread.status === "resolved") {
        settled = true;
        stopClock();
      }
    } catch (error) {
      if (!stopped && !controller.signal.aborted) onError?.(error);
    } finally {
      inFlight = false;
    }
  };

  id = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    stopClock();
    controller.abort();
  };
};

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
  const draftKey = threadDraftKey(issueId);
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const seenCount = useRef(initial?.messageCount ?? 0);
  const threadRef = useRef(thread);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useClosingConfirmation(draft.trim().length > 0);

  // a reply is just as easy to lose as a report: keep it per issue
  useEffect(() => {
    writeDraft(draftKey, draft);
  }, [draftKey, draft]);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const load = (silent: boolean, supersede = false) => {
    // a slow read must not stack on itself; a visible action (Retry, Send)
    // is allowed to supersede a request already in flight
    if (silent && !supersede && inFlightRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    fetchThread(identity, issueId, controller.signal)
      .then((t) => {
        if (controller.signal.aborted) return;
        setThread(t);
        setError(null);
      })
      .catch((e) => {
        // an abort is the page moving on, not a failed read
        if (controller.signal.aborted) return;
        // a failed background poll must not blank a thread already on screen
        if (!silent) setError((e as Error).message || "That didn't load.");
      })
      .finally(() => {
        if (abortRef.current !== controller) return;
        abortRef.current = null;
        inFlightRef.current = false;
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

  // light polling so the admin's side of the conversation shows up live;
  // the clock stops as soon as the thread is resolved
  useEffect(() => {
    if (thread?.status === "resolved") return;
    return startThreadPoll({
      request: (signal) => fetchThread(identity, issueId, signal),
      onThread: (next) => {
        setThread(next);
        setError(null);
      },
      canPoll: () => threadRef.current?.status !== "resolved",
      isBusy: () => inFlightRef.current,
    });
  }, [identity, issueId, thread?.status]);

  // navigating away must not leave a request running
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    },
    [],
  );

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

    // Nothing goes on the thread until the server has accepted it: a bubble
    // that looks delivered but failed is worse than a moment's wait. The
    // draft stays put on failure, so the words are never lost.
    try {
      await sendThreadMessage(identity, issueId, clean);
      setDraft("");
      clearDraft(draftKey);
      load(true, true);
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
