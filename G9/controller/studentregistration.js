const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { fail } = require('./shared');
const { sendMail } = require('./mailer');

function manilaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = {};
  parts.forEach((p) => { v[p.type] = p.value; });
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}

const NAME_RE = /^[\p{L}][\p{L}\s.'-]*$/u;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sessionUserId(req) {
  const s = req.session || {};
  return s.userId || s.user_id || s.uid || (s.user && (s.user.id || s.user.userId)) || null;
}

async function loadUser(req) {
  const id = sessionUserId(req);
  if (!id) return null;
  const [rows] = await db.execute('SELECT id, username, email, userType, isRegistered FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

function dupKey(err) {
  const m = /for key '([^']+)'/.exec(String(err.sqlMessage || ''));
  return m ? m[1] : '';
}

function courseProblem(course) {
  if (course.length > 100) return 'Course name must be 100 characters or fewer.';
  const words = course.split(/\s+/);
  if (words.length < 3) return 'Write the full course name, for example Bachelor of Science in Information Technology.';
  const abbreviated = words.some((w) => /^[A-Z]{2,}$/.test(w.replace(/[(),]/g, '')) || w.includes('.'));
  if (abbreviated) return 'Do not abbreviate the course. Write the full name.';
  return null;
}

async function guardRegistrationPage(req, res, next) {
  try {
    const user = await loadUser(req);
    if (user && user.userType === 'STUDENT' && user.isRegistered) return res.redirect('/monitoring.html');
  } catch (err) {
    console.error('registration page guard error:', err);
  }
  next();
}

