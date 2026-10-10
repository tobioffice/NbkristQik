// Mirrors src/constants/index.ts BRANCHES (branch id -> display name).
// Kept local so the web build doesn't reach into backend source layout.
export const BRANCHES: { [key: number]: string } = {
  5: "CSE",
  23: "AI_DS",
  7: "MECH",
  4: "ECE",
  2: "EEE",
  11: "CIVIL",
  22: "IT",
  32: "CSE_DS",
  33: "CSE_AIML",
  34: "AIML",
  12: "MTech_PS",
  17: "MTech_CSE",
  18: "MTech_ECE",
  19: "MTech_AMS",
  29: "MTech_RAI",
  16: "MTech_VLSI",
  25: "MTech_AI",
  26: "MTech_AIDS",
  35: "DIP_CSE",
  36: "DIP_EEE",
  37: "DIP_ECE",
  38: "DIP_ME",
};

// GitHub Pages URLs for the two mini app pages (register is a standalone
// page, separate from the leaderboard app).
const PAGES_ROOT =
  (import.meta.env.VITE_PAGES_ROOT as string | undefined) ||
  "https://tobioffice.github.io/NbkristQik";

export const WEBAPP_URL = `${PAGES_ROOT}/index.html`;
export const PROFILE_URL = `${PAGES_ROOT}/register.html`;
export const REPORT_URL = `${PAGES_ROOT}/report.html`;