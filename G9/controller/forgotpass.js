const crypto = require('crypto');
const db = require('../database/db');
const { sha256, fail } = require('./shared');
const { sendMail } = require('./mailer');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function forgotPassword(req, res) {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      return fail(res, 400, 'Enter a valid email address.', 'email');

    const [rows] = await db.execute('SELECT id, username FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) return fail(res, 404, 'No account is registered with that email.', 'email');

    const token = crypto.randomBytes(32).toString('hex');
    await db.execute('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
    await db.execute(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [user.id, sha256(token)]
    );

    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const link = `${base}/resetpass.html?token=${token}`;

    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log('[mail not configured] set MAIL_USER and MAIL_PASS in .env. Reset link for testing:', link);
      return fail(res, 503, 'Email sending is not set up on the server yet.');
    }

    try {
      await sendMail({
        from: `"G9 Registration System" <${process.env.MAIL_USER}>`,
        to: email,
        subject: 'Reset your G9 password',
        text:
          `Hi ${user.username},\n\n` +
          `Use this link to reset your password (valid for 1 hour):\n${link}\n\n` +
          `If you didn't ask for this, you can ignore this email.`,
        html:
          `<p>Hi ${esc(user.username)},</p>` +
          `<p>Use this link to reset your password (valid for 1 hour):</p>` +
          `<p><a href="${link}">Reset password</a></p>` +
          `<p>If you didn't ask for this, you can ignore this email.</p>`,
      });
      console.log(`[reset email sent] to ${email} | link: ${link}`);
    } catch (mailErr) {
      console.error('send mail error:', mailErr.code || '', mailErr.message);
      if (mailErr.code === 'EAUTH')
        console.error('Gmail rejected the login. MAIL_PASS must be a Gmail App Password (needs 2-Step Verification), not your normal password.');
      await db.execute('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
      return fail(res, 502, 'Could not send the email. Try again later.');
    }

    res.json({ message: `A reset link has been sent to ${email}. It expires in 1 hour.` });
  } catch (err) {
    console.error('forgot-password error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { forgotPassword };