// Mount in server.js:  app.use('/api/attendance', requireUser, require('./controller/attendanceroutes'));
// Needs requireUser to run first so req.user is set. Creates missing tables/columns by itself on first request.
const express = require('express');
const pool = require('../database/db');
const router = express.Router();

const ATT = ['PRESENT', 'ABSENT', 'EXCUSED', 'EXEMPTED'];
const CLS = ['REQUIRED', 'NO_CLASS', 'HOLIDAY', 'CANCELLED', 'OTHER'];
// How a class day is held (only used when the day is REQUIRED / "Has class").
const TYPES = ['FACE_TO_FACE', 'ONLINE', 'SYNCHRONOUS', 'ASYNCHRONOUS'];
const TYPE_LABEL = { FACE_TO_FACE: 'Face to face', ONLINE: 'Online class', SYNCHRONOUS: 'Synchronous (live online)', ASYNCHRONOUS: 'Asynchronous (self-paced online)' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (res, m, c) => res.status(c || 400).json({ message: m });
const h = (fn) => (req, res, next) => fn(req, res, next).catch((e) => { console.error(e); res.status(500).json({ message: 'Server error.', detail: e.code || e.message }); });
const needStaff = (req, res, next) => (req.staff ? next() : bad(res, 'Only an admin or moderator can do that.', 403));

router.use((req, res, next) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  req.staff = req.user.userType === 'ADMIN' || req.user.userType === 'MODERATOR';
  next();
});

const DDL_SCHOOL_YEARS = `CREATE TABLE IF NOT EXISTS school_years (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL UNIQUE,
  startDate DATE NOT NULL, endDate DATE NOT NULL, setBy INT NULL,
  CONSTRAINT chk_sy_dates CHECK (endDate >= startDate),
  CONSTRAINT fk_sy_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sy_dates (startDate, endDate))`;
const DDL_SEMESTERS = `CREATE TABLE IF NOT EXISTS semesters (
  id INT AUTO_INCREMENT PRIMARY KEY, schoolYearId INT NOT NULL, name VARCHAR(40) NOT NULL,
  startDate DATE NOT NULL, endDate DATE NOT NULL, setBy INT NULL,
  CONSTRAINT uq_semester_name UNIQUE (schoolYearId, name),
  CONSTRAINT chk_sem_dates CHECK (endDate >= startDate),
  CONSTRAINT fk_sem_year FOREIGN KEY (schoolYearId) REFERENCES school_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_sem_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sem_dates (startDate, endDate))`;
const DDL_TERMS = `CREATE TABLE IF NOT EXISTS terms (
  id INT AUTO_INCREMENT PRIMARY KEY, semesterId INT NOT NULL, name VARCHAR(40) NOT NULL,
  startDate DATE NOT NULL, endDate DATE NOT NULL, setBy INT NULL,
  CONSTRAINT uq_term_name UNIQUE (semesterId, name),
  CONSTRAINT chk_term_dates CHECK (endDate >= startDate),
  CONSTRAINT fk_term_sem FOREIGN KEY (semesterId) REFERENCES semesters(id) ON DELETE CASCADE,
  CONSTRAINT fk_term_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_term_dates (startDate, endDate))`;

const DDL_EVENTS = `CREATE TABLE IF NOT EXISTS calendar_events (
  id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL,
  category ENUM('EVENT','ACTIVITY','HOLIDAY','EXAM') NOT NULL DEFAULT 'EVENT',
  startDate DATE NOT NULL, endDate DATE NOT NULL, note VARCHAR(255) NULL, setBy INT NULL,
  CONSTRAINT chk_event_dates CHECK (endDate >= startDate),
  CONSTRAINT fk_event_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_event_dates (startDate, endDate))`;

const DDL_CLASS_DAYS = `CREATE TABLE IF NOT EXISTS class_days (
  id INT AUTO_INCREMENT PRIMARY KEY, dayDate DATE NOT NULL, course VARCHAR(100) NOT NULL DEFAULT '', yrAndSec VARCHAR(5) NOT NULL DEFAULT '',
  status ENUM('REQUIRED','NO_CLASS','HOLIDAY','CANCELLED','OTHER') NOT NULL,
  classType ENUM('FACE_TO_FACE','ONLINE','SYNCHRONOUS','ASYNCHRONOUS') NOT NULL DEFAULT 'FACE_TO_FACE',
  note VARCHAR(100) NULL, setBy INT NULL,
  CONSTRAINT uq_class_day UNIQUE (dayDate, course, yrAndSec),
  CONSTRAINT chk_class_scope CHECK (yrAndSec = '' OR course <> ''),
  CONSTRAINT fk_class_days_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL)`;

