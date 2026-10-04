const STATUSES = ['REQUIRED', 'NO_CLASS', 'HOLIDAY', 'CANCELLED', 'OTHER'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

function manilaNow(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now || new Date());
  const v = {};
  parts.forEach((p) => { v[p.type] = p.value; });
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}:${v.minute}:${v.second}` };
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(s) {
  return new Date(s + 'T00:00:00Z').getUTCDay();
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function monthBounds(date) {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

function resolveDay(rows) {
  let best = null;
  let bestRank = -1;
  for (const r of rows || []) {
    const rank = r.yrAndSec ? 2 : (r.course ? 1 : 0);
    if (rank > bestRank) { best = r; bestRank = rank; }
  }
  return best
    ? { status: best.status, note: best.note || '', implicit: false, scope: ['all', 'course', 'class'][bestRank] }
    : null;
}

function groupByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r);
  }
  return map;
}

// Every day defaults to NO_CLASS. A day has class only when an admin/moderator sets it to REQUIRED,
// or when someone in the class is recorded present (presentDates, a Set of 'YYYY-MM-DD').
function classInfos(from, to, overrideRows, presentDates) {
  const byDate = groupByDate(overrideRows);
  return eachDate(from, to).map((date) => {
    const dow = dayOfWeek(date);
    const hit = resolveDay(byDate.get(date));
    const info = hit
      ? { date, dow, ...hit }
      : { date, dow, status: 'NO_CLASS', note: '', implicit: true, scope: null };
    if (presentDates && presentDates.has(date) && info.status !== 'REQUIRED') {
      return { date, dow, status: 'REQUIRED', note: 'Auto: attendance recorded', implicit: false, scope: 'class', auto: true };
    }
    return info;
  });
}

function studentDays(infos, { joined, today, attended }) {
  const summary = { present: 0, absent: 0, required: 0, excluded: 0, percent: null };
  const days = infos.map((info) => {
    const recorded = attended.has(info.date);
    let state;
    if (joined && info.date < joined) state = 'BEFORE';
    else if (info.status !== 'REQUIRED') state = 'EXCLUDED';
    else if (info.date > today) state = 'UPCOMING';
    else if (recorded) state = 'PRESENT';
    else if (info.date === today) state = 'PENDING';
    else state = 'ABSENT';

    if (state === 'PRESENT') summary.present++;
    else if (state === 'ABSENT') summary.absent++;
    else if (state === 'EXCLUDED' && !info.implicit) summary.excluded++;

    return { ...info, state, recorded, time: recorded ? (attended.get(info.date) || null) : null };
  });
  summary.required = summary.present + summary.absent;
  summary.percent = summary.required ? Math.round((summary.present / summary.required) * 100) : null;
  return { days, summary };
}

module.exports = {
  STATUSES, manilaNow, isValidDate, addDays, dayOfWeek, daysBetween, eachDate,
  monthBounds, resolveDay, classInfos, studentDays,
};