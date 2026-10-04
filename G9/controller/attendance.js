// Stand-in for controller/attendance.js (scan + today). Replace with your original if you recover it.
// Uses the Philippine (Asia/Manila) date and time, never the database server's clock. Times are shown in 12-hour form.
const pool = require('../database/db');
const uid = (req) => req.user && req.user.id;

function manilaNow() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = {};
  p.forEach((x) => { v[x.type] = x.value; });
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}:${v.minute}:${v.second}` };
}

async function scan(req, res) {
  try {
    const code = String((req.body && (req.body.studentID || req.body.code)) || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ message: 'Scan or enter a student number.' });
    const [rows] = await pool.query('SELECT id, studentID, fname, lname, course, yrAndSec FROM students WHERE studentID = ?', [code]);
    if (!rows[0]) return res.status(404).json({ message: 'No student found with that number.' });
    const now = manilaNow();
    const [r] = await pool.query(
      "INSERT IGNORE INTO attendance (student_id, attendDate, status, timeIn, source, recordedBy) VALUES (?, ?, 'PRESENT', ?, 'SCAN', ?)",
      [rows[0].id, now.date, now.time, uid(req)]);
    res.json({ message: r.affectedRows ? 'Attendance recorded.' : 'Already recorded today.', alreadyRecorded: !r.affectedRows, student: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error.' }); }
}

async function today(req, res) {
  try {
    const [records] = await pool.query(
      "SELECT a.id, a.status, TIME_FORMAT(a.timeIn,'%l:%i:%s %p') timeIn, s.studentID, s.fname, s.lname, s.course, s.yrAndSec FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.attendDate = ? ORDER BY a.timeIn DESC",
      [manilaNow().date]);
    res.json({ records });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error.' }); }
}

module.exports = { scan, today };