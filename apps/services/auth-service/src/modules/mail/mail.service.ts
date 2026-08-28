/**
 * The deployment's outgoing mail, and its absence.
 *
 * BetweenUs is meant to be self-hosted, and a self-hosted deployment very often
 * has no mail server at all - so "cannot send" is a first-class answer here
 * rather than an error. Every caller has to handle it, and what the person on
 * screen is told is that they should ask their administrator, which is true and
 * actionable in a way "500" is not.
 *
 * The transport is built per send rather than held open. Sends are rare - a
 * forgotten password, a test from the admin panel - and a pooled connection
 * would have to be torn down and rebuilt every time the settings change, which
 * is the only other thing that ever happens to it.
 */
import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { openSecret } from '@betweenus/auth';
import { prisma, type SmtpSetting } from '@betweenus/database';
import { envOr } from '@betweenus/config';
import { createLogger, type LogLevel } from '@betweenus/logger';

const logger = createLogger('auth-service', envOr('LOG_LEVEL', 'info') as LogLevel);

/** What every screen says when the operator has not configured a mail server. */
export const NO_MAIL_MESSAGE =
  'This server cannot send email. Ask your administrator to reset your password.';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService {
  /** The stored row, or null when nobody has configured one. */
  async settings(): Promise<SmtpSetting | null> {
    return prisma.smtpSetting.findUnique({ where: { id: 'smtp' } });
  }

  /**
   * True when a send would actually be attempted. A row that exists but is
   * switched off, or one missing the two fields no SMTP session can start
   * without, is the same as no row at all.
   */
  async configured(): Promise<boolean> {
    const row = await this.settings();
    return Boolean(row?.enabled && row.host.trim() && row.fromAddress.trim());
  }

  /**
   * Sends, or says why it could not.
   *
   * Never throws. A mail server that is refusing connections must not turn a
   * password reset into a 500 - the caller decides what to do about it, and in
   * every case so far that is "tell them to ask their administrator".
   */
  async send(mail: Mail): Promise<{ ok: boolean; error?: string }> {
    const row = await this.settings();
    if (!row?.enabled || !row.host.trim() || !row.fromAddress.trim()) {
      return { ok: false, error: NO_MAIL_MESSAGE };
    }

    // A blank username means an unauthenticated relay, which is a normal shape
    // for a mail server sitting on the same private network.
    const password = row.password ? openSecret(row.password) : null;
    const transport = createTransport({
      host: row.host.trim(),
      port: row.port,
      secure: row.secure,
      ...(row.username.trim()
        ? { auth: { user: row.username.trim(), pass: password ?? '' } }
        : {}),
    });

    try {
      await transport.sendMail({
        from: row.fromName.trim()
          ? { name: row.fromName.trim(), address: row.fromAddress.trim() }
          : row.fromAddress.trim(),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      });
      return { ok: true };
    } catch (error) {
      // The host and the recipient, never the password and never the body.
      const reason = error instanceof Error ? error.message : 'Send failed';
      logger.warn('SMTP send failed', { host: row.host, reason });
      return { ok: false, error: reason };
    } finally {
      transport.close();
    }
  }
}
