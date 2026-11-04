import { useEffect, useState } from "react";
import { getMe, type MyRank, type RankInfo } from "./api";
import { useTelegramIdentity } from "./useTelegramIdentity";

interface TelegramUser {
  myRoll: string | null;
  myRank: MyRank | null;
  /** How the server resolved this caller: a saved roll or a past lookup. */
  source: "registered" | "lookup" | null;
}

const rankInfo = (raw: unknown): RankInfo | null => {
  if (!raw || typeof raw !== "object") return null;
  const info = raw as Partial<RankInfo>;
  if (typeof info.rank !== "number") return null;
  return {
    rank: info.rank,
    total: typeof info.total === "number" ? info.total : 0,
    value: typeof info.value === "number" ? info.value : null,
  };
};

/**
 * "You are #N" — resolves the Telegram user to their roll + global ranks.
 * The signed initData travels in the identity header; without it the server
 * rejects the call in production. The dev userId fallback is only used when
 * no real initData is present, and only in development.
 */
export const useTelegramUser = (): TelegramUser => {
  const { tgUser, initData } = useTelegramIdentity();
  const [myRoll, setMyRoll] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<MyRank | null>(null);
  const [source, setSource] = useState<"registered" | "lookup" | null>(null);

  useEffect(() => {
    if (!tgUser) return;
    setSource(null);

    getMe({ userId: tgUser, initData })
      .then((d) => {
        if (!d.found) return;
        setMyRoll(d.roll_no ?? null);
        setMyRank({
          attendance: rankInfo(d.attendance),
          midmarks: rankInfo(d.midmarks),
        });
        setSource(
          d.source === "registered" || d.source === "lookup" ? d.source : null,
        );
      })
      .catch((e) => console.warn("You-are-#N lookup failed:", e));
  }, [tgUser, initData]);

  return { myRoll, myRank, source };
};