async function studentStatus(req, res) {
  try {
    const user = await loadUser(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    res.json({ username: user.username, email: user.email, userType: user.userType, isRegistered: !!user.isRegistered });
  } catch (err) {
    console.error('student status error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function registerStudent(req, res) {
  let isStaff = false;
  let createdUserId = null;
  let createdStudentId = null;
  try {
    const user = await loadUser(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    isStaff = user.userType === 'ADMIN' || user.userType === 'MODERATOR';
    if (!isStaff && user.userType !== 'STUDENT') return fail(res, 403, 'Your account cannot register students.');
    if (!isStaff && user.isRegistered) return fail(res, 409, 'Your registration is already on file.');

    let { studentID, fname, lname, email, course, yrAndSec, profile } = req.body || {};
    studentID = String(studentID || '').trim().toUpperCase();
    fname = String(fname || '').trim().replace(/\s+/g, ' ');
    lname = String(lname || '').trim().replace(/\s+/g, ' ');
    email = isStaff ? String(email || '').trim().toLowerCase() : String(user.email || '').trim().toLowerCase();
    course = String(course || '').trim().replace(/\s+/g, ' ');
    yrAndSec = String(yrAndSec || '').trim().toUpperCase();

    if (!/^[A-Z0-9-]{5,15}$/.test(studentID))
      return fail(res, 400, 'Student number must be 5–15 letters, numbers or dashes.', 'studentID');
    if (fname.length < 1 || fname.length > 30 || !NAME_RE.test(fname))
      return fail(res, 400, 'Enter a valid first name (up to 30 letters).', 'fname');
    if (lname.length < 1 || lname.length > 30 || !NAME_RE.test(lname))
      return fail(res, 400, 'Enter a valid last name (up to 30 letters).', 'lname');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 100)
      return fail(res, 400, 'Enter a valid email address.', 'email');
    const cp = courseProblem(course);
    if (cp) return fail(res, 400, cp, 'course');
    if (!/^[1-6]-[A-Z0-9]{1,3}$/.test(yrAndSec))
      return fail(res, 400, 'Choose a year level and enter a section (up to 3 characters).', 'yrAndSec');

    let photo = null;
    if (profile) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(profile));
      if (!m) return fail(res, 400, 'Profile photo must be a JPEG image.', 'profile');
      photo = Buffer.from(m[1], 'base64');
      if (photo.length > 1000000 || photo[0] !== 0xff || photo[1] !== 0xd8)
        return fail(res, 400, 'Profile photo is invalid or larger than 1 MB.', 'profile');
    }

    let ownerId = user.id;
    let linkedName = '';
    let created = false;
    let defaultPassword = '';

    if (isStaff) {
      const [taken] = await db.execute('SELECT id FROM students WHERE studentID = ?', [studentID]);
      if (taken.length) return fail(res, 409, 'That student number is already registered.', 'studentID');

      const [found] = await db.execute(
        'SELECT id, username, userType, isRegistered FROM users WHERE email = ?',
        [email]
      );
      const existing = found[0];
      if (existing) {
        if (existing.userType !== 'STUDENT')
          return fail(res, 409, "That email belongs to a staff account. Use the student's own email.", 'email');
        if (existing.isRegistered)
          return fail(res, 409, 'That email already has a registered student.', 'email');
        ownerId = existing.id;
        linkedName = existing.username;
      } else {
        defaultPassword = 'student' + studentID;
        const hash = await bcrypt.hash(defaultPassword, 10);
        try {
          const [u] = await db.execute(
            'INSERT INTO users (email, username, password, userType, isRegistered) VALUES (?, ?, ?, ?, TRUE)',
            [email, studentID, hash, 'STUDENT']
          );
          createdUserId = u.insertId;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') {
            if (dupKey(e).includes('email')) return fail(res, 409, 'That email already has an account.', 'email');
            return fail(res, 409, `An account named "${studentID}" already exists. If it belongs to this student, use that account's email.`, 'studentID');
          }
          throw e;
        }
        ownerId = createdUserId;
        created = true;
      }
    }

    const [result] = await db.execute(
      'INSERT INTO students (studentID, fname, lname, email, course, yrAndSec, profile, dateRegistered, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [studentID, fname, lname, email, course, yrAndSec, photo, manilaNow(), ownerId]
    );
    createdStudentId = result.insertId;

    if (!created) await db.execute('UPDATE users SET isRegistered = TRUE WHERE id = ?', [ownerId]);

    if (!isStaff) return res.status(201).json({ message: 'Registration complete.', redirect: 'monitoring.html' });

    if (!created) {
      return res.status(201).json({
        message: `Student registered and linked to the existing account "${linkedName}".`,
        staff: true,
        account: { username: linkedName, created: false },
      });
    }

    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

    let emailed = false;
    try {
      if (!process.env.MAIL_USER || !process.env.MAIL_PASS) throw new Error('mail is not configured');
      await sendMail({
        from: `"G9 Registration System" <${process.env.MAIL_USER}>`,
        to: email,
        subject: 'Your G9 student account',
        text:
          `Hi ${fname},\n\n` +
          `Your student registration is complete and an account was created for you.\n\n` +
          `Username: ${studentID}\n` +
          `Password: ${defaultPassword}\n\n` +
          `Sign in at ${base}/login.html. To choose your own password, use "Forgot password" on the sign-in page.`,
        html:
          `<p>Hi ${esc(fname)},</p>` +
          `<p>Your student registration is complete and an account was created for you.</p>` +
          `<p><b>Username:</b> ${esc(studentID)}<br><b>Password:</b> ${esc(defaultPassword)}</p>` +
          `<p><a href="${base}/login.html">Sign in</a>. To choose your own password, use "Forgot password" on the sign-in page.</p>`,
      });
      emailed = true;
    } catch (mailErr) {
      console.error('student account email error:', mailErr.code || '', mailErr.message);
    }

    return res.status(201).json({
      staff: true,
      emailed,
      account: { username: studentID, password: defaultPassword, created: true },
      message: emailed
        ? `Student registered. Login created and emailed to ${email}.`
        : 'Student registered. Login created, but the email could not be sent.',
    });
  } catch (err) {
    if (createdStudentId) {
      try { await db.execute('DELETE FROM students WHERE id = ?', [createdStudentId]); }
      catch (e) { console.error('could not undo the student record:', e); }
    }
    if (createdUserId) {
      try { await db.execute('DELETE FROM users WHERE id = ?', [createdUserId]); }
      catch (e) { console.error('could not undo the new account:', e); }
    }
    if (err.code === 'ER_DUP_ENTRY') {
      const key = dupKey(err);
      if (key.includes('uq_students_user')) {
        return isStaff
          ? fail(res, 409, 'That account already has a student registered.', 'email')
          : fail(res, 409, 'Your registration is already on file.');
      }
      if (key.includes('email')) return fail(res, 409, 'Another student already uses that email.', 'email');
      return fail(res, 409, 'That student number is already registered.', 'studentID');
    }
    console.error('register student error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { registerStudent, studentStatus, guardRegistrationPage };