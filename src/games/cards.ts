import type { InlineKeyboardMarkup } from "node-telegram-bot-api";
import { botLink } from "../constants/telegram.js";
import { escapeHtml } from "../services/text.js";
import type {
  AttemptAnswer,
  BoardPlayer,
  BoardSection,
  GameAttempt,
  GameDuel,
  GameQuestion,
} from "./types.js";
import { formatDuration, publicName, QUESTION_LIMIT_MS } from "./scoring.js";

export interface Card {
  text: string;
  markup?: InlineKeyboardMarkup;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "15 Nov" from a `YYYY-MM-DD` key. */
export const dayLabel = (dateKey: string): string => {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTHS[month - 1] ?? ""}`.trim();
};

/** "Week of 10 Nov" from the week's Monday key. */
export const weekLabel = (mondayKey: string): string =>
  `Week of ${dayLabel(mondayKey)}`;

/** The visible clock, derived from the scoring constant. */
const QUESTION_SECONDS = Math.round(QUESTION_LIMIT_MS / 1000);

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("en-IN").format(value);

const nameCell = (player: BoardPlayer): string =>
  escapeHtml(publicName(player.displayName, player.rollNo));

/** The live question, one message edited in place as the run goes. */
export const questionCard = ({
  attempt,
  question,
  index,
  duelTarget,
}: {
  attempt: GameAttempt;
  question: GameQuestion;
  index: number;
  duelTarget?: number;
}): Card => {
  const total = attempt.questionIds.length;
  const header =
    attempt.game === "duel"
      ? `Duel · Question ${index + 1} of ${total} · ${QUESTION_SECONDS}s`
      : `Question ${index + 1} of ${total} · ${QUESTION_SECONDS}s`;

  const lines = [`<b>${header}</b>`];
  if (attempt.game === "duel" && duelTarget != null) {
    lines.push(`Target: <b>${duelTarget}</b>`);
  } else {
    lines.push(`Score so far: <b>${attempt.score}</b>`);
  }
  if (index === 0) {
    lines.push(
      "",
      `<i>${QUESTION_SECONDS} seconds. Fast answers score more.</i>`,
    );
  }
  lines.push("", escapeHtml(question.prompt));

  const markup: InlineKeyboardMarkup = {
    inline_keyboard: question.options.map((option, optionIndex) => [
      {
        text: `${String.fromCharCode(65 + optionIndex)}. ${option}`,
        callback_data: `q5_${attempt.id}_${index}_${optionIndex}`,
      },
    ]),
  };

  return { text: lines.join("\n"), markup };
};

/** The finished Five, with the day rank, streak and section place. */
export const fiveResultCard = ({
  attempt,
  rank,
  total,
  week,
  section,
  alreadyPlayed,
}: {
  attempt: GameAttempt;
  rank: number;
  total: number;
  week: { points: number; rank: number | null; players: number };
  section: {
    label: string;
    rank: number;
    total: number;
    points: number;
  } | null;
  alreadyPlayed: boolean;
}): Card => {
  const correct = attempt.answers.filter((answer) => answer.correct).length;
  const bonus = Math.max(0, attempt.points - attempt.score);
  const lines = [
    "<b>Five done</b>",
    `${correct} of ${attempt.answers.length} correct · <b>${formatNumber(
      attempt.score,
    )}</b> run score`,
    `<b>${formatNumber(attempt.points)}</b> season points${
      bonus > 0 ? ` · +${formatNumber(bonus)} streak` : ""
    }`,
    `Rank <b>#${rank}</b> of ${total} today · ${attempt.streak}-day streak`,
  ];

  if (section) {
    lines.push(
      "",
      `${escapeHtml(section.label)}: <b>#${section.rank}</b> of ${
        section.total
      } this week · ${formatNumber(section.points)} points`,
    );
  } else {
    lines.push(
      "",
      "<i>Your section isn't in the college list yet, so this run counts for you only.</i>",
    );
  }

  if (week.rank) {
    lines.push(
      `You: <b>#${week.rank}</b> of ${week.players} this week · ${formatNumber(
        week.points,
      )} points`,
    );
  }

  if (alreadyPlayed) {
    lines.push("", "<i>You already played today. Come back tomorrow.</i>");
  }

  return {
    text: lines.join("\n"),
    markup: {
      inline_keyboard: [
        [
          {
            text: "Challenge a friend",
            callback_data: `duel_new_${attempt.id}`,
          },
        ],
        [
          {
            text: "This week's board",
            callback_data: "league_show",
          },
        ],
      ],
    },
  };
};

