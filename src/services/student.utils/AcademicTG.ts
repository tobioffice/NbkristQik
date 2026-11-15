import { Academic } from "./Academic.js";
import {
  AcademicError,
  ServerDownError,
  BlockedReportError,
  NoDataFoundError,
} from "./academicErrors.js";
import { StudentNotFoundError } from "../redis/utils.js";
import type { InputRichMessage } from "node-telegram-bot-api";
import { escapeHtml } from "../text.js";
import { logger } from "../../config/logger.js";
import {
  formatAttendanceMessage,
  formatAttendanceRich,
  formatAttendanceWidget,
  formatMidmarksMessage,
  formatMidmarksRich,
  formatMidmarksWidget,
  formatBunkPlanMessage,
  formatBunkPlanRich,
  formatBunkWidget,
} from "./formatters.js";
import { widgetFits, type WidgetCard } from "./widget.js";
import {
  buildServerDownMessage,
  buildNoDataMessage,
  buildStudentNotFoundMessage,
  buildBlockedReportMessage,
  buildGenericErrorMessage,
  buildUnknownErrorMessage,
  type LookupResult,
} from "./errorMessages.js";

/**
 * Telegram-specific Academic class with formatted message output
 */
export class AcademicTG extends Academic {
  /**
   * Prints the freshness warning above the card when the numbers did not
   * come from a live portal request. A cached figure must never look fresh:
   * a student may skip a class on a stale number.
   */
  private withFreshnessNotice(body: string): string {
    const notice = this.getDataNotice();
    // The stamp rides at the foot of the card: the numbers open the card, and
    // freshness is the last thing a reader checks. The notice carries its own
    // compact marker (🕘 cached / ⚠️ offline), so a cached answer is not framed
    // as a warning.
    return notice ? `${body}\n\n<i>${notice}</i>` : body;
  }

  /**
   * The same stamp for the rich card. A paragraph keeps it a block of its
   * own; the text card's `<i>` tail would merge into the table's paragraph.
   */
  private withRichFreshness(
    body: string | InputRichMessage,
  ): string | InputRichMessage {
    const notice = this.getDataNotice();
    if (!notice) return body;
    const suffix = `<p><i>${escapeHtml(notice)}</i></p>`;
    if (typeof body === "string") return `${body}\n${suffix}`;
    return { ...body, html: `${body.html ?? ""}\n${suffix}` };
  }

  /**
   * A rich card must never cost the student the text card. If the renderer
   * trips on an unexpected portal shape, the caller keeps the HTML fallback.
   */
  private richOrUndefined(
    render: () => string | InputRichMessage,
  ): string | InputRichMessage | undefined {
    try {
      return render();
    } catch (e) {
      logger.warn(
        "[AcademicTG] rich card skipped:",
        e instanceof Error ? e.message : e,
      );
      return undefined;
    }
  }

  /**
   * A widget's chat state is capped at 1024 bytes. If the card outgrows it,
   * the text/rich card is the honest fallback.
   */
  private widgetOrUndefined(render: () => WidgetCard): WidgetCard | undefined {
    try {
      const card = render();
      return widgetFits(card.state) ? card : undefined;
    } catch (e) {
      logger.warn(
        "[AcademicTG] widget card skipped:",
        e instanceof Error ? e.message : e,
      );
      return undefined;
    }
  }

  /**
   * Gets attendance data formatted for Telegram. Text-only callers keep this
   * shape; the bot uses `getAttendanceResult` so it can carry the suggestion
   * buttons on a "roll not found" answer.
   */
  async getAttendanceMessage(): Promise<string> {
    return (await this.getAttendanceResult()).text;
  }

  /** Attendance text plus any buttons that belong with it. */
  async getAttendanceResult(): Promise<LookupResult> {
    try {
      const data = await this.getAttendanceJSON();
      return {
        text: this.withFreshnessNotice(formatAttendanceMessage(data)),
        rich: this.richOrUndefined(() =>
          this.withRichFreshness(formatAttendanceRich(data)),
        ),
        widget: this.widgetOrUndefined(() =>
          formatAttendanceWidget(data, this.getDataNotice() ?? undefined),
        ),
      };
    } catch (error) {
      logger.error("[AcademicTG] Attendance error:", error);
      return this.formatErrorResult(error, "attendance");
    }
  }

  /**
   * Gets bunk plan: how many classes can be skipped / must be attended
   */
  async getBunkPlanMessage(): Promise<string> {
    return (await this.getBunkPlanResult()).text;
  }

  /** Bunk plan text plus any buttons that belong with it. */
  async getBunkPlanResult(): Promise<LookupResult> {
    try {
      const data = await this.getAttendanceJSON();
      return {
        text: this.withFreshnessNotice(formatBunkPlanMessage(data)),
        rich: this.richOrUndefined(() =>
          this.withRichFreshness(formatBunkPlanRich(data)),
        ),
        widget: this.widgetOrUndefined(() =>
          formatBunkWidget(data, this.getDataNotice() ?? undefined),
        ),
      };
    } catch (error) {
      logger.error("[AcademicTG] Bunk plan error:", error);
      return this.formatErrorResult(error, "attendance");
    }
  }

  /**
   * Gets midmarks data formatted for Telegram
   */
  async getMidmarksMessage(): Promise<string> {
    return (await this.getMidmarksResult()).text;
  }

  /** Mid marks text plus any buttons that belong with it. */
  async getMidmarksResult(): Promise<LookupResult> {
    try {
      const data = await this.getMidmarksJSON();
      return {
        text: this.withFreshnessNotice(formatMidmarksMessage(data)),
        rich: this.richOrUndefined(() =>
          this.withRichFreshness(formatMidmarksRich(data)),
        ),
        widget: this.widgetOrUndefined(() =>
          formatMidmarksWidget(data, this.getDataNotice() ?? undefined),
        ),
      };
    } catch (error) {
      logger.error("[AcademicTG] Midmarks error:", error);
      return this.formatErrorResult(error, "midmarks");
    }
  }

  /**
   * Formats error messages with helpful guidance and retry options.
   *
   * Returns a `LookupResult` because "roll not found" carries tappable
   * suggestions; every other error is text-only.
   */
  private formatErrorResult(
    error: unknown,
    dataType: "attendance" | "midmarks",
  ): LookupResult {
    const rollNo = this.rollnumber;
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

    if (error instanceof ServerDownError) {
      return { text: buildServerDownMessage(dataType, timestamp) };
    }

    if (error instanceof NoDataFoundError) {
      return { text: buildNoDataMessage(rollNo, dataType) };
    }

    if (error instanceof StudentNotFoundError) {
      return buildStudentNotFoundMessage(error);
    }

    if (error instanceof BlockedReportError) {
      return { text: buildBlockedReportMessage() };
    }

    if (error instanceof AcademicError) {
      return {
        text: buildGenericErrorMessage(error.message, dataType, timestamp),
      };
    }

    // Unknown error
    return { text: buildUnknownErrorMessage(dataType, timestamp) };
  }
}
