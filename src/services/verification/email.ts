import nodemailer, { type Transporter } from "nodemailer";
import {
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from "../../config/environmentals.js";
import { logger } from "../../config/logger.js";

/** SMTP is not configured on this deployment. */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email verification is not configured.");
    this.name = "EmailNotConfiguredError";
  }
}

let transporter: Transporter | null = null;

const getTransport = (): Transporter => {
  if (!SMTP_USER || !SMTP_PASS) throw new EmailNotConfiguredError();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
};

/**
 * Send one verification code. The address is always built from the roll by
 * the caller, never taken from the request, so this function cannot be used
 * as an open mail relay.
 */
export const sendVerificationCode = async (
  to: string,
  code: string,
  ttlMinutes: number,
): Promise<void> => {
  const transport = getTransport();
  try {
    await transport.sendMail({
      from: SMTP_FROM,
      to,
      subject: `Your NbkristQik code: ${code}`,
      text: `Your NbkristQik verification code is ${code}.\n\nIt expires in ${ttlMinutes} minutes. If you did not ask for it, ignore this email and tell the admin.`,
      html: [
        '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1e2a38">',
        "<p>Your NbkristQik verification code is</p>",
        `<p style="font-size:28px;font-weight:700;letter-spacing:0.18em;font-variant-numeric:tabular-nums">${code}</p>`,
        `<p>It expires in ${ttlMinutes} minutes. If you did not ask for it, ignore this email and tell the admin.</p>`,
        "</div>",
      ].join(""),
    });
  } catch (e) {
    logger.error("[verify] sending the code failed:", e);
    throw e;
  }
};