/** The share card a challenger forwards to a friend. */
export const duelInviteCard = ({ duel }: { duel: GameDuel }): Card => {
  const link = botLink(`duel_${duel.id}`);
  const shareText = `I scored ${duel.challengerScore} on today's five. Can you beat it?`;
  const shareUrl =
    `https://t.me/share/url?url=${encodeURIComponent(link)}` +
    `&text=${encodeURIComponent(shareText)}`;

  return {
    text:
      "<b>Challenge ready</b>\n" +
      `You scored <b>${duel.challengerScore}</b> on today's five. ` +
      "Send this to a friend; they get the same five questions. " +
      "The first friend to open it takes the challenge.",
    markup: {
      inline_keyboard: [
        [{ text: "Send challenge", url: shareUrl }],
        [{ text: "Copy link", copy_text: { text: link } }],
      ],
    },
  };
};

/** The result both duelists see, written from each side's point of view. */
export const duelResultCard = ({
  duel,
  userId,
}: {
  duel: GameDuel;
  userId: number;
}): Card => {
  const isChallenger = userId === duel.challengerId;
  const me = isChallenger ? duel.challengerScore : (duel.opponentScore ?? 0);
  const them = isChallenger ? (duel.opponentScore ?? 0) : duel.challengerScore;
  const themName = isChallenger
    ? publicName(duel.opponentName, duel.opponentRoll ?? "")
    : publicName(duel.challengerName, duel.challengerRoll);

  const difference = Math.abs(me - them);
  const verdict =
    me === them
      ? "It's a draw."
      : me > them
        ? `You won by ${difference}.`
        : `${themName} won by ${difference}.`;

  const lines = [
    "<b>Duel result</b>",
    `You <b>${me}</b> · ${escapeHtml(themName)} <b>${them}</b>`,
    verdict,
  ];
  if (isChallenger) lines.push("", "<i>Your challenge was accepted.</i>");

  return {
    text: lines.join("\n"),
    markup: {
      inline_keyboard: [
        [{ text: "Today's five", callback_data: "five_play" }],
        [{ text: "This week's board", callback_data: "league_show" }],
      ],
    },
  };
};

/** The weekly board as a card in the private chat. */
export const leagueCard = ({
  label,
  sections,
  players,
  me,
  mySection,
}: {
  label: string;
  sections: BoardSection[];
  players: BoardPlayer[];
  me: { points: number; rank: number | null; players: number };
  mySection: { label: string; rank: number; total: number } | null;
}): Card => {
  const lines = [`<b>Section Wars · ${label}</b>`];

  if (sections.length === 0) {
    lines.push("", "No one has played this week. Be the first.");
  } else {
    sections.slice(0, 5).forEach((section, index) => {
      lines.push(
        `${index + 1}. ${escapeHtml(section.label)} — <b>${formatNumber(
          section.points,
        )}</b>`,
      );
    });
  }

  if (players.length > 0) {
    lines.push("", "<b>Players</b>");
    players.slice(0, 5).forEach((player, index) => {
      lines.push(
        `${index + 1}. ${nameCell(player)} — ${formatNumber(player.points)}`,
      );
    });
  }

  if (me.rank) {
    lines.push(
      "",
      `You: <b>#${me.rank}</b> of ${me.players} this week · ${formatNumber(
        me.points,
      )} points`,
    );
  } else if (me.points === 0) {
    lines.push("", "You haven't scored this week. Play today's five.");
  }

  if (mySection) {
    lines.push(
      `${escapeHtml(mySection.label)}: <b>#${mySection.rank}</b> of ${
        mySection.total
      } this week`,
    );
  }

  return {
    text: lines.join("\n"),
    markup: {
      inline_keyboard: [
        [{ text: "Play today's five", callback_data: "five_play" }],
      ],
    },
  };
};

/** The duel record, plus a way to start a challenge from today's run. */
export const duelRecordCard = ({
  record,
  attemptId,
}: {
  record: { wins: number; losses: number; draws: number };
  attemptId: number | null;
}): Card => {
  const lines = [
    "<b>Your duels</b>",
    `${record.wins} ${record.wins === 1 ? "win" : "wins"} · ` +
      `${record.losses} ${record.losses === 1 ? "loss" : "losses"} · ` +
      `${record.draws} ${record.draws === 1 ? "draw" : "draws"}`,
  ];

  const keyboard: InlineKeyboardMarkup["inline_keyboard"] = [];
  if (attemptId) {
    lines.push("", "Turn today's five into a challenge.");
    keyboard.push([
      { text: "Challenge a friend", callback_data: `duel_new_${attemptId}` },
    ]);
  } else {
    lines.push("", "Finish today's five first, then challenge a friend.");
  }
  keyboard.push([{ text: "Play today's five", callback_data: "five_play" }]);

  return { text: lines.join("\n"), markup: { inline_keyboard: keyboard } };
};

/** A group's "this one is private" card. */
export const privateLinkCard = ({
  text,
  payload,
  label,
}: {
  text: string;
  payload: string;
  label: string;
}): Card => ({
  text,
  markup: {
    inline_keyboard: [[{ text: label, url: botLink(payload) }]],
  },
});

/** The 8:30am channel prompt. URL button only: channels take no callbacks. */
export const morningPost = (label: string): Card => ({
  text:
    "<b>Five questions. About a minute.</b>\n" +
    `${label} · today's set is live.`,
  markup: {
    inline_keyboard: [[{ text: "Play today's five", url: botLink("five") }]],
  },
});

/** The lunchtime channel result. */
export const resultsPost = ({
  label,
  top,
  played,
  fastestMs,
  section,
}: {
  label: string;
  top: BoardPlayer[];
  played: number;
  fastestMs: number | null;
  section: BoardSection | null;
}): Card => {
  const lines = [`<b>Today's five · ${label}</b>`, `${played} played`];

  top.slice(0, 3).forEach((player, index) => {
    lines.push(`${index + 1}. ${nameCell(player)} — <b>${player.points}</b>`);
  });

  if (fastestMs != null) {
    lines.push("", `Fastest answer: <b>${formatDuration(fastestMs)}</b>`);
  }
  if (section) {
    lines.push(`Section of the day: <b>${escapeHtml(section.label)}</b>`);
  }
  lines.push("", "Tomorrow's set drops at 8:30am.");

  return {
    text: lines.join("\n"),
    markup: {
      inline_keyboard: [
        [
          { text: "See the board", url: botLink("league") },
          { text: "Play today's five", url: botLink("five") },
        ],
      ],
    },
  };
};

/** The Sunday channel result. */
export const weeklyPost = ({
  label,
  sections,
  players,
}: {
  label: string;
  sections: BoardSection[];
  players: BoardPlayer[];
}): Card => {
  const lines = [`<b>Section Wars · ${label}</b>`];

  sections.slice(0, 3).forEach((section, index) => {
    lines.push(
      `${index + 1}. ${escapeHtml(section.label)} — <b>${formatNumber(
        section.points,
      )}</b>`,
    );
  });

  const champion = players[0];
  if (champion) {
    lines.push(
      "",
      `Player of the week: <b>${nameCell(champion)}</b> — ${formatNumber(
        champion.points,
      )} points`,
    );
  }
  lines.push("", "A new week starts Monday. Top 10 players per section count.");

  return {
    text: lines.join("\n"),
    markup: {
      inline_keyboard: [
        [
          { text: "See the board", url: botLink("league") },
          { text: "Play today's five", url: botLink("five") },
        ],
      ],
    },
  };
};

/** The fastest correct answer in a set of finished runs. */
export const fastestCorrect = (
  answersByRun: AttemptAnswer[][],
): number | null => {
  let fastest: number | null = null;
  for (const answers of answersByRun) {
    for (const answer of answers) {
      if (!answer.correct) continue;
      if (fastest == null || answer.ms < fastest) fastest = answer.ms;
    }
  }
  return fastest;
};
