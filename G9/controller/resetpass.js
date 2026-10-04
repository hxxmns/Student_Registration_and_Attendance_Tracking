// Controller for resetpass.html  →  POST /api/reset-password
// Tables: password_resets, users
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { sha256, fail } = require('./shared');

async function resetPassword(req, res) {
  try {
    const { token, password, confirm_password } = req.body || {};
    if (String(password || '').length < 8)
      return fail(res, 400, 'Password must be at least 8 characters.', 'password');
    if (password !== confirm_password)
      return fail(res, 400, 'Passwords do not match.', 'confirm_password');

    const [rows] = await db.execute(
      'SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used = FALSE AND expires_at > NOW()',
      [sha256(String(token || ''))]
    );
    if (!rows[0]) return fail(res, 400, 'Reset link is invalid or expired.');

    const hash = await bcrypt.hash(password, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hash, rows[0].user_id]);
    await db.execute('UPDATE password_resets SET used = TRUE WHERE id = ?', [rows[0].id]);

    res.json({ message: 'Password updated.', redirect: 'login.html' });
  } catch (err) {
    console.error('reset-password error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { resetPassword };