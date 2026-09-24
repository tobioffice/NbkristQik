import { Attendance, Midmarks } from "../../types/index.js";
import { Academic, AcademicError, ServerDownError, BlockedReportError, NoDataFoundError } from "./Academic.js";
import { StudentNotFoundError } from "../redis/utils.js";

/**
 * Error response with retry functionality
 */
export interface ErrorResponse {
   message: string;
   reply_markup?: {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
   };
}

/**
 * Telegram-specific Academic class with formatted message output
 */
export class AcademicTG extends Academic {
   /**
    * Gets attendance data formatted for Telegram message
    */
   async getAttendanceMessage(): Promise<string> {
      try {
         const data = await this.getAttendanceJSON();
         return AcademicTG.formatAttendanceMessage(data);
      } catch (error) {
         console.error("[AcademicTG] Attendance error:", error);
         return this.formatErrorMessage(error, "attendance");
      }
   }

   /**
    * Gets midmarks data formatted for Telegram message
    */
   /**
    * Gets bunk plan: how many classes can be skipped / must be attended
    */
   async getBunkPlanMessage(): Promise<string> {
      try {
         const data = await this.getAttendanceJSON();
         return AcademicTG.formatBunkPlanMessage(data);
      } catch (error) {
         console.error("[AcademicTG] Bunk plan error:", error);
         return this.formatErrorMessage(error, "attendance");
      }
   }

   /**
    * Gets midmarks data formatted for Telegram message
    */
   async getMidmarksMessage(): Promise<string> {
      try {
         const data = await this.getMidmarksJSON();
         return AcademicTG.formatMidmarksMessage(data);
      } catch (error) {
         console.error("[AcademicTG] Midmarks error:", error);
         return this.formatErrorMessage(error, "midmarks");
      }
   }

   /**
    * Formats error messages with helpful guidance and retry options
    */
   private formatErrorMessage(error: unknown, dataType: "attendance" | "midmarks"): string {
      const rollNo = this.rollnumber;
      const timestamp = new Date().toLocaleTimeString("en-US", {
         hour: "2-digit",
         minute: "2-digit",
         timeZone: "Asia/Kolkata"
      });

      if (error instanceof ServerDownError) {
         return this.buildServerDownMessage(dataType, timestamp);
      }

      if (error instanceof NoDataFoundError) {
         return this.buildNoDataMessage(rollNo, dataType);
      }

      if (error instanceof StudentNotFoundError) {
         return this.buildStudentNotFoundMessage(error);
      }

      if (error instanceof BlockedReportError) {
         return this.buildBlockedReportMessage();
      }

      if (error instanceof AcademicError) {
         return this.buildGenericErrorMessage(error.message, dataType, timestamp);
      }

      // Unknown error
      return this.buildUnknownErrorMessage(dataType, timestamp);
   }

   /**
    * Builds server down error message with retry guidance
    */
   private buildServerDownMessage(_dataType: string, timestamp: string): string {
      return (
         `⚠️ <b>College Server Temporarily Down</b>\n\n` +
         `🔄 <b>Status:</b> Server not responding\n` +
         `⏰ <b>Time:</b> ${timestamp}\n\n` +
         `💡 <b>What you can do:</b>\n` +
         `• Wait 5-10 minutes and try again\n` +
         `• Server usually recovers automatically\n` +
         `• Peak hours (9 AM - 5 PM) may be slower\n\n` +
         `📦 <i>Showing cached data if available...</i>\n\n` +
         `<i>Tip: Try again using your roll number</i>`
      );
   }

   /**
    * Builds no data found error message
    */
   private buildNoDataMessage(rollNo: string, dataType: string): string {
      return (
         `❌ <b>No ${dataType === "attendance" ? "Attendance" : "Mid-Marks"} Data Found</b>\n\n` +
         `🔍 <b>Roll Number:</b> <code>${rollNo}</code>\n\n` +
         `💡 <b>Please check:</b>\n` +
         `• Roll number is correct (e.g., 21B81A05E9)\n` +
         `• Data is available on college portal\n` +
         `• You're registered for this semester\n\n` +
         `<i>If issue persists, contact your faculty.</i>`
      );
   }

   /**
    * Roll number not in college records. Not framed as a typo — the roll is
    * often simply new/unloaded in the DB (e.g. fresh 1st-year batches).
    */
   private buildStudentNotFoundMessage(error: StudentNotFoundError): string {
      const { rollnumber, suggestions } = error;

      let msg =
         `❌ <b>Roll number not found</b>\n\n` +
         `<code>${rollnumber}</code> isn't in college records yet.\n` +
         `<i>New admissions sometimes take time to appear here.</i>\n\n`;

      if (suggestions.length > 0) {
         msg += `🔎 <b>Nearby rolls in records:</b>\n`;
         for (const s of suggestions) {
            msg += `• <code>${s}</code>\n`;
         }
         msg += `\nTap a suggestion and send it.\n\n`;
      }

      msg += `<i>Missing? Use /report and I'll add it.</i>`;
      return msg;
   }

