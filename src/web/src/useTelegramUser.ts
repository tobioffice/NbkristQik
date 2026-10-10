import { useEffect, useState } from "react";
import { buildMeUrl, type MyRank } from "./api";
import { useTelegramIdentity } from "./useTelegramIdentity";

interface TelegramUser {
  myRoll: string | null;
  myRank: MyRank | null;
}

/**
 * "You are #N" — resolves the Telegram user to their roll + global ranks.
 * Sends Telegram WebApp initData so the server can verify the caller's
 * identity (HMAC-signed); without it the API rejects in production.
 */
export const useTelegramUser = (): TelegramUser => {
  const { tgUser, initData } = useTelegramIdentity();
  const [myRoll, setMyRoll] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<MyRank | null>(null);

  useEffect(() => {
    if (!tgUser) return;

    fetch(buildMeUrl(tgUser, initData))
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
      .catch((e) => console.warn("You-are-#N lookup failed:", e));
  }, [tgUser, initData]);

  return { myRoll, myRank };
};
