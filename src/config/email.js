const nodemailer = require('nodemailer');
const config = require('../config/env');

let transport;

const getTransport = () => {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: { user: config.email.user, pass: config.email.password },
  });
  return transport;
};

/**
 * Send an email, or print it when EMAIL_ENABLED is false.
 *
 * The console fallback means password reset works end-to-end in development
 * without SMTP credentials — the reset link is printed to the terminal.
 *
 * Never throws. A failed notification should not roll back the booking or
 * registration that triggered it.
 */
const sendEmail = async ({ to, subject, text, html }) => {
  if (!config.email.enabled) {
    console.log('\n──────── EMAIL (not sent — EMAIL_ENABLED=false) ────────');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`\n${text}`);
    console.log('────────────────────────────────────────────────────────\n');
    return { delivered: false, reason: 'email disabled' };
  }

  try {
    const info = await getTransport().sendMail({
      from: config.email.from,
      to,
      subject,
      text,
      html: html || undefined,
    });
    return { delivered: true, messageId: info.messageId };
  } catch (err) {
    // Logged, not thrown. Note the recipient is logged but never the body,
    // which may contain a reset token.
    console.error(`[email] Failed to send "${subject}" to ${to}: ${err.message}`);
    return { delivered: false, reason: err.message };
  }
};

module.exports = { sendEmail };