// Old flat academic_terms (SEMESTER / TERM rows) -> school_years > semesters > terms. The old table is kept, renamed academic_terms_old.
async function migrateOldTerms() {
  const [t] = await pool.query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'academic_terms'");
  if (!t[0].n) return;
  const [[have]] = await pool.query('SELECT COUNT(*) n FROM school_years');
  if (!have.n) {
    try {
      const [old] = await pool.query("SELECT kind, name, DATE_FORMAT(startDate,'%Y-%m-%d') s, DATE_FORMAT(endDate,'%Y-%m-%d') e, setBy FROM academic_terms ORDER BY startDate");
      const years = new Map(), sems = [];
      for (const r of old.filter((x) => x.kind === 'SEMESTER')) {
        const y = Number(r.s.slice(0, 4)), a = Number(r.s.slice(5, 7)) >= 6 ? y : y - 1, nm = `${a}-${a + 1}`;
        let sy = years.get(nm);
        if (!sy) {
          sy = { start: `${a}-06-01`, end: `${a + 1}-05-31` };
          const [ins] = await pool.query('INSERT INTO school_years (name, startDate, endDate) VALUES (?, ?, ?)', [nm, sy.start, sy.end]);
          sy.id = ins.insertId; years.set(nm, sy);
        }
        if (r.s < sy.start || r.e > sy.end) {
          sy.start = r.s < sy.start ? r.s : sy.start; sy.end = r.e > sy.end ? r.e : sy.end;
          await pool.query('UPDATE school_years SET startDate = ?, endDate = ? WHERE id = ?', [sy.start, sy.end, sy.id]);
        }
        try {
          const [ins] = await pool.query('INSERT INTO semesters (schoolYearId, name, startDate, endDate, setBy) VALUES (?, ?, ?, ?, ?)', [sy.id, r.name, r.s, r.e, r.setBy]);
          sems.push({ id: ins.insertId, s: r.s, e: r.e });
        } catch (e) { console.warn('terms migration: skipped semester', r.name, e.code); }
      }
      for (const r of old.filter((x) => x.kind === 'TERM')) {
        const p = sems.find((x) => x.s <= r.s && r.e <= x.e);
        if (!p) { console.warn('terms migration: term has no semester, left in academic_terms_old:', r.name, r.s, r.e); continue; }
        try { await pool.query('INSERT INTO terms (semesterId, name, startDate, endDate, setBy) VALUES (?, ?, ?, ?, ?)', [p.id, r.name, r.s, r.e, r.setBy]); }
        catch (e) { console.warn('terms migration: skipped term', r.name, e.code); }
      }
    } catch (e) { console.error('terms migration failed (old table left as is):', e); return; }
  }
  await pool.query('RENAME TABLE academic_terms TO academic_terms_old');
}

let ready = null;
function ensureSchema() {
  if (!ready) ready = (async () => {
    const [c] = await pool.query("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attendance' AND column_name = 'status'");
    if (!c[0].n) await pool.query("ALTER TABLE attendance ADD COLUMN status ENUM('PRESENT','ABSENT','EXCUSED','EXEMPTED') NOT NULL DEFAULT 'PRESENT' AFTER attendDate");
    await pool.query(DDL_SCHOOL_YEARS);
    await pool.query(DDL_SEMESTERS);
    await pool.query(DDL_TERMS);
    await pool.query(DDL_EVENTS);
    await pool.query(DDL_CLASS_DAYS);
    // older databases: class_days has no classType yet (existing "Has class" days become Face to face)
    const [ct] = await pool.query("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'class_days' AND column_name = 'classType'");
    if (!ct[0].n) await pool.query("ALTER TABLE class_days ADD COLUMN classType ENUM('FACE_TO_FACE','ONLINE','SYNCHRONOUS','ASYNCHRONOUS') NOT NULL DEFAULT 'FACE_TO_FACE' AFTER status");
    await migrateOldTerms();
    const [i] = await pool.query("SELECT COUNT(*) n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'students' AND index_name = 'idx_students_class'");
    if (!i[0].n) await pool.query('ALTER TABLE students ADD INDEX idx_students_class (course, yrAndSec)');
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
router.use(h(async (req, res, next) => { await ensureSchema(); next(); }));

// Students only ever get their own record (linked by userId, or by matching email when staff registered them); staff pick any student by id.
async function findStudent(req, id) {
  const [rows] = req.staff
    ? await pool.query("SELECT id, studentID, fname, lname, course, yrAndSec, DATE_FORMAT(dateRegistered,'%Y-%m-%d') joined FROM students WHERE id = ?", [Number(id) || 0])
    : await pool.query("SELECT id, studentID, fname, lname, course, yrAndSec, DATE_FORMAT(dateRegistered,'%Y-%m-%d') joined FROM students WHERE userId = ? OR (userId IS NULL AND email = (SELECT email FROM users WHERE id = ?)) ORDER BY userId IS NULL LIMIT 1", [req.user.id, req.user.id]);
  return rows[0] || null;
}

const FMT = "DATE_FORMAT(startDate,'%Y-%m-%d') startDate, DATE_FORMAT(endDate,'%Y-%m-%d') endDate";

// School year > semesters > terms, nested; plus a flat semester/term list (names carry the school year) for the date pickers.
async function hierarchy() {
  const [y] = await pool.query(`SELECT id, name, ${FMT} FROM school_years ORDER BY startDate`);
  const [s] = await pool.query(`SELECT id, schoolYearId, name, ${FMT} FROM semesters ORDER BY startDate`);
  const [t] = await pool.query(`SELECT id, semesterId, name, ${FMT} FROM terms ORDER BY startDate`);
  const schoolYears = y.map((r) => ({ ...r, semesters: [] }));
  const yearOf = new Map(schoolYears.map((r) => [r.id, r]));
  const semOf = new Map();
  s.forEach((r) => { const o = { ...r, terms: [] }; semOf.set(r.id, o); const p = yearOf.get(r.schoolYearId); if (p) p.semesters.push(o); });
  t.forEach((r) => { const p = semOf.get(r.semesterId); if (p) p.terms.push(r); });
  const terms = [];
  schoolYears.forEach((sy) => sy.semesters.forEach((se) => {
    terms.push({ id: `semester-${se.id}`, kind: 'SEMESTER', name: `${sy.name} · ${se.name}`, startDate: se.startDate, endDate: se.endDate, schoolYear: sy.name });
    se.terms.forEach((tm) => terms.push({ id: `term-${tm.id}`, kind: 'TERM', name: `${sy.name} · ${se.name} · ${tm.name}`, startDate: tm.startDate, endDate: tm.endDate, schoolYear: sy.name, semester: se.name }));
  }));
  terms.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.kind === 'SEMESTER' ? -1 : 1));
  return { schoolYears, terms };
}

router.get('/context', h(async (req, res) => {
  const { schoolYears, terms } = await hierarchy();
  let classes = [], student = null;
  if (req.staff) [classes] = await pool.query('SELECT course, yrAndSec, COUNT(*) students FROM students GROUP BY course, yrAndSec ORDER BY course, yrAndSec');
  else student = await findStudent(req);
  res.json({ userType: req.user.userType, schoolYears, terms, student, classes });
}));

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); // YYYY-MM-DD, Manila
const validRange = (f, t) => DATE.test(f || '') && DATE.test(t || '') && f <= t && (Date.parse(t) - Date.parse(f)) / 864e5 <= 400;

