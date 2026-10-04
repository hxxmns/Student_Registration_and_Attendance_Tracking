const db = require('../database/db');
const { fail } = require('./shared');

async function loadUser(req) {
  const s = req.session && req.session.user;
  if (!s || !s.id) return null;
  const [rows] = await db.execute('SELECT id, username, userType, isRegistered FROM users WHERE id = ?', [s.id]);
  return rows[0] || null;
}

async function requireUser(req, res, next) {
  try {
    const user = await loadUser(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    req.user = user;
    next();
  } catch (err) {
    console.error('guard error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function requireStaff(req, res, next) {
  try {
    const user = await loadUser(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    if (user.userType !== 'ADMIN' && user.userType !== 'MODERATOR')
      return fail(res, 403, 'Only admins and moderators can do that.');
    req.user = user;
    next();
  } catch (err) {
    console.error('guard error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { requireUser, requireStaff };