const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host) {
    // No SMTP configured (e.g. local dev without credentials) — fall back to a
    // console-logging transport so the app doesn't crash, but nothing is actually sent.
    transporter = {
      sendMail: async (opts) => {
        console.warn('[email] SMTP not configured — would have sent:', {
          to: opts.to,
          subject: opts.subject,
        });
        return { messageId: 'dev-noop' };
      },
    };
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.password },
  });
  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  return t.sendMail({
    from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
    to,
    subject,
    html,
    text,
  });
}

async function sendOtpEmail(toEmail, code) {
  return sendEmail({
    to: toEmail,
    subject: `${code} is your Xpatswap verification code`,
    text: `Your Xpatswap verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;background:#0E1116;color:#F4F0E8;border-radius:16px;">
        <h2 style="color:#FF6B4A;margin-bottom:4px;">Xpatswap</h2>
        <p style="font-size:14px;color:#9098A6;">Confirm your email to finish creating your account.</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#15171D;padding:16px;border-radius:12px;text-align:center;margin:20px 0;">
          ${code}
        </div>
        <p style="font-size:12px;color:#5B5F6B;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

async function sendVendorApprovedEmail(toEmail, businessName) {
  return sendEmail({
    to: toEmail,
    subject: 'Your Xpatswap vendor account has been approved 🎉',
    text: `Congratulations! ${businessName} has been approved as a verified vendor on Xpatswap. You can now list products.`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;background:#0E1116;color:#F4F0E8;border-radius:16px;">
        <h2 style="color:#9FE870;">You're approved! ✓</h2>
        <p style="font-size:14px;color:#9098A6;"><strong>${businessName}</strong> has been verified and approved to sell on Xpatswap. You can now list products from your profile.</p>
      </div>
    `,
  });
}

async function sendVendorRejectedEmail(toEmail, businessName, reason) {
  return sendEmail({
    to: toEmail,
    subject: 'Update on your Xpatswap vendor application',
    text: `We were unable to approve ${businessName} at this time. Reason: ${reason || 'See app for details.'}`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;background:#0E1116;color:#F4F0E8;border-radius:16px;">
        <h2 style="color:#FF8A7A;">Vendor application update</h2>
        <p style="font-size:14px;color:#9098A6;">We were unable to approve <strong>${businessName}</strong> at this time.</p>
        ${reason ? `<p style="font-size:13px;color:#F4F0E8;">Reason: ${reason}</p>` : ''}
        <p style="font-size:12px;color:#5B5F6B;">You can update your documents and resubmit from the app.</p>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendOtpEmail, sendVendorApprovedEmail, sendVendorRejectedEmail };