// A class = course + year-section. Most specific override wins: class > course > everyone.
// Default for every day is NO_CLASS: a day only has class once an admin/moderator sets it to REQUIRED for that class
// (or course / everyone). Exception: a day on which any student of the class is recorded PRESENT automatically counts as a class day.
async function classDays(course, yrAndSec, from, to) {
  const [cd] = await pool.query(
    "SELECT DATE_FORMAT(dayDate,'%Y-%m-%d') d, course, yrAndSec, status, classType, note FROM class_days WHERE dayDate BETWEEN ? AND ? AND (course = '' OR course = ?) AND (yrAndSec = '' OR yrAndSec = ?)",
    [from, to, course, yrAndSec]);
  const [pr] = await pool.query(
    "SELECT DISTINCT DATE_FORMAT(a.attendDate,'%Y-%m-%d') d FROM attendance a JOIN students s ON s.id = a.student_id WHERE s.course = ? AND s.yrAndSec = ? AND a.status = 'PRESENT' AND a.attendDate BETWEEN ? AND ?",
    [course, yrAndSec, from, to]);
  const live = new Set(pr.map((r) => r.d));
  const over = {};
  cd.forEach((r) => { const w = (r.course ? 1 : 0) + (r.yrAndSec ? 1 : 0); if (!over[r.d] || w > over[r.d].w) over[r.d] = { w, status: r.status, type: r.classType, note: r.note || '' }; });
  const days = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), o = over[d];
    // cls.type = how the class is held; it only exists on a "Has class" day
    let cls = o ? { status: o.status, type: o.status === 'REQUIRED' ? o.type : null, note: o.note, isDefault: false } : { status: 'NO_CLASS', type: null, note: '', isDefault: true };
    if (live.has(d) && cls.status !== 'REQUIRED') cls = { status: 'REQUIRED', type: 'FACE_TO_FACE', note: 'Auto: attendance recorded', isDefault: false, auto: true };
    days.push({ date: d, class: cls });
  }
  return days;
}

// How many "Has class" days of each type are in the range, e.g. { FACE_TO_FACE: 12, ONLINE: 0, SYNCHRONOUS: 3, ASYNCHRONOUS: 0 }.
function typeCounts(days) {
  const t = {};
  TYPES.forEach((k) => { t[k] = 0; });
  days.forEach(({ class: c }) => { if (c.status === 'REQUIRED' && c.type) t[c.type]++; });
  return t;
}

// att = { 'YYYY-MM-DD': {status,...} } for one student. A required day with no record counts as absent once it has passed.
function tally(days, att, joined) {
  const today = todayStr(), sum = { total: 0, present: 0, absent: 0, excused: 0, exempted: 0, upcoming: 0 };
  const out = days.map(({ date, class: cls }) => {
    const a = att[date] || null;
    let eff = null;
    if (cls.status === 'REQUIRED' && !(joined && date < joined && !a)) {
      eff = a ? a.status : (date < today ? 'ABSENT' : null);
      if (eff) { sum.total++; sum[eff.toLowerCase()]++; } else sum.upcoming++;
    }
    return { date, class: cls, att: a, eff };
  });
  return { days: out, summary: sum };
}

// One student (students: themselves; staff: ?studentId=) over a range.
router.get('/log', h(async (req, res) => {
  const { from, to } = req.query;
  if (!validRange(from, to)) return bad(res, 'Invalid date range.');
  const s = await findStudent(req, req.query.studentId);
  if (!s) return bad(res, req.staff ? 'Student not found.' : 'No student record is linked to your account yet.', 404);
  const [ar] = await pool.query(
    "SELECT DATE_FORMAT(attendDate,'%Y-%m-%d') d, status, TIME_FORMAT(timeIn,'%H:%i') timeIn, source FROM attendance WHERE student_id = ? AND attendDate BETWEEN ? AND ?",
    [s.id, from, to]);
  const att = {};
  ar.forEach((r) => { att[r.d] = { status: r.status, timeIn: r.timeIn, source: r.source }; });
  const days = await classDays(s.course, s.yrAndSec, from, to);
  res.json({ student: s, ...tally(days, att, s.joined), types: typeCounts(days) });
}));

async function classStudents(course, yrAndSec) {
  const [rows] = await pool.query("SELECT id, studentID, fname, lname, DATE_FORMAT(dateRegistered,'%Y-%m-%d') joined FROM students WHERE course = ? AND yrAndSec = ? ORDER BY lname, fname", [course, yrAndSec]);
  return rows;
}
async function attendanceOf(students, from, to) {
  const per = {};
  if (students.length) {
    const [ar] = await pool.query("SELECT student_id, DATE_FORMAT(attendDate,'%Y-%m-%d') d, status, TIME_FORMAT(timeIn,'%H:%i') timeIn, source FROM attendance WHERE student_id IN (?) AND attendDate BETWEEN ? AND ?", [students.map((s) => s.id), from, to]);
    ar.forEach((r) => { (per[r.student_id] = per[r.student_id] || {})[r.d] = { status: r.status, timeIn: r.timeIn, source: r.source }; });
  }
  return per;
}

// Staff, specific day: the whole class roster for one date.
router.get('/day', needStaff, h(async (req, res) => {
  const { course, yrAndSec, date } = req.query;
  if (!course || !yrAndSec || !DATE.test(date || '')) return bad(res, 'Choose a class and a date.');
  const students = await classStudents(course, yrAndSec);
  const [info] = await classDays(course, yrAndSec, date, date);
  const per = await attendanceOf(students, date, date);
  const roster = students.map((s) => {
    const a = (per[s.id] || {})[date] || null;
    const eff = info.class.status === 'REQUIRED' && !(s.joined && date < s.joined && !a) ? (a ? a.status : (date < todayStr() ? 'ABSENT' : null)) : null;
    return { ...s, status: a ? a.status : '', timeIn: a ? a.timeIn : null, source: a ? a.source : null, eff };
  });
  res.json({ date, class: info.class, roster });
}));

