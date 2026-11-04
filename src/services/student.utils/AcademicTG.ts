import { Academic } from "./Academic.js";
import {
  AcademicError,
  ServerDownError,
  BlockedReportError,
  NoDataFoundError,
} from "./academicErrors.js";
import { StudentNotFoundError } from "../redis/utils.js";
import { logger } from "../../config/logger.js";
import {
  formatAttendanceMessage,
  formatMidmarksMessage,
  formatBunkPlanMessage,
} from "./formatters.js";
import {
  buildServerDownMessage,
  buildNoDataMessage,
  buildStudentNotFoundMessage,
  buildBlockedReportMessage,
  buildGenericErrorMessage,
  buildUnknownErrorMessage,
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
    return notice ? `<i>⚠️ ${notice}</i>\n\n${body}` : body;
  }

  /**
   * Gets attendance data formatted for Telegram message
   */
  async getAttendanceMessage(): Promise<string> {
    try {
      const data = await this.getAttendanceJSON();
      return this.withFreshnessNotice(formatAttendanceMessage(data));
    } catch (error) {
      logger.error("[AcademicTG] Attendance error:", error);
      return this.formatErrorMessage(error, "attendance");
    }
  }

  /**
   * Gets bunk plan: how many classes can be skipped / must be attended
   */
  async getBunkPlanMessage(): Promise<string> {
    try {
      const data = await this.getAttendanceJSON();
      return this.withFreshnessNotice(formatBunkPlanMessage(data));
    } catch (error) {
      logger.error("[AcademicTG] Bunk plan error:", error);
      return this.formatErrorMessage(error, "attendance");
    }
  }

  /**
   * Gets midmarks data formatted for Telegram message
   */
  async getMidmarksMessage(): Promise<string> {
    try {
      const data = await this.getMidmarksJSON();
      return this.withFreshnessNotice(formatMidmarksMessage(data));
    } catch (error) {
      logger.error("[AcademicTG] Midmarks error:", error);
      return this.formatErrorMessage(error, "midmarks");
    }
  }

  /**
   * Formats error messages with helpful guidance and retry options
   */
  private formatErrorMessage(
    error: unknown,
    dataType: "attendance" | "midmarks",
  ): string {
    const rollNo = this.rollnumber;
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

    if (error instanceof ServerDownError) {
      return buildServerDownMessage(dataType, timestamp);
    }

    if (error instanceof NoDataFoundError) {
      return buildNoDataMessage(rollNo, dataType);
    }

    if (error instanceof StudentNotFoundError) {
      return buildStudentNotFoundMessage(error);
    }

    if (error instanceof BlockedReportError) {
      return buildBlockedReportMessage();
    }

    if (error instanceof AcademicError) {
      return buildGenericErrorMessage(error.message, dataType, timestamp);
    }

    // Unknown error
    return buildUnknownErrorMessage(dataType, timestamp);
  }
}
