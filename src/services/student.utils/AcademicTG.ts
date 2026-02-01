import { Attendance, Midmarks } from "../../types/index.js";
import { Academic, AcademicError } from "./Academic.js";

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
         if (error instanceof AcademicError) {
            return `⚠️ <b>Error:</b> ${error.message}`;
         }
         return "⚠️ <b>Error:</b> Unable to fetch attendance. Please try again later.";
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
         if (error instanceof AcademicError) {
            return `⚠️ <b>Error:</b> ${error.message}`;
         }
         return "⚠️ <b>Error:</b> Unable to fetch midmarks. Please try again later.";
      }
   }

   /**
    * Formats attendance data into Telegram-friendly message
    */
   private static formatAttendanceMessage(data: Attendance): string {
      const { rollno, year_branch_section, percentage, totalClasses, subjects } = data;

      // Header section
      let msg =
         `🧑‍🎓 <b>ROLL:</b> <code>${rollno}</code>\n` +
         `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n` +
         `📚 <b>Attended:</b> <code>${totalClasses.attended}/${totalClasses.conducted}</code>\n\n` +
         `📈 <b>Percentage:</b> <b>${percentage.toFixed(2)}%</b>\n`;

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

      msg += `────────────────────────────</pre>`;

      return msg;
   }

   /**
    * Formats midmarks data into Telegram-friendly message
    */
   private static formatMidmarksMessage(data: Midmarks): string {
      const { rollno, year_branch_section, subjects } = data;

      // Header section
      let msg =
         `<b>📊 Mid Marks Report</b>\n\n` +
         `🧑‍🎓 <b>ID:</b> <code>${rollno}</code>\n` +
         `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n\n`;

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

      msg += `</pre>`;

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
}
