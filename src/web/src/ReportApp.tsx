import { useEffect, useState } from "react";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { submitReport, fetchMyReports, type MyReport } from "./api";

type View = "form" | "history";

/**
 * Issue reports mini app: type on a real keyboard, get an issue id, watch
 * the admin's reply arrive on this page and in Telegram.
 */
function ReportApp() {
  const { tgUser, initData } = useTelegramIdentity();
  const [view, setView] = useState<View>("form");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingError, setLoadingError] = useState(false);

  const identity = { userId: tgUser ?? undefined, initData };

  const loadReports = () => {
    if (!tgUser) return;
    setLoadingReports(true);
    setLoadingError(false);
    fetchMyReports(identity)
      .then((rows) => setReports(rows))
      .catch(() => setLoadingError(true))
      .finally(() => setLoadingReports(false));
  };

  // history loads the first time the view opens; later visits refetch via the buttons
  useEffect(() => {
    if (view === "history" && reports === null && !loadingReports) loadReports();
    // deliberate: only fire on view switches, avoid refetch loops on state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const send = async () => {
    setError(null);
    const clean = message.trim();
    if (clean.length < 10 || clean.length > 1000) {
      setError("Give me a bit more detail: between 10 and 1000 characters.");
      return;
    }
    setSending(true);
    try {
      const { issueId } = await submitReport(identity, clean);
      setTicket(issueId);
      setMessage("");
      setReports(null); // history refetches next visit
    } catch (e) {
      setError((e as Error).message || "Could not send the report.");
    } finally {
      setSending(false);
    }
  };

  if (!tgUser) {
    return (
      <div className="min-h-screen bg-[#0f1014] text-slate-200 font-['Outfit'] flex items-center justify-center p-6">
        <div className="text-center max-w-xs space-y-3">
          <p className="text-3xl">🔒</p>
          <h1 className="text-white text-lg font-semibold tracking-tight">Open this inside Telegram</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Reports are tied to your Telegram account. Open the bot and send /report to start one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1014] text-slate-200 font-['Outfit'] selection:bg-indigo-500/30">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#0f1014] to-[#0f1014] pointer-events-none" />

      <div className="relative max-w-xl mx-auto px-5 md:px-8 pt-10 pb-24">
        {view === "form" && !ticket && (
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="space-y-6"
            noValidate
          >
            <div className="space-y-2">
              <h1 className="text-[clamp(26px,6.5vw,32px)] font-semibold text-white leading-[1.15] tracking-tight">
                Report an issue
              </h1>
              <p className="text-[14.5px] text-slate-400 leading-relaxed max-w-[44ch]">
                Describe what went wrong. You'll get an issue id to track it, and the reply lands in your Telegram chat.
              </p>
            </div>

            <label className="block space-y-2">
              <span className="text-[13px] font-medium text-slate-400">What happened?</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={1000}
                placeholder="Marks are showing wrong for my roll. The portal says 22 but the bot shows 13."
                className="w-full bg-[#16171d] border border-white/10 rounded-xl px-4 py-3.5 text-[15px] leading-[1.65] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-400/50 focus:ring-4 focus:ring-indigo-500/10 resize-y min-h-[140px] transition-colors"
              />
              <span className="block text-right font-mono text-[11.5px] text-slate-600 tabular-nums">
                {message.length}/1000
              </span>
            </label>

            {error && (
              <p className="text-[13.5px] text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 leading-relaxed">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={sending || message.trim().length < 10}
              className="w-full py-3.5 rounded-xl text-[14.5px] font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-indigo-500/30 transition-shadow"
            >
              {sending ? "Sending..." : "Send report"}
            </button>
          </form>
        )}

        {view === "form" && ticket && (
          <div className="pt-8 space-y-8">
            <p className="text-[14px] text-emerald-300">Report received</p>
            <div>
              <p className="font-mono text-[clamp(34px,9vw,44px)] font-medium tracking-tight bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent leading-none">
                {ticket}
              </p>
              <p className="mt-3 text-[14.5px] text-slate-400 leading-relaxed max-w-[42ch]">
                Keep this id for follow-ups. The reply lands in your Telegram chat and here under My reports.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setTicket(null); }}
                className="flex-1 py-3 rounded-xl text-[14px] font-semibold bg-[#16171d] border border-white/10 text-slate-300"
              >
                Report another
              </button>
              <button
                onClick={() => setView("history")}
                className="flex-1 py-3 rounded-xl text-[14px] font-semibold bg-indigo-500/15 border border-indigo-500/30 text-indigo-200"
              >
                My reports
              </button>
            </div>
          </div>
        )}

        {view === "history" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-[22px] font-semibold text-white tracking-tight">My reports</h1>
              <button
                onClick={() => { setView("form"); setReports(null); }}
                className="text-[13px] text-slate-400 border border-white/10 rounded-full px-3.5 py-1.5 hover:text-slate-200 transition-colors"
              >
                New report
              </button>
            </div>

            {loadingReports && (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-[#16171d] animate-pulse" />
                ))}
              </div>
            )}

            {loadingError && (
              <p className="text-[13.5px] text-slate-400">
                That didn't load.
                <button onClick={loadReports} className="ml-2 text-indigo-300 underline underline-offset-2">Retry</button>
              </p>
            )}

            {reports && reports.length === 0 && (
              <p className="text-[14.5px] text-slate-500 leading-relaxed max-w-[40ch]">
                No reports yet. Anything you send shows up here with its status.
              </p>
            )}

            {reports && reports.length > 0 && (
              <ul className="space-y-4">
                {reports.map((r) => (
                  <li key={r.issueId} className="border-l-2 border-white/10 pl-4 space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[13.5px] text-slate-300 tracking-tight">{r.issueId}</span>
                      <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-slate-500">
                        <span className={`w-1.5 h-1.5 rounded-full ${r.status === "resolved" ? "bg-emerald-400" : r.status === "answered" ? "bg-amber-400" : "bg-slate-500"}`} />
                        {r.status}
                      </span>
                    </div>
                    <p className="text-[13.5px] text-slate-400 leading-relaxed line-clamp-2">{r.message}</p>
                    {r.adminReply && (
                      <blockquote className="border-l-2 border-indigo-400/40 pl-3 py-1">
                        <p className="text-[13.5px] text-indigo-100/90 leading-relaxed">{r.adminReply}</p>
                        <footer className="mt-0.5 font-mono text-[11px] text-slate-600">reply from the admin</footer>
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReportApp;