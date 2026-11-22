import type { InlineKeyboardMarkup } from "node-telegram-bot-api";
import { botLink } from "../constants/telegram.js";
import { appPageUrl } from "../constants/webapp.js";
import { escapeHtml } from "../services/text.js";
import type {
  BoardPlayer,
  BoardSection,
  GameAttempt,
  GameDuel,
  GameQuestion,
} from "./types.js";
import { boardName, publicName, QUESTION_LIMIT_MS } from "./scoring.js";

export interface Card {
  text: string;
  /** The rich-message HTML. The text is the fallback for clients that refuse it. */
  rich?: string;
  markup?: InlineKeyboardMarkup;
}

export { dayLabel, weekLabel } from "./time.js";

/** The visible clock, derived from the scoring constant. */
const QUESTION_SECONDS = Math.round(QUESTION_LIMIT_MS / 1000);

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("en-IN").format(value);

const nameCell = (player: BoardPlayer): string => escapeHtml(boardName(player));

/** A bordered table for the rich renderer. */
const richTable = (
  headers: { label: string; align: "left" | "right" }[],
  rows: string[][],
): string => {
  const head = headers
    .map((column) => `<th align="${column.align}">${column.label}</th>`)
    .join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (cell, index) => `<td align="${headers[index].align}">${cell}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table bordered striped compact><tr>${head}</tr>${body}</table>`;
};

