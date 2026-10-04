// Controller for login.html  →  POST /api/login
// Table: users
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { fail, startSession } = require('./shared');

const isBcryptHash = (s) => /^\$2[aby]\$\d{2}\$/.test(String(s));

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function login(req, res) {
  try {
    const { username, password, remember } = req.body || {};
    if (!username || !password) return fail(res, 400, 'Enter your username and password.');

    const [rows] = await db.execute(
      'SELECT id, username, password, userType FROM users WHERE username = ?',
      [String(username).trim()]
    );
    const user = rows[0];
    const pw = String(password);

    let ok = false;
    if (user) {
      if (isBcryptHash(user.password)) {
        ok = await bcrypt.compare(pw, user.password);
      } else if (safeEqual(pw, user.password)) {
        ok = true;
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(pw, 10), user.id]);
      }
    }
    if (!ok) return fail(res, 401, 'Invalid username or password.');

    startSession(req, user);
    if (remember) req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days

    res.json({ message: 'Logged in.', redirect: 'monitoring.html', userType: user.userType });
  } catch (err) {
    console.error('login error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { login };