// Staff, month / semester / term: statistics for one class.
router.get('/class-summary', needStaff, h(async (req, res) => {
  const { course, yrAndSec, from, to } = req.query;
  if (!course || !yrAndSec) return bad(res, 'Choose a course, year and section.');
  if (!validRange(from, to)) return bad(res, 'Invalid date range.');
  const students = await classStudents(course, yrAndSec);
  const days = await classDays(course, yrAndSec, from, to);
  const per = await attendanceOf(students, from, to);
  const daily = {};
  const rows = students.map((s) => {
    const t = tally(days, per[s.id] || {}, s.joined);
    t.days.forEach((d) => { if (d.eff) { const x = daily[d.date] = daily[d.date] || { date: d.date, present: 0, absent: 0, excused: 0, exempted: 0 }; x[d.eff.toLowerCase()]++; } });
    return { ...s, ...t.summary };
  });
  const base = tally(days, {}).summary;
  res.json({ rows, classDays: days.map((d) => ({ date: d.date, class: d.class })), types: typeCounts(days), total: base.total, upcoming: base.upcoming, daily: Object.values(daily).sort((a, b) => (a.date < b.date ? -1 : 1)) });
}));

// Editing a record here is NOT recording attendance (scanning does that, on its own page), so a time is never filled in automatically.
// timeIn is only written when the staff member types one ('HH:MM', or '' to clear it) and only for a PRESENT record;
// leaving it out of the request keeps whatever time the record already has.
router.put('/record', needStaff, h(async (req, res) => {
  const body = req.body || {};
  const { studentId, date, status } = body;
  if (!DATE.test(date || '')) return bad(res, 'Invalid date.');
  const s = await findStudent(req, studentId);
  if (!s) return bad(res, 'Student not found.', 404);
  if (!status) await pool.query('DELETE FROM attendance WHERE student_id = ? AND attendDate = ?', [s.id, date]);
  else {
    if (!ATT.includes(status)) return bad(res, 'Invalid attendance status.');
    let t = null, setTime = status !== 'PRESENT';   // anything other than PRESENT carries no time
    if (status === 'PRESENT' && Object.prototype.hasOwnProperty.call(body, 'timeIn')) {
      t = String(body.timeIn == null ? '' : body.timeIn).trim();
      if (t && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t)) return bad(res, 'Enter a valid time, for example 08:15.');
      if (t.length === 5) t += ':00';
      t = t || null; setTime = true;
    }
    await pool.query(
      `INSERT INTO attendance (student_id, attendDate, status, timeIn, source, recordedBy) VALUES (?, ?, ?, ?, 'MANUAL', ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status),${setTime ? ' timeIn = VALUES(timeIn),' : ''} source = 'MANUAL', recordedBy = VALUES(recordedBy)`,
      [s.id, date, status, t, req.user.id]);
  }
  res.json({ ok: true });
}));

// scope: 'class' = course + year-section, 'course' = every section of the course, 'all' = everyone
const scopeOf = (course, yrAndSec, scope) => (scope === 'all' ? ['', ''] : scope === 'course' ? [course, ''] : [course, yrAndSec]);