   /**
    * Builds blocked report error message
    */
   private buildBlockedReportMessage(): string {
      return (
         `🚫 <b>Report Access Blocked</b>\n\n` +
         `⚠️ The college administrator has temporarily blocked access to this report.\n\n` +
         `💡 <b>What to do:</b>\n` +
         `• Contact your class coordinator\n` +
         `• Check college portal for announcements\n` +
         `• Try again in a few hours\n\n` +
         `<i>This is usually temporary during result preparation.</i>`
      );
   }

   /**
    * Builds generic error message
    */
   private buildGenericErrorMessage(message: string, dataType: string, timestamp: string): string {
      return (
         `⚠️ <b>Error Fetching ${dataType === "attendance" ? "Attendance" : "Mid-Marks"}</b>\n\n` +
         `❌ <b>Error:</b> ${message}\n` +
         `⏰ <b>Time:</b> ${timestamp}\n\n` +
         `💡 <b>Try:</b>\n` +
         `• Send your roll number again\n` +
         `• Wait a few minutes\n` +
         `• Check your internet connection\n\n` +
         `<i>If problem continues, use /report to notify admin.</i>`
      );
   }

   /**
    * Builds unknown error message
    */
   private buildUnknownErrorMessage(dataType: string, timestamp: string): string {
      return (
         `⚠️ <b>Unexpected Error</b>\n\n` +
         `❌ <b>Type:</b> Unable to fetch ${dataType}\n` +
         `⏰ <b>Time:</b> ${timestamp}\n\n` +
         `💡 <b>Troubleshooting:</b>\n` +
         `1. Try again in a few minutes\n` +
         `2. Verify your roll number is correct\n` +
         `3. Check if college portal is accessible\n\n` +
         `📝 <b>Still facing issues?</b>\n` +
         `Use /report to contact support with your roll number.\n\n` +
         `<i>We apologize for the inconvenience.</i>`
      );
   }

   /**
    * Formats attendance data into Telegram-friendly message with freshness indicator
    */
   private static formatAttendanceMessage(data: Attendance, isCached = false): string {
      const { rollno, year_branch_section, percentage, totalClasses, subjects } = data;

      // Header section with freshness indicator
      let msg =
         `🧑‍🎓 <b>ROLL:</b> <code>${rollno}</code>\n` +
         `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n` +
         `📚 <b>Attended:</b> <code>${totalClasses.attended}/${totalClasses.conducted}</code>\n\n` +
         `📈 <b>Percentage:</b> <b>${percentage.toFixed(2)}%</b>\n`;

      // Add cache indicator if data is from cache
      if (isCached) {
         msg += `📦 <i>Cached data</i>\n`;
      }

      // Progress bar
      msg += AcademicTG.buildProgressBar(percentage);

      // Subject table
      msg +=
         `<pre>` +
         `SUBJ     │ ST │ATT/TOT│LAST\n` +
         `────────────────────────────\n`;

      for (const sub of subjects) {
         const subPercentage = (sub.attended / sub.conducted) * 100;
         const status = AcademicTG.getStatusEmoji(subPercentage);
         const lastUpdated = AcademicTG.formatLastUpdated(sub.lastUpdated);
         const subjectName = AcademicTG.truncateText(sub.subject, 8);

         msg +=
            `${subjectName.padEnd(9)} │ ${status} │` +
            `${String(sub.attended).padStart(2)}/${String(sub.conducted).padStart(2)} │` +
            `${lastUpdated.padEnd(5)}\n`;
      }

      msg += `────────────────────────────</pre>\n`;
      msg += `\n<i>💡 Tip: Maintain 75%+ for good attendance</i>`;

      return msg;
   }

   /**
    * Formats midmarks data into Telegram-friendly message
    */
   private static formatMidmarksMessage(data: Midmarks, isCached = false): string {
      const { rollno, year_branch_section, subjects } = data;

      // Header section
      let msg =
         `<b>📊 Mid Marks Report</b>\n\n` +
         `🧑‍🎓 <b>ID:</b> <code>${rollno}</code>\n` +
         `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n`;

      // Add cache indicator
      if (isCached) {
         msg += `📦 <i>Cached data</i>\n`;
      }

      msg += `\n`;

      // Subject table
      msg +=
         `<pre>` +
         `SUBJECT      │ TYPE │ M1  M2  AVG\n` +
         `─────────────────────────────────\n`;

      for (const sub of subjects) {
         const subjectName = AcademicTG.truncateText(sub.subject, 11);
         const type = AcademicTG.truncateText(sub.type, 4);

         const m1 = sub.M1 ? String(sub.M1).padStart(2) : "  ";
         const m2 = sub.M2 ? String(sub.M2).padStart(2) : "  ";
         const avg = sub.average ? String(sub.average).padStart(3) : "   ";

         msg += `${subjectName.padEnd(11)} │ ${type.padEnd(4)} │ ${m1} ${m2} ${avg}\n`;
      }

      msg += `</pre>\n`;
      msg += `\n<i>💡 Tip: Focus on subjects with low averages</i>`;

      return msg;
   }