/** A two-column label/value table, also for the rich renderer. */
const richPairs = (rows: [string, string][]): string =>
  `<table bordered striped compact>${rows
    .map(
      ([label, value]) =>
        `<tr><td>${label}</td><td align="right">${value}</td></tr>`,
    )
    .join("")}</table>`;

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
  } else if (attempt.score > 0) {
    lines.push(`Score: <b>${attempt.score}</b>`);
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
  section,
  alreadyPlayed,
}: {
  attempt: GameAttempt;
  rank: number;
  total: number;
  section: { label: string; rank: number; total: number } | null;
  alreadyPlayed: boolean;
}): Card => {
  const correct = attempt.answers.filter((answer) => answer.correct).length;
  const bonus = Math.max(0, attempt.points - attempt.score);
  const lines = ["<b>Run done</b>"];

  if (bonus > 0) {
    lines.push(
      `${correct} of ${attempt.answers.length} correct · <b>${formatNumber(
        attempt.score,
      )}</b> run score`,
      `<b>${formatNumber(
        attempt.points,
      )}</b> season points · +${formatNumber(bonus)} streak`,
    );
  } else {
    lines.push(
      `${correct} of ${attempt.answers.length} correct · <b>${formatNumber(
        attempt.points,
      )}</b> points`,
    );
  }

  const today = total <= 1 ? "First today" : `#${rank} of ${total} today`;
  const streak = attempt.streak > 1 ? ` · ${attempt.streak}-day streak` : "";
  lines.push(`${today}${streak}`);

  if (section) {
    const place =
      section.total <= 1
        ? "first this week"
        : `<b>#${section.rank}</b> of ${section.total} this week`;
    lines.push(`${escapeHtml(section.label)} · ${place}`);
  } else {
    lines.push(
      "",
      "<i>No section on record. This run counts for you only.</i>",
    );
  }

  if (alreadyPlayed) {
    lines.push("", "<i>Played today. Back tomorrow.</i>");
  }

  const rows: [string, string][] = [
    ["Correct", `${correct} of ${attempt.answers.length}`],
  ];
  if (bonus > 0) {
    rows.push(
      ["Run score", `<b>${formatNumber(attempt.score)}</b>`],
      ["Season points", `<b>${formatNumber(attempt.points)}</b>`],
      ["Streak bonus", `+${formatNumber(bonus)} · ${attempt.streak} days`],
    );
  } else {
    rows.push(["Points", `<b>${formatNumber(attempt.points)}</b>`]);
    if (attempt.streak > 1) rows.push(["Streak", `${attempt.streak} days`]);
  }
  rows.push(["Today", total <= 1 ? "First" : `<b>#${rank}</b> of ${total}`]);
  if (section) {
    rows.push([
      "Section",
      `${escapeHtml(section.label)} · ${
        section.total <= 1
          ? "first this week"
          : `<b>#${section.rank}</b> of ${section.total} this week`
      }`,
    ]);
  }

  const rich = [
    "<p><b>Run done</b></p>",
    richPairs(rows),
    section
      ? ""
      : "<p><i>No section on record. This run counts for you only.</i></p>",
    alreadyPlayed ? "<p><i>Played today. Back tomorrow.</i></p>" : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    text: lines.join("\n"),
    rich,
    markup: {
      inline_keyboard: [
        [
          {
            text: "Challenge a friend",
            callback_data: `duel_new_${attempt.id}`,
          },
          {
            text: "Weekly board",
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
  const shareText = `I scored ${duel.challengerScore} on today's run. Can you beat it?`;
  const shareUrl =
    `https://t.me/share/url?url=${encodeURIComponent(link)}` +
    `&text=${encodeURIComponent(shareText)}`;

  return {
    text:
      "<b>Challenge ready</b>\n" +
      `You scored <b>${duel.challengerScore}</b> on today's run.\n` +
      "The first friend to open it gets the same questions in a different order.",
    markup: {
      inline_keyboard: [
        [
          { text: "Send challenge", url: shareUrl },
          { text: "Copy link", copy_text: { text: link } },
        ],
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
        : `You lost by ${difference}.`;

  const lines = [
    "<b>Duel result</b>",
    `You <b>${me}</b> · ${escapeHtml(themName)} <b>${them}</b>`,
    verdict,
  ];
  const rich = [
    "<p><b>Duel result</b></p>",
    richPairs([
      ["You", `<b>${me}</b>`],
      [escapeHtml(themName), `<b>${them}</b>`],
    ]),
    `<p>${verdict}</p>`,
  ].join("");

  return {
    text: lines.join("\n"),
    rich,
    markup: {
      inline_keyboard: [
        [
          { text: "Today's run", callback_data: "five_play" },
          { text: "Weekly board", callback_data: "league_show" },
        ],
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
      `You: <b>#${me.rank}</b> of ${me.players} · ${formatNumber(
        me.points,
      )} points`,
    );
  } else if (me.points === 0 && sections.length > 0) {
    lines.push("", "You haven't scored yet. Play today's run.");
  }

  if (mySection) {
    lines.push(
      `${escapeHtml(mySection.label)} · <b>#${mySection.rank}</b> of ${
        mySection.total
      }`,
    );
  }

  const sectionRows = sections
    .slice(0, 5)
    .map((section, index) => [
      String(index + 1),
      escapeHtml(section.label),
      `<b>${formatNumber(section.points)}</b>`,
    ]);
  const playerRows = players
    .slice(0, 5)
    .map((player, index) => [
      String(index + 1),
      nameCell(player),
      `<b>${formatNumber(player.points)}</b>`,
    ]);

  const meRows: [string, string][] = [];
  if (me.rank) {
    meRows.push([
      "You",
      `<b>#${me.rank}</b> of ${me.players} · ${formatNumber(me.points)} points`,
    ]);
  }
  if (mySection) {
    meRows.push([
      "Section",
      `${escapeHtml(mySection.label)} · <b>#${mySection.rank}</b> of ${
        mySection.total
      }`,
    ]);
  }

  const rich = [
    `<p><b>Section Wars</b> · ${escapeHtml(label)}</p>`,
    sections.length
      ? richTable(
          [
            { label: "#", align: "left" },
            { label: "Section", align: "left" },
            { label: "Points", align: "right" },
          ],
          sectionRows,
        )
      : "<p>No one has played this week. Be the first.</p>",
    players.length
      ? "<p><b>Players</b></p>" +
        richTable(
          [
            { label: "#", align: "left" },
            { label: "Player", align: "left" },
            { label: "Points", align: "right" },
          ],
          playerRows,
        )
      : "",
    meRows.length ? richPairs(meRows) : "",
    me.points === 0 ? "<p>You haven't scored yet. Play today's run.</p>" : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    text: lines.join("\n"),
    rich,
    markup: {
      inline_keyboard: [
        [{ text: "Play today's run", callback_data: "five_play" }],
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
    lines.push("", "Turn today's run into a challenge.");
    keyboard.push([
      { text: "Challenge a friend", callback_data: `duel_new_${attemptId}` },
    ]);
  } else {
    lines.push("", "Finish today's run first, then challenge a friend.");
  }
  keyboard.push([{ text: "Play today's run", callback_data: "five_play" }]);

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

/** How many rows each live-board table shows. The channel is a podium; the
 * full list lives on the leaderboard page the button opens. */
export const LIVE_BOARD_ROWS = 3;

/**
 * The channel's one live board: this week's students and sections.
 *
 * Rendered as a rich message with two real tables, with the text card as the
 * fallback for a client that refuses rich. `updatedAt` is the IST clock of
 * the last data change, not the clock now, so an unchanged board can sit
 * untouched and still say when it last moved.
 */
export const liveBoardCard = ({
  label,
  players,
  sections,
  updatedAt,
}: {
  label: string;
  players: BoardPlayer[];
  sections: BoardSection[];
  updatedAt: string;
}): Card => {
  const playerRows = players.slice(0, LIVE_BOARD_ROWS);
  const sectionRows = sections.slice(0, LIVE_BOARD_ROWS);
  const empty = playerRows.length === 0 && sectionRows.length === 0;

  const richPlayers =
    playerRows.length > 0
      ? richTable(
          [
            { label: "#", align: "left" },
            { label: "Player", align: "left" },
            { label: "Points", align: "right" },
          ],
          playerRows.map((player, index) => [
            String(index + 1),
            nameCell(player),
            `<b>${formatNumber(player.points)}</b>`,
          ]),
        )
      : "<p>No one has scored this week yet.</p>";

  const richSections =
    sectionRows.length > 0
      ? richTable(
          [
            { label: "#", align: "left" },
            { label: "Section", align: "left" },
            { label: "Points", align: "right" },
          ],
          sectionRows.map((section, index) => [
            String(index + 1),
            escapeHtml(section.label),
            `<b>${formatNumber(section.points)}</b>`,
          ]),
        )
      : "<p>No section has scored this week yet.</p>";

  const title = `<p><b>Weekly board · ${escapeHtml(label)}</b></p>`;

  const rich = empty
    ? [title, "<p>No one has played this week yet. Be the first.</p>"].join(
        "\n",
      )
    : [
        title,
        "<p><b>Students</b></p>",
        richPlayers,
        "<p><b>Sections</b></p>",
        richSections,
        `<footer>Updated ${updatedAt} IST · Top 3 shown · Top 10 verified players per section count.</footer>`,
      ].join("\n");

  const text = empty
    ? [
        `<b>Weekly board · ${escapeHtml(label)}</b>`,
        "",
        "No one has played this week yet. Be the first.",
      ].join("\n")
    : [
        `<b>Weekly board · ${escapeHtml(label)}</b>`,
        "",
        "<b>Students</b>",
        ...playerRows.map(
          (player, index) =>
            `${index + 1}. ${nameCell(player)} — <b>${formatNumber(
              player.points,
            )}</b>`,
        ),
        ...(playerRows.length === 0
          ? ["No one has scored this week yet."]
          : []),
        "",
        "<b>Sections</b>",
        ...sectionRows.map(
          (section, index) =>
            `${index + 1}. ${escapeHtml(section.label)} — <b>${formatNumber(
              section.points,
            )}</b>`,
        ),
        ...(sectionRows.length === 0
          ? ["No section has scored this week yet."]
          : []),
        "",
        `Updated ${updatedAt} IST · Top 3 shown · Top 10 verified players per section count.`,
      ].join("\n");

  return {
    text,
    rich,
    markup: {
      inline_keyboard: [
        [{ text: "Play today's run", url: botLink("quiz") }],
        [
          // A channel takes no web_app buttons, so these are the direct links
          // that open the Mini App pages.
          { text: "Full leaderboard", url: appPageUrl("games", "direct") },
          { text: "Verify roll", url: appPageUrl("verify", "direct") },
        ],
      ],
    },
  };
};