// Every date from..to (inclusive), optionally limited to some weekdays (0 = Sunday ... 6 = Saturday).
function datesIn(from, to, weekdays) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) {
    if (!weekdays || weekdays.includes(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const MAX_SPAN = 366;

// ---- Emails to students when a class day's status changes ----
// Compares each class's effective status (class > course > everyone, default NO_CLASS) before and after the change.
// Only days from today on are considered (fixing a past day does not email anyone), and only real changes are sent:
// re-saving the same status emails nobody. Each student gets ONE email summarising everything that changed for their class.
const STATUS_LABEL = { REQUIRED: 'Has class', NO_CLASS: 'No class', HOLIDAY: 'Holiday', CANCELLED: 'Cancelled', OTHER: 'Other' };
const wantsNotify = (v) => !(v === false || v === 'false' || v === '0' || v === 0);
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const htmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function overridesByDate(from, to) {
  const [rows] = await pool.query("SELECT DATE_FORMAT(dayDate,'%Y-%m-%d') d, course, yrAndSec, status, classType FROM class_days WHERE dayDate BETWEEN ? AND ?", [from, to]);
  const m = new Map();
  rows.forEach((x) => { if (!m.has(x.d)) m.set(x.d, []); m.get(x.d).push(x); });
  return m;
}
function effectiveRow(byDate, d, course, yrAndSec) {
  let best = null, bw = -1;
  (byDate.get(d) || []).forEach((x) => {
    if (x.course && x.course !== course) return;
    if (x.yrAndSec && x.yrAndSec !== yrAndSec) return;
    const w = (x.course ? 1 : 0) + (x.yrAndSec ? 1 : 0);
    if (w > bw) { best = x; bw = w; }
  });
  return best;
}
function effectiveStatus(byDate, d, course, yrAndSec) {
  const b = effectiveRow(byDate, d, course, yrAndSec);
  return b ? b.status : 'NO_CLASS';
}
// Like effectiveStatus, but a "Has class" day also says how it is held, e.g. 'REQUIRED:SYNCHRONOUS'. Used to spot changes worth an email.
function effectiveDay(byDate, d, course, yrAndSec) {
  const b = effectiveRow(byDate, d, course, yrAndSec);
  return !b ? 'NO_CLASS' : b.status === 'REQUIRED' ? 'REQUIRED:' + b.classType : b.status;
}
const dayLabel = (k) => { const [s, t] = String(k).split(':'); return STATUS_LABEL[s] + (t ? ' - ' + TYPE_LABEL[t] : ''); };
// Call BEFORE writing: who is affected, and what each day looked like.
async function mailSnapshot(from, to, c, y) {
  const where = y ? ' WHERE course = ? AND yrAndSec = ?' : c ? ' WHERE course = ?' : '';
  const [students] = await pool.query('SELECT fname, email, course, yrAndSec FROM students' + where, y ? [c, y] : c ? [c] : []);
  return { students, before: await overridesByDate(from, to), from, to };
}
// Consecutive changed class days become one range (a weekend between two changed weekdays does not break it).
function follows(prev, d, set) {
  let n = addDay(prev, 1);
  while (n < d && !set.has(n)) {
    const w = new Date(n + 'T00:00:00Z').getUTCDay();
    if (w !== 0 && w !== 6) return false;
    n = addDay(n, 1);
  }
  return n === d;
}
function toRanges(changes) {
  const groups = new Map();
  changes.forEach((x) => { const k = x.was + '>' + x.now; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x.d); });
  const out = [];
  groups.forEach((ds, k) => {
    ds.sort();
    const set = new Set(ds), [was, now] = k.split('>');
    let start = ds[0], prev = ds[0];
    for (let i = 1; i < ds.length; i++) {
      if (follows(prev, ds[i], set)) prev = ds[i];
      else { out.push({ start, end: prev, was, now }); start = prev = ds[i]; }
    }
    out.push({ start, end: prev, was, now });
  });
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
function composeMail(st, ranges, note) {
  const MAX = 15, shown = ranges.slice(0, MAX), more = ranges.length - shown.length;
  const line = (x) => `${x.start === x.end ? fmtDay(x.start) : fmtDay(x.start) + ' to ' + fmtDay(x.end)}: ${dayLabel(x.now)} (was ${dayLabel(x.was)})`;
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const cls = `${st.course} ${st.yrAndSec}`;
  const tail = more > 0 ? `...and ${more} more. See the Attendance log for the full list.` : '';
  return {
    from: `"G9 Registration System" <${process.env.MAIL_USER}>`,
    to: st.email,
    subject: 'G9: your class schedule was updated',
    text: `Hi ${st.fname},\n\nThe class schedule for ${cls} was updated:\n\n` + shown.map((x) => '- ' + line(x)).join('\n') + (tail ? '\n' + tail : '') +
      (note ? `\n\nNote: ${note}` : '') + `\n\nSee the Attendance log: ${base}/attendance.html`,
    html: `<p>Hi ${htmlEsc(st.fname)},</p><p>The class schedule for <b>${htmlEsc(cls)}</b> was updated:</p><ul>` + shown.map((x) => `<li>${htmlEsc(line(x))}</li>`).join('') + '</ul>' +
      (tail ? `<p>${htmlEsc(tail)}</p>` : '') + (note ? `<p><b>Note:</b> ${htmlEsc(note)}</p>` : '') + `<p><a href="${base}/attendance.html">Open the Attendance log</a></p>`,
  };
}
// Call AFTER writing. Returns { status: 'sending' | 'none' | 'not_configured', students: n }; the emails go out in the background.
async function sendChangeMail(snap, note) {
  const after = await overridesByDate(snap.from, snap.to), today = todayStr();
  const dates = datesIn(snap.from, snap.to).filter((d) => d >= today);
  const perClass = new Map(), jobs = [];
  snap.students.forEach((st) => {
    const key = st.course + '\u0000' + st.yrAndSec;
    if (!perClass.has(key)) {
      const ch = [];
      dates.forEach((d) => { const was = effectiveDay(snap.before, d, st.course, st.yrAndSec), now = effectiveDay(after, d, st.course, st.yrAndSec); if (was !== now) ch.push({ d, was, now }); });
      perClass.set(key, toRanges(ch));
    }
    const ranges = perClass.get(key);
    if (ranges.length && st.email) jobs.push({ st, ranges });
  });
  if (!jobs.length) return { status: 'none', students: 0 };
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return { status: 'not_configured', students: jobs.length };
  let sendMail;
  try { ({ sendMail } = require('./mailer')); } catch (e) { console.error('class day mail: mailer not found', e.message); return { status: 'not_configured', students: jobs.length }; }
  (async () => {
    for (let i = 0; i < jobs.length; i += 5) {
      const res = await Promise.allSettled(jobs.slice(i, i + 5).map((j) => sendMail(composeMail(j.st, j.ranges, note))));
      res.forEach((x, k) => { if (x.status === 'rejected') console.error('class day email failed for', jobs[i + k].st.email, x.reason && (x.reason.code || x.reason.message)); });
    }
  })().catch((e) => console.error('class day email error:', e));
  return { status: 'sending', students: jobs.length };
}

// Initialise (or change) class days. Body: date, optional endDate, optional weekdays [1,2,3,4,5], status, note, scope, course, yrAndSec.
router.put('/class-day', needStaff, h(async (req, res) => {
  const { date, endDate, weekdays, status, classType, note, scope, course, yrAndSec } = req.body || {};
  const last = endDate || date;
  if (!DATE.test(date || '') || !DATE.test(last || '') || last < date || !CLS.includes(status)) return bad(res, 'Invalid class day.');
  if ((Date.parse(last) - Date.parse(date)) / 864e5 + 1 > MAX_SPAN) return bad(res, `Choose a range of ${MAX_SPAN} days or fewer.`);
  if (status === 'REQUIRED' && classType && !TYPES.includes(classType)) return bad(res, 'Choose how the class is held.');
  const ty = status === 'REQUIRED' && TYPES.includes(classType) ? classType : 'FACE_TO_FACE';   // only a "Has class" day keeps a type
  if (scope !== 'all' && !course) return bad(res, 'Choose a class first.');
  if (scope === 'class' && !yrAndSec) return bad(res, 'Choose a year and section.');
  const wd = Array.isArray(weekdays) && weekdays.length ? weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : null;
  const dates = datesIn(date, last, wd);
  if (!dates.length) return bad(res, 'No day in that range matches the chosen weekdays.');
  const [c, y] = scopeOf(course, yrAndSec, scope);
  if (c) {
    const [ok] = y
      ? await pool.query('SELECT 1 FROM students WHERE course = ? AND yrAndSec = ? LIMIT 1', [c, y])
      : await pool.query('SELECT 1 FROM students WHERE course = ? LIMIT 1', [c]);
    if (!ok.length) return bad(res, 'No students are registered in that class.');
  }
  const snap = wantsNotify(req.body && req.body.notify) ? await mailSnapshot(date, last, c, y) : null;
  const n = String(note || '').trim().slice(0, 100) || null;
  const params = [];
  dates.forEach((d) => params.push(d, c, y, status, ty, n, req.user.id));
  await pool.query(
    `INSERT INTO class_days (dayDate, course, yrAndSec, status, classType, note, setBy) VALUES ${dates.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE status = VALUES(status), classType = VALUES(classType), note = VALUES(note), setBy = VALUES(setBy)`,
    params);
  res.json({ ok: true, days: dates.length, mail: snap ? await sendChangeMail(snap, n) : { status: 'off', students: 0 } });
}));

// Reset to the default (no class). Query: date, optional endDate, scope, course, yrAndSec.
router.delete('/class-day', needStaff, h(async (req, res) => {
  const { date, endDate, scope, course, yrAndSec } = req.query;
  const last = endDate || date;
  if (!DATE.test(date || '') || !DATE.test(last || '') || last < date) return bad(res, 'Invalid date.');
  const [c, y] = scopeOf(course, yrAndSec, scope);
  const snap = wantsNotify(req.query.notify) ? await mailSnapshot(date, last, c, y) : null;
  await pool.query('DELETE FROM class_days WHERE dayDate BETWEEN ? AND ? AND course = ? AND yrAndSec = ?', [date, last, c, y]);
  res.json({ ok: true, mail: snap ? await sendChangeMail(snap, null) : { status: 'off', students: 0 } });
}));

// ---- School year > semesters > terms (admin / moderator) ----
// A semester lives inside one school year and a term inside one semester. Children must fall within their parent's dates,
// and siblings (semesters of one school year, terms of one semester, school years themselves) may not share a day.
const LV = {
  year:     { table: 'school_years', label: 'school year', col: null,           parent: null,       child: 'semester' },
  semester: { table: 'semesters',    label: 'semester',    col: 'schoolYearId', parent: 'year',     child: 'term' },
  term:     { table: 'terms',        label: 'term',        col: 'semesterId',   parent: 'semester', child: null },
};
const span = (r) => `${r.startDate} to ${r.endDate}`;

async function problem(key, b, id) {
  const L = LV[key];
  const name = String((b && b.name) || '').trim().replace(/\s+/g, ' ');
  const { startDate, endDate } = b || {};
  if (!name || name.length > 40) return { err: [400, 'Enter a name (up to 40 characters).'] };
  if (!DATE.test(startDate || '') || !DATE.test(endDate || '')) return { err: [400, 'Choose a start date and an end date.'] };
  if (startDate > endDate) return { err: [400, 'The start date must be on or before the end date.'] };

  let cur = null;
  if (id) {
    [[cur]] = await pool.query(`SELECT * FROM ${L.table} WHERE id = ?`, [id]);
    if (!cur) return { err: [404, `That ${L.label} no longer exists.`] };
  }
  let parentId = null;
  if (L.parent) {
    const P = LV[L.parent];
    parentId = cur ? cur[L.col] : Number(b[L.col]) || 0;
    const [[p]] = await pool.query(`SELECT id, name, ${FMT} FROM ${P.table} WHERE id = ?`, [parentId]);
    if (!p) return { err: [400, `Choose a ${P.label} first.`] };
    if (startDate < p.startDate || endDate > p.endDate)
      return { err: [409, `A ${L.label} must fall within the ${P.label} "${p.name}" (${span(p)}).`] };
  }
  const where = L.col ? ` AND ${L.col} = ?` : '';
  const scope = L.col ? [parentId] : [];
  const [dup] = await pool.query(`SELECT 1 FROM ${L.table} WHERE name = ? AND id <> ?${where} LIMIT 1`, [name, id || 0, ...scope]);
  if (dup.length) return { err: [409, `There is already a ${L.label} named "${name}"${L.parent ? ` in this ${LV[L.parent].label}` : ''}.`] };
  const [[o]] = await pool.query(`SELECT name, ${FMT} FROM ${L.table} WHERE id <> ?${where} AND startDate <= ? AND endDate >= ? LIMIT 1`, [id || 0, ...scope, endDate, startDate]);
  if (o) return { err: [409, `These dates overlap with "${o.name}" (${span(o)}). Two ${L.label}s${L.parent ? ` in the same ${LV[L.parent].label}` : ''} cannot share a day.`] };
  if (cur && L.child) {
    const C = LV[L.child];
    const [[c]] = await pool.query(`SELECT name FROM ${C.table} WHERE ${C.col} = ? AND (startDate < ? OR endDate > ?) LIMIT 1`, [id, startDate, endDate]);
    if (c) return { err: [409, `The ${C.label} "${c.name}" would fall outside these dates. Change or remove it first.`] };
  }
  return { name, parentId };
}

[['school-years', 'year'], ['semesters', 'semester'], ['terms', 'term']].forEach(([path, key]) => {
  const L = LV[key];
  router.post('/' + path, needStaff, h(async (req, res) => {
    const v = await problem(key, req.body, 0);
    if (v.err) return bad(res, v.err[1], v.err[0]);
    const { startDate, endDate } = req.body;
    const [r] = L.col
      ? await pool.query(`INSERT INTO ${L.table} (${L.col}, name, startDate, endDate, setBy) VALUES (?, ?, ?, ?, ?)`, [v.parentId, v.name, startDate, endDate, req.user.id])
      : await pool.query(`INSERT INTO ${L.table} (name, startDate, endDate, setBy) VALUES (?, ?, ?, ?)`, [v.name, startDate, endDate, req.user.id]);
    res.json({ ok: true, id: r.insertId });
  }));

  router.put('/' + path + '/:id', needStaff, h(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const v = await problem(key, req.body, id);
    if (v.err) return bad(res, v.err[1], v.err[0]);
    await pool.query(`UPDATE ${L.table} SET name = ?, startDate = ?, endDate = ?, setBy = ? WHERE id = ?`, [v.name, req.body.startDate, req.body.endDate, req.user.id, id]);
    res.json({ ok: true });
  }));

  // Deleting a school year also deletes its semesters and their terms; deleting a semester deletes its terms.
  router.delete('/' + path + '/:id', needStaff, h(async (req, res) => {
    await pool.query(`DELETE FROM ${L.table} WHERE id = ?`, [Number(req.params.id) || 0]);
    res.json({ ok: true });
  }));
});

// ---- Calendar events (everyone can read; admin / moderator can add, edit and delete) ----
// One-day events (Teachers' Day) and ranges (Intramurals Week, Oct 14 - Oct 19) share one table: a one-day event has endDate = startDate.
// Events are informational: they do not change which days count as class days for attendance.
const EVCAT = ['EVENT', 'ACTIVITY', 'HOLIDAY', 'EXAM'];
const EVFMT = "id, title, category, DATE_FORMAT(startDate,'%Y-%m-%d') startDate, DATE_FORMAT(endDate,'%Y-%m-%d') endDate, note";
const realDate = (s) => {
  if (!DATE.test(s || '')) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

function eventInput(b) {
  const title = String((b && b.title) || '').trim().replace(/\s+/g, ' ');
  const note = String((b && b.note) || '').trim().replace(/\s+/g, ' ');
  const category = String((b && b.category) || 'EVENT').toUpperCase();
  const startDate = String((b && b.startDate) || '');
  const endDate = String((b && b.endDate) || startDate);
  if (!title || title.length > 100) return { err: 'Enter an event name (up to 100 characters).' };
  if (!EVCAT.includes(category)) return { err: 'Choose a valid event type.' };
  if (!realDate(startDate)) return { err: 'Choose a start date.' };
  if (!realDate(endDate)) return { err: 'Choose a valid end date.' };
  if (endDate < startDate) return { err: 'The end date must be on or after the start date.' };
  if ((Date.parse(endDate) - Date.parse(startDate)) / 864e5 + 1 > MAX_SPAN) return { err: `An event can last up to ${MAX_SPAN} days.` };
  if (note.length > 255) return { err: 'The note must be 255 characters or fewer.' };
  return { title, category, startDate, endDate, note: note || null };
}

// ?from=&to= returns the events that touch that range (the calendar grid); with no range it returns all of them (the setter list).
router.get('/events', h(async (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from || to) {
    if (!realDate(from) || !realDate(to) || !validRange(from, to)) return bad(res, 'Invalid date range.');
    [rows] = await pool.query(`SELECT ${EVFMT} FROM calendar_events WHERE startDate <= ? AND endDate >= ? ORDER BY startDate, endDate, id`, [to, from]);
  } else {
    [rows] = await pool.query(`SELECT ${EVFMT} FROM calendar_events ORDER BY startDate, endDate, id LIMIT 2000`);
  }
  res.json({ events: rows });
}));

router.post('/events', needStaff, h(async (req, res) => {
  const v = eventInput(req.body);
  if (v.err) return bad(res, v.err);
  const [r] = await pool.query('INSERT INTO calendar_events (title, category, startDate, endDate, note, setBy) VALUES (?, ?, ?, ?, ?, ?)',
    [v.title, v.category, v.startDate, v.endDate, v.note, req.user.id]);
  res.json({ ok: true, id: r.insertId });
}));

router.put('/events/:id', needStaff, h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const v = eventInput(req.body);
  if (v.err) return bad(res, v.err);
  const [r] = await pool.query('UPDATE calendar_events SET title = ?, category = ?, startDate = ?, endDate = ?, note = ?, setBy = ? WHERE id = ?',
    [v.title, v.category, v.startDate, v.endDate, v.note, req.user.id, id]);
  if (!r.affectedRows) {
    const [still] = await pool.query('SELECT 1 FROM calendar_events WHERE id = ?', [id]);
    if (!still.length) return bad(res, 'That event no longer exists.', 404);
  }
  res.json({ ok: true });
}));

