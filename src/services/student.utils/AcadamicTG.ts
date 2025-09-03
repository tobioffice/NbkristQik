import { Acadamic } from "./Acadamic";

export class AcadamicTG extends Acadamic {
  async getAttendanceMessage(): Promise<string> {
    try {
      function formatAttendanceMessage(data: any): string {
        // Header Section
        let msg =
          `<b>📊 Attendance Report</b>\n\n` +
          `🧑‍🎓 <b>ID:</b> <code>${data.rollno}</code>\n` +
          `🏫 <b>Branch:</b> <code>${data.year_branch_section}</code>\n` +
          `📈 <b>Overall:</b> <code>${data.percentage.toFixed(2)}%</code>\n` +
          `📚 <b>Classes:</b> <code>${data.totalClasses.attended}/${data.totalClasses.conducted}</code>\n\n`;

        // Subject Table Header - More compact for mobile
        msg +=
          `<pre>` +
          `SUBJ     │ ST │ATT/TOT│LAST\n` +
          `────────────────────────────\n`;

        // Process each subject
        for (const sub of data.subjects) {
          // Calculate percentage
          const percentage = (sub.attended / sub.conducted) * 100;

          // Determine status emoji
          let status = "🔴";
          if (percentage >= 60) status = "🟢";
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
        msg +=
          `────────────────────────────</pre>\n\n` +
          `<code>🟢 ≥60%  🟡 50-59%  🔴 &lt;50%</code>`;

        return msg;
      }

      const yourDataObject = await this.getAttendanceJSON();

      console.log(yourDataObject);

      if (yourDataObject === "Network Error") {
        return yourDataObject;
      } else {
        return formatAttendanceMessage(yourDataObject);
      }
    } catch (e) {
      return "<code>Something went wrong..!</code>";
    }
  }

  async getMidmarksMessage(): Promise<string> {
    try {
      function formatMidMarksMessage(data: any): string {
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
            ` ${sub.M1.toString().padStart(2)} ${sub.M2.toString().padStart(
              2
            )}` +
            ` ${sub.avarage.toString().padStart(3)}\n`;
        }

        // Close pre tag
        msg += `</pre>`;

        return msg;
      }

      const yourDataObject = await this.getMidmarksJSON();
      // Usage example:
      if (yourDataObject === "Network Error") {
        return yourDataObject;
      } else {
        return formatMidMarksMessage(yourDataObject);
      }
    } catch (e) {
      return "<code>Something went wrong..!</code>";
    }
  }
}
