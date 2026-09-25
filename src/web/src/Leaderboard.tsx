import { useEffect, useState, useRef, useCallback } from "react";
import { BRANCHES } from "../../constants/index";

interface StudentStat {
   roll_no: string;
   name: string | null;
   attendance_percentage: number;
   mid_marks_avg: number | null;
   rank: number;
}

export default function Leaderboard() {
   const [stats, setStats] = useState<StudentStat[]>([]);
   const [page, setPage] = useState(1);
   const [hasMore, setHasMore] = useState(true);
   const [loading, setLoading] = useState(false);
   const [initialLoading, setInitialLoading] = useState(true);
   const [error, setError] = useState(false);
   const [total, setTotal] = useState(0);
   const [sortBy, setSortBy] = useState<"attendance" | "midmarks">("attendance");
   const [filterYear, setFilterYear] = useState<string>("all");
   const [filterBranch, setFilterBranch] = useState<string>("all");
   const [filterSection, setFilterSection] = useState<string>("all");
   const [searchInput, setSearchInput] = useState("");
   const [search, setSearch] = useState("");
   const [myRoll, setMyRoll] = useState<string | null>(null);
   const [myRank, setMyRank] = useState<{ attendance: number | null; midmarks: number | null } | null>(null);

    const observer = useRef<IntersectionObserver | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const reqIdRef = useRef(0);

   // debounced search -> triggers refetch via effect deps
   useEffect(() => {
      const t = setTimeout(() => setSearch(searchInput.trim()), 400);
      return () => clearTimeout(t);
   }, [searchInput]);

   // "You are #N" — resolve telegram user -> their roll + global ranks via API
   useEffect(() => {
      try {
         const tg = (window as any).Telegram?.WebApp;
         const tgUser = tg?.initDataUnsafe?.user?.id;
         if (!tgUser) return;

         const baseUrl =
            import.meta.env.VITE_API_URL || "https://checker.tobioffice.dev";
         fetch(`${baseUrl}/api/me?userId=${tgUser}`)
            .then((r) => r.json())
            .then((d) => {
               if (d.found) {
                  setMyRoll(d.roll_no);
                  setMyRank({
                     attendance: d.attendance?.rank ?? null,
                     midmarks: d.midmarks?.rank ?? null,
                  });
               }
            })
            .catch(() => {});
      } catch {
         // outside telegram webview — no "you" to find
      }
   }, []);

    const myRankNow = myRoll
       ? sortBy === "attendance"
          ? myRank?.attendance
          : myRank?.midmarks
       : null;

    const isFiltered =
       search !== "" ||
       filterYear !== "all" ||
       filterBranch !== "all" ||
       filterSection !== "all";

    const fetchLeaderboard = async (pageNum: number, sort: string) => {
       if (loading && pageNum !== 1) return;

       abortRef.current?.abort();
       const controller = new AbortController();
       abortRef.current = controller;
       const reqId = ++reqIdRef.current;
       const timeout = setTimeout(() => controller.abort(), 15000);

       setLoading(true);
       setError(false);
       try {
         const baseUrl =
            import.meta.env.VITE_API_URL || "https://checker.tobioffice.dev";
         const queryParams = new URLSearchParams({
            page: pageNum.toString(),
            limit: "20",
            sort: sort,
            year: filterYear,
            branch: filterBranch,
            section: filterSection,
         });
         if (search) queryParams.set("search", search);

          const response = await fetch(
             `${baseUrl}/api/leaderboard?${queryParams.toString()}`,
             { signal: controller.signal }
          );
          if (!response.ok) throw new Error("API error");

         const data = await response.json();
         const payload = Array.isArray(data.data)
            ? { rows: data.data, total: data.total }
            : data.data;
         setTotal(payload?.total ?? data.total ?? 0);

         const rows = payload?.rows ?? [];
         if (rows.length === 0) {
            setHasMore(false);
         } else {
            setStats((prev: StudentStat[]) =>
               pageNum === 1 ? rows : [...prev, ...rows]
            );
            setHasMore(rows.length >= 20);
         }
       } catch (err) {
          if (reqId !== reqIdRef.current) return;
          if ((err as Error)?.name === "AbortError") {
             console.error("Leaderboard request timed out", err);
          } else {
             console.error("Failed to fetch leaderboard", err);
          }
          setError(true);
       } finally {
          if (reqId !== reqIdRef.current) return;
          clearTimeout(timeout);
          setLoading(false);
          setInitialLoading(false);
       }
   };

   useEffect(() => {
      setPage(1);
      setStats([]);
      setHasMore(true);
      fetchLeaderboard(1, sortBy);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [sortBy, filterYear, filterBranch, filterSection, search]);

   useEffect(() => {
      if (page > 1) {
         fetchLeaderboard(page, sortBy);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

   const fmtScore = (stat: StudentStat) =>
      sortBy === "attendance"
         ? stat.attendance_percentage?.toFixed(2) ?? "-"
         : stat.mid_marks_avg != null
            ? stat.mid_marks_avg.toFixed(1)
            : "-";

   const renderScore = (stat: StudentStat) => (
      <div className="text-center">
         <span
            className={`text-2xl font-bold tracking-tight ${
               sortBy === "attendance" ? "text-indigo-400" : "text-emerald-400"
            }`}
         >
            {fmtScore(stat)}
         </span>
         <span className="text-sm text-slate-500 font-medium ml-1">
            {sortBy === "attendance" ? "%" : ""}
         </span>
         <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
            {sortBy === "attendance" ? "Attendance" : "Mid Avg"}
         </p>
      </div>
   );

   // tie-aware rank badge: same rank = same color
   const rankBadge = (rank: number) =>
      `w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg font-bold text-sm font-mono border ${
         rank === 1
            ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
            : rank <= 3
               ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
               : "bg-slate-800 text-slate-500 border-slate-700"
      }`;

   const iconBtn =
      "cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 rounded";

   return (
      <div className="min-h-screen font-['Outfit'] bg-[#0f1014] text-slate-200 selection:bg-indigo-500/30">
         <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#0f1014] to-[#0f1014] pointer-events-none" />

         <div className="relative max-w-lg mx-auto p-4 md:p-6 pb-20">
            {/* Header */}
            <header className="mt-8 mb-6 text-center space-y-2">
               <h1 className="text-3xl font-bold text-white tracking-tight drop-shadow-sm">
                  Leader
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                     board
                  </span>
               </h1>
               {!initialLoading && total > 0 && !error && (
                  <p className="text-xs text-slate-500">
                     {total.toLocaleString()} student{total !== 1 ? "s" : ""}
                  </p>
               )}
            </header>

            {/* Search */}
            <div className="relative mb-4">
               <input
                  type="text"
                  aria-label="Search students by name or roll number"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search your name or roll number..."
                  className="w-full bg-slate-900/50 text-slate-200 text-sm rounded-xl p-3.5 pl-10 border border-white/5 focus:outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-400/40 placeholder:text-slate-600"
               />
               <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                     <circle cx="11" cy="11" r="8" />
                     <path d="m21 21-4.3-4.3" />
                  </svg>
               </span>
               {searchInput && (
                  <button
                     onClick={() => setSearchInput("")}
                     aria-label="Clear search"
                     className={`${iconBtn} absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 p-1.5`}
                  >
                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                     </svg>
                  </button>
               )}
            </div>

             {/* You are #N banner (global rank — only when unfiltered) */}
             {myRoll && myRankNow != null && !initialLoading && !error && !isFiltered && (
               <div className="flex items-center justify-center mb-4">
                  <span className="text-xs font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-2">
                     🎯 You're #{myRankNow} of {total.toLocaleString()} · {myRoll}
                  </span>
               </div>
            )}

            {/* Toggle Tabs */}
            <div className="flex bg-slate-900/50 p-1 rounded-2xl mb-4 backdrop-blur-xl border border-white/5 shadow-xl relative z-20">
               <button
                  onClick={() => setSortBy("attendance")}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${
                     sortBy === "attendance"
                        ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/30"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
               >
                  Attendance
               </button>
               <button
                  onClick={() => setSortBy("midmarks")}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
                     sortBy === "midmarks"
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
               >
                  Mid Marks
               </button>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-3 gap-2 mb-8">
               <select
                  value={filterYear}
                  aria-label="Filter by year"
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="bg-slate-900/50 text-slate-300 text-xs md:text-sm rounded-lg p-2.5 border border-white/5 focus:outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-400/40 cursor-pointer"
               >
                  <option value="all">All Years</option>
                  <option value="11">1st Year</option>
                  <option value="21">2nd Year</option>
                  <option value="31">3rd Year</option>
                  <option value="41">4th Year</option>
               </select>

               <select
                  value={filterBranch}
                  aria-label="Filter by branch"
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="bg-slate-900/50 text-slate-300 text-xs md:text-sm rounded-lg p-2.5 border border-white/5 focus:outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-400/40 cursor-pointer"
               >
                  <option value="all">All Branches</option>
                  {Object.entries(BRANCHES).map(([id, name]) => (
                     <option key={id} value={id}>
                        {name}
                     </option>
                  ))}
               </select>

               <select
                  value={filterSection}
                  aria-label="Filter by section"
                  onChange={(e) => setFilterSection(e.target.value)}
                  className="bg-slate-900/50 text-slate-300 text-xs md:text-sm rounded-lg p-2.5 border border-white/5 focus:outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-400/40 cursor-pointer"
               >
                  <option value="all">All Sections</option>
                  <option value="-">-</option>
                  {Array.from({ length: 10 }, (_, i) =>
                     String.fromCharCode(65 + i)
                  ).map((char) => (
                     <option key={char} value={char}>
                        Section {char}
                     </option>
                  ))}
               </select>
            </div>

            {/* PODIUM SECTION (hidden when searching) */}
            {stats.length > 0 && !search && (
               <div className="grid grid-cols-3 gap-3 mb-8 items-end">
                  {/* Second Place (Left) */}
                  {second && (
                     <div className="order-1 flex flex-col items-center">
                        <div className="relative w-full aspect-[3/4.5] bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/50 flex flex-col items-center justify-center p-3 shadow-lg transform hover:scale-105 transition-transform duration-300">
                           <div className={`absolute -top-3 w-8 h-8 rounded-full bg-gradient-to-b from-slate-300 to-slate-500 text-white flex items-center justify-center font-bold text-sm shadow-lg shadow-slate-500/40 ring-4 ring-[#0f1014] ${second.rank !== 2 ? "line-through decoration-2" : ""}`}>
                              {second.rank}
                           </div>
                           <div className="mt-4 text-center w-full flex flex-col justify-between h-full">
                              <div className="flex-1 flex items-center justify-center">
                                 <h3 className="text-slate-200 font-bold text-xs md:text-sm leading-tight line-clamp-2 px-1">
                                    {second.name || second.roll_no}
                                 </h3>
                              </div>
                              <div>
                                 <p className="text-[10px] text-slate-500 mb-2 font-mono">
                                    {second.roll_no}
                                 </p>
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
                                    {first.rank}
                                 </div>
                              </div>
                           </div>
                           <div className="mt-8 text-center w-full flex flex-col h-full justify-between">
                              <div className="mb-1" aria-hidden="true">
                                 <span className="text-3xl drop-shadow-md">
                                    👑
                                 </span>
                              </div>
                              <div className="flex-grow flex items-center justify-center mb-1">
                                 <h3 className="text-white font-extrabold text-xs md:text-base leading-snug line-clamp-3 w-full break-words px-1">
                                    {first.name || first.roll_no}
                                 </h3>
                              </div>
                              <p className="text-[10px] md:text-xs text-slate-400 mb-2 font-mono font-medium">
                                 {first.roll_no}
                              </p>
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
                           <div className={`absolute -top-3 w-8 h-8 rounded-full bg-gradient-to-b from-orange-300 to-orange-600 text-white flex items-center justify-center font-bold text-sm shadow-lg shadow-orange-500/40 ring-4 ring-[#0f1014] ${third.rank !== 3 ? "line-through decoration-2" : ""}`}>
                              {third.rank}
                           </div>
                           <div className="mt-4 text-center w-full flex flex-col justify-between h-full">
                              <div className="flex-1 flex items-center justify-center">
                                 <h3 className="text-slate-200 font-bold text-xs md:text-sm leading-tight line-clamp-2 px-1">
                                    {third.name || third.roll_no}
                                 </h3>
                              </div>
                              <div>
                                 <p className="text-[10px] text-slate-500 mb-2 font-mono">
                                    {third.roll_no}
                                 </p>
                                 {renderScore(third)}
                              </div>
                           </div>
                        </div>
                     </div>
                  )}
                   {/* tie note under podium */}
                   {first && first.rank === second?.rank && (
                      <p className="col-span-3 order-4 text-center text-[11px] text-slate-500 mt-2">
                         {stats.filter((s) => s.rank === first.rank).length} students tied at #{first.rank}
                      </p>
                   )}
               </div>
            )}

            {/* Skeleton loading (first load) */}
            {initialLoading && (
               <div className="space-y-3">
                  {[...Array(6)].map((_, i) => (
                     <div
                        key={i}
                        className="bg-slate-900/40 p-4 rounded-xl border border-white/5 flex items-center justify-between animate-pulse"
                     >
                        <div className="flex items-center gap-4">
                           <div className="w-9 h-9 rounded-lg bg-slate-800"></div>
                           <div className="space-y-2">
                              <div className="h-3.5 w-32 rounded bg-slate-800"></div>
                              <div className="h-2.5 w-20 rounded bg-slate-800/70"></div>
                           </div>
                        </div>
                        <div className="h-5 w-12 rounded bg-slate-800"></div>
                     </div>
                  ))}
               </div>
            )}

            {/* Error state with retry */}
            {error && !initialLoading && (
               <div className="text-center py-16 space-y-4">
                  <p aria-hidden="true" className="text-slate-600 flex justify-center">
                     <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 12v8" />
                        <path d="M8.5 8.5a5 5 0 0 1 7 0" />
                        <path d="M5 5a10 10 0 0 1 14 0" />
                        <line x1="12" x2="12.01" y1="2" y2="2" />
                     </svg>
                  </p>
                  <p className="text-slate-400 font-medium">
                     Couldn't load the leaderboard
                  </p>
                  <button
                     onClick={() => fetchLeaderboard(1, sortBy)}
                     className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
                  >
                     Try again
                  </button>
               </div>
            )}

            {/* List (rest, or all results when searching) */}
            {!error && (
               <div className="space-y-3">
                  {(search ? stats : rest).map((stat, index) => (
                     <div
                        key={stat.roll_no}
                        ref={
                           (search ? index : index + 3) === stats.length - 1
                              ? lastElementRef
                              : null
                        }
                        className={`group relative backdrop-blur-md p-4 rounded-xl border transition-all duration-300 flex items-center justify-between ${
                           stat.roll_no === myRoll
                              ? "bg-indigo-500/15 border-indigo-400/50 shadow-lg shadow-indigo-500/10"
                              : "bg-slate-900/40 hover:bg-slate-800/60 border-white/5 hover:border-indigo-500/30"
                        }`}
                     >
                        <div className="flex items-center gap-4 min-w-0">
                           <div className={rankBadge(stat.rank)}>#{stat.rank}</div>

                           <div className="min-w-0">
                              <h3 className={`font-semibold text-sm truncate ${stat.roll_no === myRoll ? "text-white" : "text-slate-300"}`}>
                                 {stat.name || stat.roll_no}
                                 {stat.roll_no === myRoll && (
                                    <span className="ml-2 text-[10px] font-bold text-indigo-300 bg-indigo-500/20 rounded px-1.5 py-0.5 align-middle">
                                       YOU
                                    </span>
                                 )}
                              </h3>
                              <p className="font-mono text-[10px] text-slate-500">
                                 {stat.roll_no}
                              </p>
                           </div>
                        </div>

                        <div className="text-right flex-shrink-0">
                           <span
                              className={`text-lg font-bold ${
                                 sortBy === "attendance"
                                    ? "text-indigo-400"
                                    : "text-emerald-400"
                              }`}
                           >
                              {fmtScore(stat)}
                           </span>
                           <span className="text-xs text-slate-600 font-medium ml-0.5">
                              {sortBy === "attendance" ? "%" : ""}
                           </span>
                        </div>
                     </div>
                  ))}
               </div>
            )}

            {loading && !initialLoading && (
               <div className="py-8 text-center">
                  <div className="inline-block w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
               </div>
            )}

            {!hasMore && stats.length > 0 && !error && (
               <div className="text-center py-8">
                  <p className="text-slate-600 text-sm font-medium">
                     ✨ You've reached the end ✨
                  </p>
               </div>
            )}

            {stats.length === 0 && !loading && !initialLoading && !error && (
               <div className="text-center py-20 text-slate-500">
                  {search ? (
                     <>
                        <p className="text-2xl mb-2">🔍</p>
                        <p>No results for "{search}"</p>
                        <p className="text-xs mt-2 text-slate-600">
                           Try roll number or partial name
                        </p>
                     </>
                  ) : sortBy === "midmarks" ? (
                     <>
                        <p className="text-2xl mb-2">📝</p>
                        <p>No mid-marks recorded yet.</p>
                        <p className="text-xs mt-2 text-slate-600">
                           Marks appear here once faculty publishes them. Check attendance instead.
                        </p>
                     </>
                  ) : (
                     <>
                        <p>No records found yet.</p>
                        <p className="text-xs mt-2">Check back later!</p>
                     </>
                  )}
               </div>
            )}
         </div>
      </div>
   );
}