const db = require('../database/db');
const { fail } = require('./shared');
const C = require('./attendancecalc');

const MAX_DAYS = 400;
const MAX_SET_DAYS = 62;

function parseRange(q, today) {
  const from = q.from;
  const to = q.to;
  if (!from && !to) return C.monthBounds(today);
  if (!C.isValidDate(String(from || '')) || !C.isValidDate(String(to || ''))) return { error: 'Choose a valid start and end date.' };
  if (from > to) return { error: 'The start date must be on or before the end date.' };
  if (C.daysBetween(from, to) + 1 > MAX_DAYS) return { error: `Choose a range of ${MAX_DAYS} days or fewer.` };
  return { from, to };
}

function classParams(src) {
  const course = String(src.course || '').trim().replace(/\s+/g, ' ');
  const yrAndSec = String(src.yrAndSec || '').trim().toUpperCase();
  if (!course || course.length > 100 || !yrAndSec || yrAndSec.length > 5) return null;
  return { course, yrAndSec };
}

async function loadOverrides(course, yrAndSec, from, to) {
  const [rows] = await db.execute(
    `SELECT DATE_FORMAT(dayDate, '%Y-%m-%d') AS date, course, yrAndSec, status, note
     FROM class_days
     WHERE dayDate BETWEEN ? AND ? AND (course = '' OR course = ?) AND (yrAndSec = '' OR yrAndSec = ?)`,
    [from, to, course, yrAndSec]
  );
  return rows;
}

// Dates in the range on which at least one student of the class is recorded present.
async function loadPresentDates(course, yrAndSec, from, to) {
  const [rows] = await db.execute(
    `SELECT DISTINCT DATE_FORMAT(a.attendDate, '%Y-%m-%d') AS d
     FROM attendance a JOIN students s ON s.id = a.student_id
     WHERE s.course = ? AND s.yrAndSec = ? AND a.status = 'PRESENT' AND a.attendDate BETWEEN ? AND ?`,
    [course, yrAndSec, from, to]
  );
  return new Set(rows.map((r) => r.d));
}

const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

