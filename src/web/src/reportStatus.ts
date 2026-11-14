import type { MyReport } from "./api";

/** The status as a student reads it: a resolved thread is simply closed. */
export const reportStatusLabel = (status: MyReport["status"]): string =>
  status === "resolved" ? "closed" : status;
