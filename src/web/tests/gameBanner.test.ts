import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameBannerView } from "../src/components/GameBanner";
import type { GameLive } from "../src/api";
import { istWeekLabel } from "../src/format";
import { bannerContent, PLAY_LINK, PROFILE_LINK } from "../src/gameBanner";

/**
 * The home banner is one link with four states. Server-rendering pins the
 * words, the in-app destination and the one-control rule without a DOM; the
 * data half is a thin fetch around the same view.
 */

const live = (over: Partial<GameLive> = {}): GameLive => ({
  success: true,
  weekLabel: "Week of 17 Nov",
  me: null,
  ...over,
});

const render = (payload: GameLive | null): string =>
  renderToStaticMarkup(React.createElement(GameBannerView, { live: payload }));

describe("GameBannerView", () => {
  it("invites the open run on the in-app play screen", () => {
    const html = render(
      live({ me: { registered: true, run: { state: "open", questions: 10 } } }),
    );

    expect(html).toContain("Section Wars");
    expect(html).toContain("run is open. 10 questions, 10 seconds each.");
    expect(html).toContain("Week of 17 Nov");
    expect(html).toMatch(/Day \d of 7/);
    expect(html).toContain(">Play<");
    expect(html).toContain(`href="${PLAY_LINK}"`);
    expect(html).not.toContain("target=");
    expect(html).not.toContain("https://t.me");
  });

  it("is one native control with a decorative icon", () => {
    const html = render(
      live({ me: { registered: true, run: { state: "open", questions: 10 } } }),
    );

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-hidden="true"');
  });

  it("offers the reader's runs, not a replay, once the run is done", () => {
    const html = render(
      live({
        me: {
          registered: true,
          run: { state: "done", questions: 10, points: 2_250 },
        },
      }),
    );

    expect(html).toContain("Run done: 2,250 points.");
    expect(html).toContain(">Your runs<");
    expect(html).toContain(`href="${PROFILE_LINK}"`);
  });

  it("resumes an active run at its question", () => {
    const html = render(
      live({
        me: {
          registered: true,
          run: { state: "playing", questions: 10, question: 4 },
        },
      }),
    );

    expect(html).toContain("Question 4 of 10 is waiting.");
    expect(html).toContain(">Resume<");
    expect(html).toContain(`href="${PLAY_LINK}"`);
  });

  it("asks for a roll before the run", () => {
    const html = render(live({ me: { registered: false, run: null } }));

    expect(html).toContain("Save your roll to play today");
    expect(html).toContain(">Play<");
    expect(html).toContain(`href="${PLAY_LINK}"`);
  });

  it("sells the run before the league answer lands", () => {
    const html = render(null);

    expect(html).toContain("run is open. 10 questions, 10 seconds each.");
    expect(html).toContain(">Play<");
    expect(html).toContain(`href="${PLAY_LINK}"`);
    // the date label paints from the clock, not from the fetch
    expect(html).toContain(istWeekLabel());
  });
});

describe("bannerContent", () => {
  it("keeps the play screen for every play state", () => {
    expect(
      bannerContent(
        live({
          me: {
            registered: true,
            run: { state: "playing", questions: 10, question: 2 },
          },
        }),
      ),
    ).toMatchObject({ href: PLAY_LINK, action: "Resume" });

    expect(
      bannerContent(
        live({
          me: { registered: true, run: { state: "open", questions: 10 } },
        }),
      ),
    ).toMatchObject({ href: PLAY_LINK, action: "Play" });
  });

  it("formats a finished run's points the way the app prints figures", () => {
    const content = bannerContent(
      live({
        me: {
          registered: true,
          run: { state: "done", questions: 10, points: 1_480 },
        },
      }),
    );

    expect(content).toMatchObject({
      href: PROFILE_LINK,
      action: "Your runs",
      line: "Run done: 1,480 points.",
    });
  });
});
