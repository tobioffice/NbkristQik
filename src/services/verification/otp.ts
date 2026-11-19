import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  countRecentVerifications,
  createVerification,
  findLiveVerification,
  bumpVerificationAttempts,
  consumeVerification,
  supersedeVerifications,
} from "../../db/verification.model.js";
import {
  getClaimForUser,
  getRollClaim,
  setClaimOptions,
  upsertRollClaim,
  type RollClaim,
  type RollClaimOptions,
} from "../../db/rollClaim.model.js";
import {
  deleteRegistrationsForRollExcept,
  getRegistration,
  upsertRegistration,
} from "../../db/registration.model.js";
import { getStudentCached, StudentNotFoundError } from "../redis/utils.js";
import { invalidateStudentContext } from "../library/entitlement.js";
import { turso } from "../../db/db.js";
import { ADMIN_ID, VERIFY_EMAIL_DOMAIN } from "../../config/environmentals.js";
import { ROLL_REGEX } from "../../constants/index.js";
import { logger } from "../../config/logger.js";
import { EmailNotConfiguredError, sendVerificationCode } from "./email.js";

export const CODE_TTL_SECONDS = 10 * 60;
export const RESEND_SECONDS = 60;
export const MAX_ATTEMPTS = 5;

/** A verification failure with the HTTP status the API should answer. */
export class VerificationError extends Error {
  readonly status: number;
  readonly suggestions?: string[];

  constructor(message: string, status = 400, suggestions?: string[]) {
    super(message);
    this.name = "VerificationError";
    this.status = status;
    this.suggestions = suggestions;
  }
}

const normalizeRoll = (rollNo: string): string => rollNo.trim().toUpperCase();

/** The only address a code is ever sent to. */
export const collegeEmailForRoll = (rollNo: string): string =>
  `${normalizeRoll(rollNo).toLowerCase()}@${VERIFY_EMAIL_DOMAIN}`;

const hashCode = (code: string, salt: string): string =>
  scryptSync(code, salt, 32).toString("hex");