async function myLog(req, res) {
  try {
    if (req.user.userType !== 'STUDENT')
      return fail(res, 403, 'Only student accounts have a personal attendance log.');

    const [st] = await db.execute(
      `SELECT id, studentID, fname, lname, course, yrAndSec, DATE_FORMAT(dateRegistered, '%Y-%m-%d') AS joined
       FROM students WHERE userId = ?`,
      [req.user.id]
    );
    const s = st[0];
    if (!s) {
      return fail(res, 404, req.user.isRegistered
        ? 'Your account is not linked to a student record yet. Ask an admin to link it.'
        : 'Complete your student registration to see your attendance.', 'record');
    }

    const today = C.manilaNow().date;
    const range = parseRange(req.query, today);
    if (range.error) return fail(res, 400, range.error);

    let overallFrom = s.joined <= today ? s.joined : today;
    const floor = C.addDays(today, -1830);
    if (overallFrom < floor) overallFrom = floor;

    const lo = minDate(range.from, overallFrom);
    const hi = maxDate(range.to, today);

    const overrides = await loadOverrides(s.course, s.yrAndSec, lo, hi);
    const presentDates = await loadPresentDates(s.course, s.yrAndSec, lo, hi);
    const [att] = await db.execute(
      `SELECT DATE_FORMAT(attendDate, '%Y-%m-%d') AS d, TIME_FORMAT(timeIn, '%H:%i:%s') AS t
       FROM attendance WHERE student_id = ? AND attendDate BETWEEN ? AND ?`,
      [s.id, lo, hi]
    );
    const attended = new Map(att.map((r) => [r.d, r.t]));

    const view = C.studentDays(C.classInfos(range.from, range.to, overrides, presentDates), { joined: s.joined, today, attended });
    const overall = C.studentDays(C.classInfos(overallFrom, today, overrides, presentDates), { joined: s.joined, today, attended });

    res.json({
      today,
      joined: s.joined,
      student: { studentID: s.studentID, fname: s.fname, lname: s.lname, course: s.course, yrAndSec: s.yrAndSec },
      from: range.from,
      to: range.to,
      days: view.days,
      summary: view.summary,
      overall: { ...overall.summary, from: overallFrom },
    });
  } catch (err) {
    console.error('my attendance error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function classes(req, res) {
  try {
    const [rows] = await db.execute(
      'SELECT course, yrAndSec, COUNT(*) AS students FROM students GROUP BY course, yrAndSec ORDER BY course, yrAndSec'
    );
    res.json({ classes: rows });
  } catch (err) {
    console.error('classes error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function classOverview(req, res) {
  try {
    const cls = classParams(req.query);
    if (!cls) return fail(res, 400, 'Choose a course and a year and section.');
    const today = C.manilaNow().date;
    const range = parseRange(req.query, today);
    if (range.error) return fail(res, 400, range.error);

    const [students] = await db.execute(
      `SELECT id, studentID, fname, lname, DATE_FORMAT(dateRegistered, '%Y-%m-%d') AS joined
       FROM students WHERE course = ? AND yrAndSec = ? ORDER BY lname, fname`,
      [cls.course, cls.yrAndSec]
    );
    const overrides = await loadOverrides(cls.course, cls.yrAndSec, range.from, range.to);
    const presentDates = await loadPresentDates(cls.course, cls.yrAndSec, range.from, range.to);
    const [att] = await db.execute(
      `SELECT a.student_id, DATE_FORMAT(a.attendDate, '%Y-%m-%d') AS d
       FROM attendance a JOIN students s ON s.id = a.student_id
       WHERE s.course = ? AND s.yrAndSec = ? AND a.attendDate BETWEEN ? AND ?`,
      [cls.course, cls.yrAndSec, range.from, range.to]
    );

    const attendedBy = new Map();
    const presentByDate = new Map();
    for (const r of att) {
      if (!attendedBy.has(r.student_id)) attendedBy.set(r.student_id, new Map());
      attendedBy.get(r.student_id).set(r.d, null);
      presentByDate.set(r.d, (presentByDate.get(r.d) || 0) + 1);
    }

    const infos = C.classInfos(range.from, range.to, overrides, presentDates);
    const rows = students.map((s) => {
      const { summary } = C.studentDays(infos, { joined: s.joined, today, attended: attendedBy.get(s.id) || new Map() });
      return { id: s.id, studentID: s.studentID, fname: s.fname, lname: s.lname, joined: s.joined, ...summary };
    });

    const withDays = rows.filter((r) => r.required > 0);
    const avgPercent = withDays.length
      ? Math.round(withDays.reduce((a, r) => a + r.percent, 0) / withDays.length)
      : null;

    res.json({
      today,
      course: cls.course,
      yrAndSec: cls.yrAndSec,
      from: range.from,
      to: range.to,
      days: infos.map((i) => ({
        ...i,
        present: presentByDate.get(i.date) || 0,
        enrolled: students.filter((s) => s.joined <= i.date).length,
      })),
      students: rows,
      totals: {
        students: students.length,
        avgPercent,
        requiredDays: infos.filter((i) => i.status === 'REQUIRED' && i.date <= today).length,
      },
    });
  } catch (err) {
    console.error('class overview error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function classDay(req, res) {
  try {
    const cls = classParams(req.query);
    if (!cls) return fail(res, 400, 'Choose a course and a year and section.');
    const date = String(req.query.date || '');
    if (!C.isValidDate(date)) return fail(res, 400, 'Choose a valid date.', 'date');
    const today = C.manilaNow().date;

    const [students] = await db.execute(
      `SELECT id, studentID, fname, lname, DATE_FORMAT(dateRegistered, '%Y-%m-%d') AS joined
       FROM students WHERE course = ? AND yrAndSec = ? ORDER BY lname, fname`,
      [cls.course, cls.yrAndSec]
    );
    const overrides = await loadOverrides(cls.course, cls.yrAndSec, date, date);
    const presentDates = await loadPresentDates(cls.course, cls.yrAndSec, date, date);
    const [att] = await db.execute(
      `SELECT a.student_id, TIME_FORMAT(a.timeIn, '%H:%i:%s') AS t, a.source
       FROM attendance a JOIN students s ON s.id = a.student_id
       WHERE s.course = ? AND s.yrAndSec = ? AND a.attendDate = ?`,
      [cls.course, cls.yrAndSec, date]
    );
    const byStudent = new Map(att.map((r) => [r.student_id, r]));

    res.json({
      today,
      date,
      info: C.classInfos(date, date, overrides, presentDates)[0],
      roster: students.map((s) => {
        const a = byStudent.get(s.id);
        return {
          id: s.id, studentID: s.studentID, fname: s.fname, lname: s.lname,
          before: s.joined > date,
          present: !!a,
          time: a ? a.t : null,
          source: a ? a.source : null,
        };
      }),
    });
  } catch (err) {
    console.error('class day error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function setClassDay(req, res) {
  try {
    const b = req.body || {};
    const date = String(b.date || '');
    const endDate = b.endDate ? String(b.endDate) : date;
    const status = String(b.status || '').toUpperCase();
    const scope = String(b.scope || 'class');
    const note = String(b.note || '').trim().replace(/\s+/g, ' ');

    if (!C.isValidDate(date)) return fail(res, 400, 'Choose a valid date.', 'date');
    if (!C.isValidDate(endDate) || endDate < date) return fail(res, 400, 'The end date must be on or after the start date.', 'endDate');
    if (C.daysBetween(date, endDate) + 1 > MAX_SET_DAYS) return fail(res, 400, `You can set up to ${MAX_SET_DAYS} days at once.`, 'endDate');
    if (status !== 'DEFAULT' && !C.STATUSES.includes(status)) return fail(res, 400, 'Choose a valid day status.', 'status');
    if (note.length > 100) return fail(res, 400, 'The note must be 100 characters or fewer.', 'note');
    if (status === 'OTHER' && !note) return fail(res, 400, 'Add a short note for this case.', 'note');
    if (!['class', 'course', 'all'].includes(scope)) return fail(res, 400, 'Choose who this applies to.', 'scope');

    let course = '';
    let yrAndSec = '';
    if (scope !== 'all') {
      const cls = classParams({ course: b.course, yrAndSec: scope === 'class' ? b.yrAndSec : 'X' });
      if (!cls) return fail(res, 400, 'Choose a course and a year and section.');
      course = cls.course;
      yrAndSec = scope === 'class' ? cls.yrAndSec : '';
      const [ok] = scope === 'class'
        ? await db.execute('SELECT 1 FROM students WHERE course = ? AND yrAndSec = ? LIMIT 1', [course, yrAndSec])
        : await db.execute('SELECT 1 FROM students WHERE course = ? LIMIT 1', [course]);
      if (!ok.length) return fail(res, 400, 'No students are registered in that class.');
    }

    if (status === 'DEFAULT') {
      await db.execute(
        'DELETE FROM class_days WHERE dayDate BETWEEN ? AND ? AND course = ? AND yrAndSec = ?',
        [date, endDate, course, yrAndSec]
      );
    } else {
      const dates = C.eachDate(date, endDate);
      const marks = dates.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params = [];
      dates.forEach((d) => params.push(d, course, yrAndSec, status, note || null, req.user.id));
      await db.execute(
        `INSERT INTO class_days (dayDate, course, yrAndSec, status, note, setBy) VALUES ${marks}
         ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), setBy = VALUES(setBy)`,
        params
      );
    }

    res.json({ message: 'Saved.', days: C.daysBetween(date, endDate) + 1 });
  } catch (err) {
    console.error('set class day error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

async function mark(req, res) {
  try {
    const b = req.body || {};
    const id = Number(b.id);
    const date = String(b.date || '');
    if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'Choose a student.');
    if (!C.isValidDate(date)) return fail(res, 400, 'Choose a valid date.', 'date');
    if (typeof b.present !== 'boolean') return fail(res, 400, 'Say whether the student was present.');

    const today = C.manilaNow().date;
    if (date > today) return fail(res, 400, 'You cannot record attendance for a future date.', 'date');

    const [st] = await db.execute(
      `SELECT id, DATE_FORMAT(dateRegistered, '%Y-%m-%d') AS joined FROM students WHERE id = ?`,
      [id]
    );
    if (!st[0]) return fail(res, 404, 'Student not found.');
    if (date < st[0].joined) return fail(res, 400, 'That student was not registered yet on that date.', 'date');

    if (b.present) {
      await db.execute(
        `INSERT IGNORE INTO attendance (student_id, attendDate, timeIn, source, recordedBy) VALUES (?, ?, NULL, 'MANUAL', ?)`,
        [id, date, req.user.id]
      );
    } else {
      await db.execute('DELETE FROM attendance WHERE student_id = ? AND attendDate = ?', [id, date]);
    }
    res.json({ message: b.present ? 'Marked present.' : 'Attendance removed.' });
  } catch (err) {
    console.error('mark error:', err);
    fail(res, 500, 'Server error. Try again.');
  }
}

module.exports = { myLog, classes, classOverview, classDay, setClassDay, mark };