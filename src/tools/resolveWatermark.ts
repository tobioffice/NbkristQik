#!/usr/bin/env node
/**
 * Resolves a watermark token back to the student it belongs to.
 *
 *   node dist/tools/resolveWatermark.js NBK-7F3A-2C19     # a token off a page
 *   node dist/tools/resolveWatermark.js --user 123456789  # the token of a user
 *
 * The token printed on every page is opaque to the student, but it is
 * recorded with each read, so a page that turns up in the wrong hands can be
 * traced to one Telegram account.
 */
import { logger } from "../config/logger.js";
import { initDatabase } from "../db/init.js";
import { findReadsByToken } from "../db/library.model.js";
import { getRegistration } from "../db/registration.model.js";
import { getStudent } from "../db/student.model.js";
import { watermarkToken } from "../services/library/watermark.js";

const main = async () => {
  const args = process.argv.slice(2);
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  const token = args.find((a) => !a.startsWith("--") && a !== userId);

  if (!token && !userId) {
    logger.error(
      "usage: resolveWatermark.js <token>  |  resolveWatermark.js --user <telegram id>",
    );
    process.exit(1);
  }

  await initDatabase();

  if (userId) {
    logger.info(`token for user ${userId}: ${watermarkToken(userId)}`);
    return;
  }

  const reads = await findReadsByToken(String(token));
  if (reads.length === 0) {
    logger.info(`no reads recorded for ${token}`);
    return;
  }

  for (const read of reads) {
    const registration = await getRegistration(read.user_id).catch(() => null);
    const student = registration
      ? await getStudent(registration.roll_no).catch(() => null)
      : null;
    logger.info(
      `${token} → telegram ${read.user_id}` +
        (registration ? ` · roll ${registration.roll_no}` : "") +
        (student?.name ? ` · ${student.name}` : "") +
        ` · ${read.count} page(s) of ${read.doc_id} from ${read.at}`,
    );
  }
};

main().catch((e) => {
  logger.error("[resolve] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
