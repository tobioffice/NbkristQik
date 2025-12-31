import { Attendance, Midmarks } from "../../types/index.js";
import { Academic } from "./Academic.js";

export class AcademicTG extends Academic {
   async getAttendanceMessage(): Promise<string> {
      function formatAttendanceMessage(data: Attendance): string {
         // Header Section
         let msg =
            `🧑‍🎓 <b>ROLL:</b> <code>${data.rollno}</code>\n` +
            `🏫 <b>Branch:</b> <code>${data.year_branch_section}</code>\n` +
            `📚 <b>Attended:</b> <code>${data.totalClasses.attended}/${data.totalClasses.conducted}</code>\n\n` +
            `📈 <b>Percentage:</b> <b> ${data.percentage.toFixed(2)}%</b>\n`;

         // Subject Table Header - More compact for mobile
         const blocks = {
            green: "🟩",
            yellow: "🟨",
            red: "🟥",
            white: "⬜",
         };

         const { percentage, subjects } = data;

         const singleDigit = Math.floor(percentage / 10);

         const whiteBlocks = blocks.white.repeat(10 - singleDigit);

         msg += `${
            percentage >= 75
               ? blocks.green.repeat(singleDigit) + whiteBlocks
               : percentage >= 50
               ? blocks.yellow.repeat(singleDigit) + whiteBlocks
               : blocks.red.repeat(singleDigit) + whiteBlocks
         }`;
         msg +=
            `<pre>` +
            `SUBJ     │ ST │ATT/TOT│LAST\n` +
            `────────────────────────────\n`;

         // Process each subject
         for (const sub of subjects) {
            // Calculate percentage
            const percentage = (sub.attended / sub.conducted) * 100;

            // Determine status emoji
            let status = "🔴";
            if (percentage >= 75) status = "🟢";
            else if (percentage >= 50) status = "🟡";

            // Format last updated - more compact
            let lastUpdated = sub.lastUpdated.trim();
            if (lastUpdated.match(/^\d{2}-\d{2}-\d{4}$/)) {
               lastUpdated = lastUpdated.slice(0, 5); // Keep DD-MM
            } else if (lastUpdated === "") {
               lastUpdated = "N/A";
            }

            // Format subject with truncation - shorter for mobile
            let subjectName = sub.subject;
            if (subjectName.length > 8) {
               subjectName = subjectName.substring(0, 6) + "..";
            }

            // Format subject row with more compact spacing
            msg += `${subjectName.padEnd(9)} │ ${status} │${sub.attended
               .toString()
               .padStart(2)}/${sub.conducted
               .toString()
               .padStart(2)} │${lastUpdated.padEnd(4)}\n`;
         }

         // Close pre tag and add legend

         msg += `────────────────────────────</pre>`;

         return msg;
      }

      const yourDataObject = await this.getAttendanceJSON();

      // console.log(yourDataObject);

      if (!yourDataObject) {
         throw new Error("Unable to get attendance !");
      } else {
         return formatAttendanceMessage(yourDataObject);
      }
   }

   async getMidmarksMessage(): Promise<string> {
      function formatMidMarksMessage(data: Midmarks): string {
         // Header Section
         let msg =
            `<b>📊 Mid Marks Report</b>\n\n` +
            `🧑‍🎓 <b>ID:</b> <code>${data.rollno}</code>\n` +
            `🏫 <b>Branch:</b> <code>${data.year_branch_section}</code>\n\n`;

         // Subject Table Header
         msg +=
            `<pre>` +
            `SUBJECT      │ TYPE │ M1  M2  AVG\n` +
            `─────────────────────────────────\n`;

         // Process each subject
         for (const sub of data.subjects) {
            // Truncate long subject names
            let subjectName = sub.subject;
            if (subjectName.length > 11) {
               subjectName = subjectName.substring(0, 9) + "..";
            }

            // Format type column compactly
            let type = sub.type;
            if (type.length > 4) {
               type = type.substring(0, 3) + ".";
            }

            // Format subject row with cleaner spacing
            msg +=
               `${subjectName.padEnd(11)} │ ${type.padEnd(4)} │` +
               ` ${sub.M1 ? sub.M1.toString().padStart(2) : " "} ${
                  sub.M2 ? sub.M2.toString().padStart(2) : " "
               }` +
               ` ${sub.average ? sub.average.toString().padStart(3) : " "}\n`;
         }

         // Close pre tag
         msg += `</pre>`;

         return msg;
      }

      const yourDataObject = await this.getMidmarksJSON();
      // Usage example:
      if (!yourDataObject) {
         throw new Error("Unable to get midmarks !");
      }
      return formatMidMarksMessage(yourDataObject);
   }
}