const codesMatch = (code: string, salt: string, expected: string): boolean => {
  const actual = Buffer.from(hashCode(code, salt), "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};

/** A new six-digit code. `randomInt` is cryptographically secure. */
const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Six digits, allowing spaces so a pasted "123 456" still works. */
const normalizeCode = (code: string): string => code.replace(/\s+/g, "");

export interface VerificationState {
  verified: boolean;
  roll: string | null;
  email: string | null;
  /** At least one switch is on (kept for older clients). */
  blocked: boolean;
  hideLeaderboard: boolean;
  blockLookups: boolean;
  blockRegistration: boolean;
}

const toState = (claim: RollClaim | null): VerificationState =>
  claim
    ? {
        verified: true,
        roll: claim.roll_no,
        email: claim.email,
        blocked: claim.blocked === 1,
        hideLeaderboard: claim.hide_leaderboard === 1,
        blockLookups: claim.block_lookups === 1,
        blockRegistration: claim.block_registration === 1,
      }
    : {
        verified: false,
        roll: null,
        email: null,
        blocked: false,
        hideLeaderboard: false,
        blockLookups: false,
        blockRegistration: false,
      };

export const getVerificationState = async (
  userId: string,
): Promise<VerificationState> => toState(await getClaimForUser(userId));

/**
 * Send a code to `<roll>@nbkrist.org`. The roll must be in the college master
 * table, and a code is sent at most once a minute per account.
 */
export const startEmailVerification = async (
  userId: string,
  rollNoInput: string,
): Promise<{ email: string; expiresInSeconds: number }> => {
  const rollNo = normalizeRoll(rollNoInput);
  if (!ROLL_REGEX.test(rollNo)) {
    throw new VerificationError(
      "That roll number doesn't look right. Check it and try again.",
      400,
    );
  }

  try {
    await getStudentCached(rollNo);
  } catch (e) {
    if (e instanceof StudentNotFoundError) {
      throw new VerificationError(
        "This roll number isn't in the college records yet.",
        404,
        e.suggestions,
      );
    }
    throw e;
  }

  if ((await countRecentVerifications(userId, RESEND_SECONDS)) > 0) {
    throw new VerificationError(
      "A code was just sent. Wait a minute before asking for another.",
      429,
    );
  }
  if ((await countRecentVerifications(userId, 60 * 60)) >= 5) {
    throw new VerificationError(
      "Too many codes in the last hour. Try again later.",
      429,
    );
  }

  // The code is emailed before it is stored: a failed send must not consume
  // the one-a-minute budget with a code nobody can receive.
  const code = newCode();
  const salt = randomBytes(16).toString("hex");
  const email = collegeEmailForRoll(rollNo);
  try {
    await sendVerificationCode(email, code, CODE_TTL_SECONDS / 60);
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      throw new VerificationError("Email verification is not configured.", 503);
    }
    throw new VerificationError(
      "The code could not be sent. Try again in a minute.",
      502,
    );
  }

  await supersedeVerifications(userId, rollNo);
  await createVerification({
    userId,
    rollNo,
    email,
    salt,
    hash: hashCode(code, salt),
    ttlSeconds: CODE_TTL_SECONDS,
  });

  return { email, expiresInSeconds: CODE_TTL_SECONDS };
};

/**
 * Check the code and, when it matches, claim the roll:
 *  - the caller becomes its verified owner,
 *  - every other registration for that roll is terminated,
 *  - the caller's registration is set to the roll.
 */
export const confirmEmailVerification = async (
  userId: string,
  rollNoInput: string,
  codeInput: string,
): Promise<VerificationState> => {
  const rollNo = normalizeRoll(rollNoInput);
  const code = normalizeCode(codeInput);

  if (!/^\d{6}$/.test(code)) {
    throw new VerificationError(
      "Enter the six-digit code from the email.",
      400,
    );
  }

  const row = await findLiveVerification(userId, rollNo);
  if (!row) {
    throw new VerificationError("That code expired. Send a new one.", 400);
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new VerificationError("Too many wrong tries. Send a new code.", 429);
  }
  if (!codesMatch(code, row.code_salt, row.code_hash)) {
    await bumpVerificationAttempts(row.id);
    throw new VerificationError("That code doesn't match.", 400);
  }

  // One transaction: a crash between consuming the code and writing the
  // caller's registration would otherwise leave a claimed roll whose owner
  // has no registration — and the consumed code means no retry. The reads
  // for the invalidations stay inside so no other account is dropped on a
  // half-finished confirm.
  const existing = await getRegistration(userId);
  const tx = await turso.transaction("write");
  let removed: string[];
  try {
    await consumeVerification(row.id, tx);
    await upsertRollClaim(rollNo, userId, row.email, tx);

    // Verification proves ownership: every other account holding this roll
    // loses the registration now, not on its next edit.
    removed = await deleteRegistrationsForRollExcept(rollNo, userId, tx);

    await upsertRegistration(
      userId,
      rollNo,
      existing && existing.roll_no.toUpperCase() === rollNo
        ? existing.display_name
        : null,
      tx,
    );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
  for (const other of removed) invalidateStudentContext(other);
  invalidateStudentContext(userId);
  logger.info(
    `[verify] roll ${rollNo} claimed by user ${userId}; ${removed.length} other registration(s) removed`,
  );

  return toState(await getClaimForUser(userId));
};

/** The owner's three independent privacy switches. */
export const setVerificationOptions = async (
  userId: string,
  options: RollClaimOptions,
): Promise<VerificationState> => {
  const changed = await setClaimOptions(userId, options);
  if (!changed) {
    throw new VerificationError("Verify your college email first.", 404);
  }
  return toState(await getClaimForUser(userId));
};

/**
 * True when a verified owner asked other accounts not to fetch this roll's
 * data. The owner and the service admin see it.
 */
export const isLookupBlockedForViewer = async (
  rollNo: string,
  viewerUserId?: string | number | null,
): Promise<boolean> => {
  const claim = await getRollClaim(rollNo);
  if (!claim || claim.block_lookups !== 1) return false;
  // No viewer at all is not the owner: refuse rather than fall open.
  if (viewerUserId == null) return true;
  if (String(viewerUserId) === claim.user_id) return false;
  if (ADMIN_ID && String(viewerUserId) === String(ADMIN_ID)) return false;
  return true;
};

/**
 * True when the owner asked that only their account may register the roll.
 * With the switch off, another account may save it again; the owner's own
 * registration is not touched.
 */
export const isRegistrationBlockedFor = async (
  rollNo: string,
  userId: string,
): Promise<boolean> => {
  const claim = await getRollClaim(rollNo);
  return Boolean(
    claim && claim.block_registration === 1 && claim.user_id !== String(userId),
  );
};
