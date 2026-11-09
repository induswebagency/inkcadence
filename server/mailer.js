'use strict';

const { log } = require('./log');

// No-op mailer unless SMTP_URL is set. Self-host works without email.
async function sendMail({ to, subject, text, html }) {
  const smtp = process.env.SMTP_URL || '';
  if (!smtp) {
    log('info', 'mail.skipped', { to, subject, reason: 'SMTP_URL not set' });
    return { ok: true, skipped: true };
  }

  // Lightweight SMTP via nodemailer when installed; otherwise log the payload.
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport(smtp);
    await transport.sendMail({
      from: process.env.MAIL_FROM || 'Inkcadence <noreply@inkcadence.local>',
      to,
      subject,
      text,
      html,
    });
    log('info', 'mail.sent', { to, subject });
    return { ok: true };
  } catch (err) {
    log('error', 'mail.failed', { to, subject, error: err.message });
    return { ok: false, error: err.message };
  }
}

function verificationEmail(username, link) {
  return {
    subject: 'Verify your Inkcadence email',
    text: 'Hi ' + username + ',\n\nVerify your email: ' + link + '\n\n— Inkcadence',
    html: '<p>Hi ' + username + ',</p><p><a href="' + link + '">Verify your email</a></p><p>— Inkcadence</p>',
  };
}

function resetEmail(username, link) {
  return {
    subject: 'Reset your Inkcadence password',
    text: 'Hi ' + username + ',\n\nReset your password: ' + link + '\n\nIf you did not ask for this, ignore the message.\n\n— Inkcadence',
    html: '<p>Hi ' + username + ',</p><p><a href="' + link + '">Reset your password</a></p><p>If you did not ask for this, ignore the message.</p><p>— Inkcadence</p>',
  };
}

module.exports = { sendMail, verificationEmail, resetEmail };
