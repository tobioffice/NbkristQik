import { useEffect, useState, useRef, useCallback } from "react";

interface StudentStat {
    roll_no: string;
    name: string | null;
    attendance_percentage: number;
    mid_marks_avg: number | null;
}

export default function Leaderboard() {
    const [stats, setStats] = useState<StudentStat[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [loading, setLoading] = useState(false);
    const [sortBy, setSortBy] = useState<"attendance" | "midmarks">("attendance");

    const observer = useRef<IntersectionObserver | null>(null);

    const fetchLeaderboard = async (pageNum: number, sort: string) => {
        if (loading && pageNum !== 1) return;

        setLoading(true);
        try {
            const baseUrl = import.meta.env.VITE_API_URL || "https://checker.tobioffice.dev";
            const response = await fetch(
                `${baseUrl}/api/leaderboard?page=${pageNum}&limit=20&sort=${sort}`
            );
            const data = await response.json();

            if (data.data.length === 0) {
                setHasMore(false);
            } else {
                setStats((prev) => (pageNum === 1 ? data.data : [...prev, ...data.data]));
            }
        } catch (error) {
            console.error("Failed to fetch leaderboard", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setPage(1);
        setStats([]);
        setHasMore(true);
        fetchLeaderboard(1, sortBy);
    }, [sortBy]);

    useEffect(() => {
        if (page > 1) {
            fetchLeaderboard(page, sortBy);
        }
    }, [page]);

    const lastElementRef = useCallback(
        (node: HTMLDivElement) => {
            if (loading) return;
            if (observer.current) observer.current.disconnect();
            observer.current = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && hasMore) {
                    setPage((prev) => prev + 1);
                }
            });
            if (node) observer.current.observe(node);
        },
        [loading, hasMore]
    );

    const first = stats[0];
    const second = stats[1];
    const third = stats[2];
    const rest = stats.slice(3);

    const renderScore = (stat: StudentStat) => (
        <div className="text-center">
            <span className={`text-2xl font-bold tracking-tight ${sortBy === "attendance" ? "text-indigo-400" : "text-emerald-400"}`}>
                {sortBy === "attendance" ? stat.attendance_percentage : stat.mid_marks_avg?.toFixed(1)}
            </span>
            <span className="text-sm text-slate-500 font-medium ml-1">
                {sortBy === "attendance" ? "%" : ""}
            </span>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                {sortBy === "attendance" ? "Attendance" : "Mid Avg"}
            </p>
        </div>
    )

    return (
        <div className="min-h-screen font-['Outfit'] bg-[#0f1014] text-slate-200 selection:bg-indigo-500/30">
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#0f1014] to-[#0f1014] pointer-events-none" />

            <div className="relative max-w-lg mx-auto p-4 md:p-6 pb-20">
                {/* Header */}
                <header className="mb-6 text-center space-y-2">
                    <h1 className="text-3xl font-bold text-white tracking-tight drop-shadow-sm">
                        Leader<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">board</span>
                    </h1>
                </header>

                {/* Toggle Tabs */}
                <div className="flex bg-slate-900/50 p-1 rounded-2xl mb-14 backdrop-blur-xl border border-white/5 shadow-xl relative z-20">
                    <button
                        onClick={() => setSortBy("attendance")}
                        className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${sortBy === "attendance"
                            ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/30"
                            : "text-slate-400 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        Attendance
                    </button>
                    <button
                        onClick={() => setSortBy("midmarks")}
                        className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${sortBy === "midmarks"
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30"
                            : "text-slate-400 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        Mid Marks
                    </button>
                </div>

                {/* PODIUM SECTION */}
                {stats.length > 0 && (
                    <div className="grid grid-cols-3 gap-3 mb-8 items-end">

                        {/* Second Place (Left) */}
                        {second && (
                            <div className="order-1 flex flex-col items-center">
                                <div className="relative w-full aspect-[3/4.5] bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/50 flex flex-col items-center justify-center p-3 shadow-lg transform hover:scale-105 transition-transform duration-300">
                                    <div className="absolute -top-3 w-8 h-8 rounded-full bg-gradient-to-b from-slate-300 to-slate-500 text-white flex items-center justify-center font-bold text-sm shadow-lg shadow-slate-500/40 ring-4 ring-[#0f1014]">
                                        2
                                    </div>
                                    <div className="mt-4 text-center w-full flex flex-col justify-between h-full">
                                        <div className="flex-1 flex items-center justify-center">
                                            <h3 className="text-slate-200 font-bold text-xs md:text-sm leading-tight line-clamp-2 px-1">
                                                {second.name || second.roll_no}
                                            </h3>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-slate-500 mb-2 font-mono">{second.roll_no}</p>
                                            {renderScore(second)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* First Place (Center - Biggest) */}
                        {first && (
                            <div className="order-2 flex flex-col items-center z-10 w-full mb-4">
                                <div className="relative w-full aspect-[3/4.5] bg-gradient-to-b from-indigo-900/40 to-slate-900/40 backdrop-blur-md rounded-2xl border border-yellow-500/30 flex flex-col items-center justify-center p-2 md:p-4 shadow-2xl shadow-yellow-500/20 transform hover:scale-105 transition-transform duration-300">
                                    <div className="absolute -top-6">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-yellow-500 blur-lg opacity-50 rounded-full"></div>
                                            <div className="relative w-14 h-14 rounded-full bg-gradient-to-b from-yellow-300 to-yellow-600 text-white flex items-center justify-center font-bold text-2xl shadow-xl shadow-yellow-500/40 ring-4 ring-[#0f1014]">
                                                1
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-8 text-center w-full flex flex-col h-full justify-between">
                                        <div className="mb-1">
                                            <span className="text-3xl drop-shadow-md">👑</span>
                                        </div>
                                        <div className="flex-grow flex items-center justify-center mb-1">
                                            <h3 className="text-white font-extrabold text-xs md:text-base leading-snug line-clamp-3 w-full break-words px-1">
                                                {first.name || first.roll_no}
                                            </h3>
                                        </div>
                                        <p className="text-[10px] md:text-xs text-slate-400 mb-2 font-mono font-medium">{first.roll_no}</p>
                                        <div className="bg-slate-900/50 rounded-xl p-1.5 md:p-2 w-full border border-white/5 shadow-inner">
                                            {renderScore(first)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Third Place (Right) */}
                        {third && (
                            <div className="order-3 flex flex-col items-center">
                                <div className="relative w-full aspect-[3/4.5] bg-slate-800/60 backdrop-blur-md rounded-2xl border border-orange-700/30 flex flex-col items-center justify-center p-3 shadow-lg transform hover:scale-105 transition-transform duration-300">
                                    <div className="absolute -top-3 w-8 h-8 rounded-full bg-gradient-to-b from-orange-300 to-orange-600 text-white flex items-center justify-center font-bold text-sm shadow-lg shadow-orange-500/40 ring-4 ring-[#0f1014]">
                                        3
                                    </div>
                                    <div className="mt-4 text-center w-full flex flex-col justify-between h-full">
                                        <div className="flex-1 flex items-center justify-center">
                                            <h3 className="text-slate-200 font-bold text-xs md:text-sm leading-tight line-clamp-2 px-1">
                                                {third.name || third.roll_no}
                                            </h3>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-slate-500 mb-2 font-mono">{third.roll_no}</p>
                                            {renderScore(third)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}    </div>
                )}

                {/* List for Rest */}
                <div className="space-y-3">
                    {rest.map((stat, index) => (
                        <div
                            key={stat.roll_no}
                            ref={index + 3 === stats.length - 1 ? lastElementRef : null}
                            className="group relative bg-slate-900/40 hover:bg-slate-800/60 backdrop-blur-md p-4 rounded-xl border border-white/5 hover:border-indigo-500/30 transition-all duration-300 flex items-center justify-between"
                        >
                            <div className="flex items-center gap-4 min-w-0">
                                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-slate-800 text-slate-500 font-bold text-sm font-mono border border-slate-700">
                                    {index + 4}
                                </div>

                                <div className="min-w-0">
                                    <h3 className="font-semibold text-slate-300 text-sm truncate">
                                        {stat.name || stat.roll_no}
                                    </h3>
                                    <p className="font-mono text-[10px] text-slate-500">
                                        {stat.roll_no}
                                    </p>
                                </div>
                            </div>

                            <div className="text-right flex-shrink-0">
                                <span className={`text-lg font-bold ${sortBy === "attendance" ? "text-indigo-400" : "text-emerald-400"}`}>
                                    {sortBy === "attendance" ? stat.attendance_percentage : stat.mid_marks_avg?.toFixed(1)}
                                </span>
                                <span className="text-xs text-slate-600 font-medium ml-0.5">%</span>
                            </div>
                        </div>
                    ))}
                </div>

                {loading && (
                    <div className="py-8 text-center">
                        <div className="inline-block w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                    </div>
                )}

                {!hasMore && stats.length > 0 && (
                    <div className="text-center py-8">
                        <p className="text-slate-600 text-sm font-medium">✨ You've reached the end ✨</p>
                    </div>
                )}

                {stats.length === 0 && !loading && (
                    <div className="text-center py-20 text-slate-500">
                        <p>No records found yet.</p>
                        <p className="text-xs mt-2">Check back later!</p>
                    </div>
                )}
            </div>
        </div>
    );
}