router.delete('/events/:id', needStaff, h(async (req, res) => {
  await pool.query('DELETE FROM calendar_events WHERE id = ?', [Number(req.params.id) || 0]);
  res.json({ ok: true });
}));

// ---- Monitoring page: type/scan a student number, flash the student card, record today's attendance (admin / moderator) ----
// Recording uses the current Philippine (Asia/Manila) date and time. The time is stored as a normal TIME and shown in 12-hour form.
// Class day rule: a day starts as "Has class" for a section as soon as one of its students is recorded present (see classDays above);
// it only ever affects that student's own course + section. A day an admin/moderator explicitly set to Holiday / No class /
// Cancelled / Other is NOT overridden by a scan: the card says so and the staff member changes the day first.
const ATT_LABEL = { PRESENT: 'Present', ABSENT: 'Absent', EXCUSED: 'Excused', EXEMPTED: 'Exempted' };
const manilaNow = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const v = {}; p.forEach((x) => { v[x.type] = x.value; });
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}:${v.minute}:${v.second}` };
};
const to12 = (t) => {
  if (!t) return '';
  const [H, M, S] = String(t).split(':').map(Number);
  return `${H % 12 || 12}:${String(M).padStart(2, '0')}:${String(S || 0).padStart(2, '0')} ${H >= 12 ? 'PM' : 'AM'}`;
};
const photoUrl = (b) => (b && b.length ? 'data:image/jpeg;base64,' + Buffer.from(b).toString('base64') : null);

async function studentByNumber(code) {
  if (!/^[A-Z0-9-]{3,15}$/.test(code)) return null;
  const [rows] = await pool.query('SELECT id, studentID, fname, lname, course, yrAndSec, profile FROM students WHERE studentID = ?', [code]);
  return rows[0] || null;
}
// Where this student stands today: the day's class status for their section, and any record they already have.
async function todayFor(stu, today) {
  const cls = (await classDays(stu.course, stu.yrAndSec, today, today))[0].class;
  const [ar] = await pool.query("SELECT status, TIME_FORMAT(timeIn,'%H:%i:%s') t FROM attendance WHERE student_id = ? AND attendDate = ?", [stu.id, today]);
  const rec = ar[0] ? { status: ar[0].status, time: to12(ar[0].t) } : null;
  let canRecord = true, reason = '';
  if (rec) {
    canRecord = false;
    reason = rec.status === 'PRESENT' ? 'Already recorded' + (rec.time ? ' at ' + rec.time : '') + '.' : `Already marked ${ATT_LABEL[rec.status]} today. Change it in the Attendance log.`;
  } else if (cls.status !== 'REQUIRED' && !cls.isDefault) {
    canRecord = false;
    reason = `No class today for this section (${STATUS_LABEL[cls.status]}${cls.note ? ': ' + cls.note : ''}). Change the day in the Attendance log first.`;
  }
  return { cls, rec, canRecord, reason, startsDay: cls.isDefault && canRecord };
}

router.get('/lookup', needStaff, h(async (req, res) => {
  const stu = await studentByNumber(String(req.query.studentID || '').trim().toUpperCase());
  if (!stu) return bad(res, 'No student found with that number.', 404);
  const today = manilaNow().date, t = await todayFor(stu, today);
  res.json({
    student: { studentID: stu.studentID, fname: stu.fname, lname: stu.lname, course: stu.course, yrAndSec: stu.yrAndSec, photo: photoUrl(stu.profile) },
    date: today, day: { status: t.cls.status, note: t.cls.note, type: t.cls.type || null }, record: t.rec, canRecord: t.canRecord, reason: t.reason, startsDay: t.startsDay,
  });
}));

router.post('/checkin', needStaff, h(async (req, res) => {
  const stu = await studentByNumber(String((req.body && req.body.studentID) || '').trim().toUpperCase());
  if (!stu) return bad(res, 'No student found with that number.', 404);
  const now = manilaNow(), t = await todayFor(stu, now.date);
  if (!t.canRecord) return bad(res, t.reason, 409);
  const [r] = await pool.query("INSERT IGNORE INTO attendance (student_id, attendDate, status, timeIn, source, recordedBy) VALUES (?, ?, 'PRESENT', ?, 'SCAN', ?)", [stu.id, now.date, now.time, req.user.id]);
  if (!r.affectedRows) return bad(res, 'Already recorded today.', 409);
  res.json({ ok: true, date: now.date, time: to12(now.time), startedDay: t.startsDay });
}));

// ---- Monitoring page: is today a class day? (admin / moderator) ----
// Same rule as the Attendance log: a section has class today when staff set it to "Has class", or as soon as one of
// its students is recorded PRESENT. Today is "No class" until that happens. A day set to Holiday for EVERYONE is reported as that holiday.
router.get('/today-status', needStaff, h(async (req, res) => {
  const today = manilaNow().date;
  const [classes] = await pool.query('SELECT course, yrAndSec, COUNT(*) students FROM students GROUP BY course, yrAndSec ORDER BY course, yrAndSec');
  const [rec] = await pool.query("SELECT s.course, s.yrAndSec, COUNT(*) n FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.attendDate = ? AND a.status = 'PRESENT' GROUP BY s.course, s.yrAndSec", [today]);
  const recorded = new Map(rec.map((r) => [r.course + '\u0001' + r.yrAndSec, r.n]));
  const byDate = await overridesByDate(today, today);
  const sections = [];
  let recordedTotal = 0, studentsTotal = 0, closed = 0;
  classes.forEach((c) => {
    studentsTotal += c.students;
    const n = recorded.get(c.course + '\u0001' + c.yrAndSec) || 0;
    recordedTotal += n;
    const eff = effectiveStatus(byDate, today, c.course, c.yrAndSec);
    if (eff === 'REQUIRED' || n > 0) sections.push({ course: c.course, yrAndSec: c.yrAndSec, students: c.students, recorded: n, auto: eff !== 'REQUIRED' });
    else if ((byDate.get(today) || []).some((x) => (!x.course || x.course === c.course) && (!x.yrAndSec || x.yrAndSec === c.yrAndSec))) closed++;
  });
  let status = sections.length ? 'REQUIRED' : 'NO_CLASS', note = '';
  if (!sections.length) {
    const [g] = await pool.query("SELECT status, note FROM class_days WHERE dayDate = ? AND course = '' AND yrAndSec = ''", [today]);
    if (g[0] && g[0].status !== 'REQUIRED') { status = g[0].status; note = g[0].note || ''; }
  }
  // only the section whose student was recorded most recently today (the Monitoring page shows just this one)
  let last = null;
  const [lr] = await pool.query("SELECT s.course, s.yrAndSec FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.attendDate = ? AND a.status = 'PRESENT' ORDER BY a.id DESC LIMIT 1", [today]);
  if (lr[0]) {
    const c = classes.find((x) => x.course === lr[0].course && x.yrAndSec === lr[0].yrAndSec);
    if (c) last = { course: c.course, yrAndSec: c.yrAndSec, students: c.students, recorded: recorded.get(c.course + '\u0001' + c.yrAndSec) || 0 };
  }
  res.json({ date: today, status, note, last, recorded: recordedTotal, students: studentsTotal, closedSections: closed, sectionCount: sections.length, sections: sections.slice(0, 12) });
}));

module.exports = router;