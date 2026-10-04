// Controller for homepage.html  →  session guard, GET /api/me, POST /api/logout
// Table: users (re-read so role/username changes show up immediately)
const db = require('../database/db');
const { fail } = require('./shared');

// Page guard: redirect to login if there's no session.
function requirePageAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login.html');
  next();
}

// API guard: 401 JSON if there's no session.
function requireApiAuth(req, res, next) {
  if (!req.session.user) return fail(res, 401, 'Not logged in.');
  next();
}

async function me(req, res) {
  try {
    const [rows] = await db.execute(
      'SELECT id, username, email, userType, isRegistered FROM users WHERE id = ?',
      [req.session.user.id]
    );
    if (!rows[0]) return req.session.destroy(() => fail(res, 401, 'Account no longer exists.'));
    res.json(rows[0]);
  } catch (err) {
    console.error('me error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

function logout(req, res) {
  req.session.destroy(() => res.json({ message: 'Logged out.', redirect: 'login.html' }));
}

module.exports = { requirePageAuth, requireApiAuth, me, logout };