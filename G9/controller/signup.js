// Controller for signup.html  →  POST /api/signup
// Table: users
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { USER_TYPES, fail } = require('./shared');

async function signup(req, res) {
  try {
    let { username, email, password, confirm_password, userType } = req.body || {};
    username = String(username || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');
    userType = String(userType || 'STUDENT').toUpperCase();

    if (username.length < 3 || username.length > 30)
      return fail(res, 400, 'Username must be 3–30 characters.', 'username');
    if (!/^[A-Za-z0-9_.-]+$/.test(username))
      return fail(res, 400, 'Username may only use letters, numbers, . _ -', 'username');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 100)
      return fail(res, 400, 'Enter a valid email address.', 'email');
    if (password.length < 8)
      return fail(res, 400, 'Password must be at least 8 characters.', 'password');
    if (password !== confirm_password)
      return fail(res, 400, 'Passwords do not match.', 'confirm_password');
    if (!USER_TYPES.includes(userType))
      return fail(res, 400, 'Invalid user type.', 'userType');

    const hash = await bcrypt.hash(password, 10);
    await db.execute(
      'INSERT INTO users (email, username, password, userType) VALUES (?, ?, ?, ?)',
      [email, username, hash, userType]
    );

    // No session is started here: the user must sign in after registering.
    res.status(201).json({ message: 'Account created. Please sign in.', redirect: 'login.html?registered=1' });
  } catch (err) {
    // Map DB unique-constraint violations to friendly field errors
    if (err.code === 'ER_DUP_ENTRY') {
      const m = err.sqlMessage || '';
      if (m.includes('uq_single_admin')) return fail(res, 409, 'An admin account already exists.', 'userType');
      if (m.includes('uq_single_mod')) return fail(res, 409, 'A moderator account already exists.', 'userType');
      if (m.includes('email')) return fail(res, 409, 'That email is already registered.', 'email');
      if (m.includes('username')) return fail(res, 409, 'That username is taken.', 'username');
    }
    console.error('signup error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { signup };