   /**
    * Builds a visual progress bar for percentage
    */
   private static buildProgressBar(percentage: number): string {
      const blocks = {
         green: "🟩",
         yellow: "🟨",
         red: "🟥",
         white: "⬜",
      };

      const filledBlocks = Math.floor(percentage / 10);
      const emptyBlocks = 10 - filledBlocks;

      let blockColor: keyof typeof blocks;
      if (percentage >= 75) {
         blockColor = "green";
      } else if (percentage >= 50) {
         blockColor = "yellow";
      } else {
         blockColor = "red";
      }

      return blocks[blockColor].repeat(filledBlocks) + blocks.white.repeat(emptyBlocks) + "\n";
   }

   /**
    * Gets status emoji based on percentage
    */
   private static getStatusEmoji(percentage: number): string {
      if (percentage >= 75) return "🟢";
      if (percentage >= 50) return "🟡";
      return "🔴";
   }

   /**
    * Formats last updated date for display
    */
   private static formatLastUpdated(dateStr: string): string {
      const trimmed = dateStr.trim();

      // If it's a date in DD-MM-YYYY format, show only DD-MM
      if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
         return trimmed.slice(0, 5);
      }

      return trimmed || "N/A";
   }

   /**
    * Truncates text to specified length with ellipsis
    */
   private static truncateText(text: string, maxLength: number): string {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 2) + "..";
   }

   /**
    * Formats bunk plan: per-subject skip/attend analysis against a 75% target
    * Math: to stay at >= TARGET after skipping X more classes (conducted grows):
    *   attended / (conducted + X) >= TARGET  →  X <= attended/TARGET - conducted
    * To recover by attending Y more classes:
    *   (attended + Y) / (conducted + Y) >= TARGET  →  Y >= (TARGET*conducted - attended) / (1 - TARGET)
    */
   private static formatBunkPlanMessage(data: Attendance): string {
      const { rollno, year_branch_section, percentage, totalClasses, subjects } = data;

      const bunk = (att: number, cond: number) => Math.floor(att / 0.75 - cond);
      const need = (att: number, cond: number) => Math.ceil((0.75 * cond - att) / 0.25);

      const overallBunk = Math.max(0, bunk(totalClasses.attended, totalClasses.conducted));
      const overallNeed = Math.max(0, need(totalClasses.attended, totalClasses.conducted));

      let msg =
         `🎯 <b>Bunk Plan for</b> <code>${rollno}</code>\n` +
         `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n` +
         `📈 <b>Current:</b> <b>${percentage.toFixed(2)}%</b> ` +
         `(${totalClasses.attended}/${totalClasses.conducted})\n\n`;

      if (overallBunk > 0) {
         msg += `🟢 <b>You can bunk ${overallBunk} more class${overallBunk !== 1 ? "es" : ""}</b> and stay at 75%+\n\n`;
      } else if (overallNeed > 0) {
         msg += `🔴 <b>Attend next ${overallNeed} class${overallNeed !== 1 ? "es" : ""}</b> to get back to 75%+\n\n`;
      } else {
         msg += `🟢 You're exactly at the limit. Attend everything.\n\n`;
      }

      msg += `<pre>`;
      msg += `SUBJ     │ NOW │ BUNK │ NEED\n`;
      msg += `──────────────────────────────\n`;

      for (const sub of subjects) {
         const name = AcademicTG.truncateText(sub.subject, 8).padEnd(8);
         const nowPct =
            sub.conducted > 0
               ? ((sub.attended / sub.conducted) * 100).toFixed(0).padStart(3)
               : "  0";
         const canBunk = sub.conducted > 0 ? Math.max(0, bunk(sub.attended, sub.conducted)) : 0;
         const mustAttend = sub.conducted > 0 ? Math.max(0, need(sub.attended, sub.conducted)) : 0;

         msg += `${name} │ ${nowPct}% │${String(canBunk).padStart(5)} │${String(mustAttend).padStart(5)}\n`;
      }
      msg += `──────────────────────────────</pre>\n\n`;

      const risky = subjects.filter(
         (s) => s.conducted > 0 && (s.attended / s.conducted) * 100 < 75
      );
      if (risky.length > 0) {
         msg +=
            `⚠️ <b>Below 75% in ${risky.length} subject${risky.length !== 1 ? "s" : ""}:</b> ` +
            risky
               .map((s) => `<code>${AcademicTG.truncateText(s.subject, 12)}</code>`)
               .join(", ") +
            `\n\n`;
      }

      msg += `<i>💡 BUNK = classes you can skip, NEED = classes to attend consecutively to reach 75%</i>`;

      return msg;
   }
}
