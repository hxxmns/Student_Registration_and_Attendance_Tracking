/* Attendance Log page (public/attendance.js) - talks to /api/attendance (controller/attendanceroutes.js)
   Modes: Day (one date, every student), Month / Semester / Term (statistics). A class = course + year + section. */
(function () {
  'use strict';
  var API = '/api/attendance', LOGIN = 'login.html';
  var $ = function (id) { return document.getElementById(id); };
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var ATT_L = { PRESENT: 'Present', ABSENT: 'Absent', EXCUSED: 'Excused', EXEMPTED: 'Exempted' };
  var CLS_L = { REQUIRED: 'Has class', NO_CLASS: 'No class', HOLIDAY: 'Holiday', CANCELLED: 'Cancelled', OTHER: 'Other' };
  var MOD_L = { FACE_TO_FACE: 'Face to face', ONLINE: 'Online', BLENDED: 'Blended' };
  var MODCOLOR = { FACE_TO_FACE: 'var(--cyan)', ONLINE: 'var(--violet)', BLENDED: '#FFC24D' };
  var EV_COLOR = { EVENT: 'var(--cyan)', ACTIVITY: 'var(--violet)', HOLIDAY: 'var(--magenta)', EXAM: '#FFB020' };
  var COLOR = { PRESENT: 'var(--ok)', ABSENT: 'var(--error)', EXCUSED: '#FFC24D', EXEMPTED: 'var(--violet)',
    REQUIRED: 'var(--cyan)', NO_CLASS: 'var(--muted)', HOLIDAY: 'var(--magenta)', CANCELLED: '#FF9F43', OTHER: '#7FD1FF' };

  var S = { ctx: null, staff: false, view: 'month', anchor: '', period: null, sel: null,
            cls: null, studentId: '', roster: [], data: null, mode: 'student', dayCache: null, picked: false, events: [] };

  /* ---------- helpers ---------- */
  var pad = function (n) { return ('0' + n).slice(-2); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthRange(a) {
    var p = a.split('-'), y = +p[0], m = +p[1], last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: y + '-' + pad(m) + '-01', to: y + '-' + pad(m) + '-' + pad(last) };
  }
  function addMonth(a, n) { var p = a.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-01'; }
  function shift(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dowOf(s) { return new Date(s + 'T00:00:00Z').getUTCDay(); }
  function fmt(s, o) { return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o)); }
  function fmtLong(s) { return fmt(s, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function rate(p, a) { return p + a ? Math.round(p / (p + a) * 100) : null; }   // excused counts as attended
  function tag(text, color) { return '<span class="tag" style="--c:' + color + '">' + esc(text) + '</span>'; }
  function setOn() { Array.prototype.forEach.call($('views').children, function (x) { x.classList.toggle('on', x.dataset.v === S.view); }); }

  function toast(m, err) {
    var t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 7000);
  }

  function api(method, url, body) {
    var o = { method: method, credentials: 'same-origin', headers: {} };
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(API + url, o).then(function (r) {
      if (r.status === 401) { location.href = LOGIN; throw new Error('Not signed in.'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var msg = j.message || (r.status === 404 ? "The attendance API route was not found. Check that server.js has app.use('/api/attendance', requireUser, require('./controller/attendanceroutes'))." : 'Request failed.');
          console.error('attendance api', r.status, method, API + url, j);
          throw new Error(msg + (j.detail ? ' [' + j.detail + ']' : '') + ' (' + r.status + ' ' + method + ' ' + API + url.split('?')[0] + ')');
        }
        return j;
      });
    });
  }
  function run(p) { return p.catch(function (e) { toast(e.message, true); }); }

  /* ---------- period / range ---------- */
  function terms(kind) { return ((S.ctx && S.ctx.terms) || []).filter(function (t) { return t.kind === kind; }); }
  function kindOf(v) { return v === 'semester' ? 'SEMESTER' : 'TERM'; }
  function pickPeriod(kind, date) {
    var list = terms(kind), t = date || today();
    S.period = list.filter(function (x) { return x.startDate <= t && t <= x.endDate; })[0] || list[list.length - 1] || null;
  }
  function range() {
    if (S.view === 'day') return { from: S.sel, to: S.sel };
    if (S.view === 'month') return monthRange(S.anchor);
    return S.period ? { from: S.period.startDate, to: S.period.endDate } : null;
  }
  function periodLabel() {
    if (S.view === 'day') return fmt(S.sel, { month: 'short', day: 'numeric', year: 'numeric' });
    if (S.view === 'month') return MON[+S.anchor.slice(5, 7) - 1] + ' ' + S.anchor.slice(0, 4);
    return S.period ? esc(S.period.name) : '';
  }

  /* ---------- loading ---------- */
  function dayData(d) {
    var c = { students: d.roster.length, present: 0, absent: 0, excused: 0, exempted: 0, pending: 0 };
    d.roster.forEach(function (s) { if (s.eff) c[s.eff.toLowerCase()]++; else c.pending++; });
    return { day: true, counts: c, classDays: [{ date: d.date, class: d.class }], daily: [], rows: [], total: 0, upcoming: 0 };
  }

  function load() {
    S.dayCache = null;
    if (!S.ctx) { toast('Could not load the attendance page.', true); return Promise.resolve(); }
    if (!S.staff && !S.ctx.student) {
      S.data = null; $('summary').innerHTML = '';
      $('view').innerHTML = '<p class="empty">No student record is linked to your account yet.</p>';
      return Promise.resolve();
    }
    if (S.staff && !S.cls) { S.data = null; render(); return Promise.resolve(); }
    if (S.view === 'day' && !S.sel) S.sel = today();
    var r = range();
    if (!r) { S.data = null; render(); return Promise.resolve(); }
    var job;
    if (S.staff && !S.studentId) {
      S.mode = 'class';
      if (S.view === 'day') {
        job = api('GET', '/day?' + qs({ course: S.cls.course, yrAndSec: S.cls.yrAndSec, date: S.sel })).then(function (d) {
          S.dayCache = { date: d.date, r: d }; S.roster = d.roster; fillStudents(); return dayData(d);
        });
      } else {
        job = api('GET', '/class-summary?' + qs({ course: S.cls.course, yrAndSec: S.cls.yrAndSec, from: r.from, to: r.to }))
          .then(function (d) { S.roster = d.rows; fillStudents(); return d; });
      }
    } else {
      S.mode = 'student';
      job = api('GET', '/log?' + qs({ from: r.from, to: r.to, studentId: S.studentId }));
    }
    return run(Promise.all([job, loadEvents(r)]).then(function (res) { S.data = res[0]; S.events = res[1]; render(); }));
  }
  // school events (Teachers' Day, Intramurals Week...) for the range on screen; never blocks the calendar if it fails
  function loadEvents(r) {
    return api('GET', '/events?' + qs({ from: r.from, to: r.to })).then(function (d) { return d.events || []; }, function () { return []; });
  }
  function evOn(day) { return (S.events || []).filter(function (e) { return e.startDate <= day && day <= e.endDate; }); }

  /* ---------- rendering ---------- */
  function card(label, val, color, sub) {
    return '<div class="sc" style="--c:' + color + '"><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
  }
  function rateBox(pct) {
    return '<div class="rate">Attendance rate: ' + (pct == null ? 'no counted classes yet' : pct + '%') + ' ((present + excused) &divide; (present + excused + absent); exempted days are not counted)<i style="--w:' + (pct || 0) + '%"></i></div>';
  }

  function renderSummary() {
    var d = S.data, h = '';
    if (!d) { $('summary').innerHTML = ''; return; }
    if (S.mode === 'student') {
      if (S.view === 'day') { $('summary').innerHTML = ''; return; }
      var s = d.summary;
      h = card('Total classes', s.total, COLOR.REQUIRED, s.upcoming ? s.upcoming + ' upcoming' : '') + card('Present', s.present, COLOR.PRESENT) +
        card('Absent', s.absent, COLOR.ABSENT) + card('Excused', s.excused, COLOR.EXCUSED) + card('Exempted', s.exempted, COLOR.EXEMPTED) +
        rateBox(rate(s.present + s.excused, s.absent));
    } else if (d.day) {
      var c = d.counts, cl = d.classDays[0].class;
      h = card('Students', c.students, COLOR.REQUIRED);
      if (cl.status !== 'REQUIRED') h += card('Class status', CLS_L[cl.status], COLOR[cl.status], cl.note || '');
      else h += card('Present', c.present, COLOR.PRESENT) + card('Absent', c.absent, COLOR.ABSENT) + card('Excused', c.excused, COLOR.EXCUSED) +
        card('Exempted', c.exempted, COLOR.EXEMPTED) + (c.pending ? card('Not recorded yet', c.pending, COLOR.NO_CLASS) : '');
    } else {
      var P = 0, A = 0, E = 0, X = 0;
      d.rows.forEach(function (x) { P += x.present; A += x.absent; E += x.excused; X += x.exempted; });
      h = card('Students', d.rows.length, COLOR.REQUIRED) + card('Class days', d.total, COLOR.REQUIRED, d.upcoming ? d.upcoming + ' upcoming' : '') +
        card('Present', P, COLOR.PRESENT) + card('Absent', A, COLOR.ABSENT) + card('Excused', E, COLOR.EXCUSED) + card('Exempted', X, COLOR.EXEMPTED) +
        rateBox(rate(P + E, A));
    }
    $('summary').innerHTML = h;
  }

  function dayMap() {
    var d = S.data, m = {};
    if (!d) return m;
    if (S.mode === 'student') d.days.forEach(function (x) { m[x.date] = { cls: x.class, att: x.att, eff: x.eff }; });
    else {
      var daily = {};
      d.daily.forEach(function (x) { daily[x.date] = x; });
      d.classDays.forEach(function (x) { m[x.date] = { cls: x.class, daily: daily[x.date] }; });
    }
    return m;
  }

  function cellInfo(x) {
    var c = x.cls;
    if (c.status === 'REQUIRED') {
      if (S.mode === 'student') return x.eff ? { label: ATT_L[x.eff], color: COLOR[x.eff] } : { label: '', color: COLOR.REQUIRED };
      var dl = x.daily;
      if (!dl) return { label: '', color: COLOR.REQUIRED };
      return { label: dl.present + '/' + (dl.present + dl.absent + dl.excused + dl.exempted), color: COLOR.PRESENT };
    }
    return { label: '', color: COLOR[c.status], dim: true };   // nothing is written on a day without class
  }

  function renderCalendars() {
    var r = range(), map = dayMap(), T = today(), h = '';
    if (!r) return '<p class="empty">No ' + (S.view === 'semester' ? 'semester' : 'term') + ' has been set yet.</p>';
    for (var m = r.from.slice(0, 7) + '-01'; m <= r.to; m = addMonth(m, 1)) {
      var mr = monthRange(m), y = +m.slice(0, 4), mo = +m.slice(5, 7);
      h += '<h4 class="mh">' + MON[mo - 1] + ' ' + y + '</h4><div class="cal edit">' + DOW.map(function (n) { return '<div class="dow">' + n + '</div>'; }).join('');
      for (var i = 0; i < dowOf(mr.from); i++) h += '<div class="cell pad"></div>';
      for (var day = mr.from; day <= mr.to; day = shift(day, 1)) {
        if (day < r.from || day > r.to || !map[day]) { h += '<div class="cell pad"></div>'; continue; }
        var ci = cellInfo(map[day]), cl = map[day].cls, hasClass = cl.status === 'REQUIRED', evs = evOn(day), md = cl.modality || 'FACE_TO_FACE';
        var tip = hasClass ? MOD_L[md] : (cl.isDefault ? '' : CLS_L[cl.status] + (cl.note ? ' \u00b7 ' + cl.note : ''));
        h += '<button type="button" class="cell' + (ci.label ? ' has' : '') + (ci.dim ? ' dim' : '') + (evs.length ? ' hasev' : '') + (day === T ? ' today' : '') + (day === S.sel ? ' sel' : '') +
          '" data-d="' + day + '" style="--c:' + ci.color + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><i>' + +day.slice(8) + '</i><span>' + esc(ci.label) + '</span>' +
          (hasClass ? '<small class="mod" data-m="' + md + '">' + MOD_L[md] + '</small>' : '') +
          (evs.length ? '<span class="evs">' + evs.slice(0, 2).map(function (e) { return '<em data-cat="' + e.category + '">' + esc(e.title) + '</em>'; }).join('') + (evs.length > 2 ? '<b>+' + (evs.length - 2) + ' more</b>' : '') + '</span>' : '') + '</button>';
      }
      h += '</div>';
    }
    return h;
  }

  function modeLine() {
    var r = range(), map = dayMap(), n = {}, any = false;
    if (S.view === 'day' || !r) return '';
    for (var d = r.from; d <= r.to; d = shift(d, 1)) {
      var x = map[d];
      if (x && x.cls.status === 'REQUIRED') { var m = x.cls.modality || 'FACE_TO_FACE'; n[m] = (n[m] || 0) + 1; any = true; }
    }
    if (!any) return '';
    return '<p class="modes">How classes are held in this period:' + Object.keys(MOD_L).filter(function (k) { return n[k]; }).map(function (k) {
      return tag(MOD_L[k] + ': ' + n[k] + (n[k] === 1 ? ' day' : ' days'), MODCOLOR[k]);
    }).join(' ') + '</p>';
  }

  function classTable() {
    var d = S.data;
    if (!d.rows.length) return '<p class="empty">No students are registered in this class.</p>';
    return '<div class="tbl-wrap"><table class="log"><thead><tr><th>ID</th><th>Student</th><th>Classes</th><th>Present</th><th>Absent</th><th>Excused</th><th>Exempted</th><th>Rate</th></tr></thead><tbody>' +
      d.rows.map(function (x) {
        var p = rate(x.present + x.excused, x.absent);
        return '<tr class="row edit" data-sid="' + x.id + '"><td>' + esc(x.studentID) + '</td><td>' + esc(x.lname + ', ' + x.fname) + '</td><td>' + x.total + '</td><td>' + x.present + '</td><td>' + x.absent + '</td><td>' + x.excused + '</td><td>' + x.exempted + '</td><td>' + (p == null ? '—' : p + '%') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function render() {
    var d = S.data, v = S.view;
    $('heroSub').textContent = S.staff ? (S.cls ? S.cls.course + ' · ' + S.cls.yrAndSec + (S.mode === 'student' && d ? ' · ' + d.student.fname + ' ' + d.student.lname : '') : '')
      : (S.ctx.student ? '' : 'No student record yet.');
    $('heroSub').hidden = !$('heroSub').textContent;
    fillStudents();
    var pv = v === 'semester' || v === 'term';
    $('monthNav').hidden = pv; $('period').hidden = !pv;
    $('prev').setAttribute('aria-label', v === 'day' ? 'Previous day' : 'Previous month');
    $('next').setAttribute('aria-label', v === 'day' ? 'Next day' : 'Next month');
    if (!pv) $('monthLabel').textContent = periodLabel();
    $('jump').value = S.sel || '';
    setOn();
    renderSummary();
    if (S.staff && !S.cls) {
      $('view').innerHTML = '<p class="empty">No students are registered yet.</p>';
      return;
    }
    var dp = '<div class="dp" id="dp" hidden></div>';
    if (v === 'day') $('view').innerHTML = dp;
    else $('view').innerHTML = modeLine() + (d && S.mode === 'class' ? '<h4 class="mh">Student statistics &middot; ' + periodLabel() + '</h4>' + classTable() : '') + renderCalendars() + dp;
    renderDay();
  }

  /* ---------- selected-day panel (Day mode, or after clicking a date in the calendar) ---------- */
  function curClass(date) {
    var x = dayMap()[date];
    return x ? x.cls : { status: 'REQUIRED', note: '', isDefault: true };
  }
  function getRoster(date) {
    if (S.dayCache && S.dayCache.date === date) return Promise.resolve(S.dayCache.r);
    return api('GET', '/day?' + qs({ course: S.cls.course, yrAndSec: S.cls.yrAndSec, date: date })).then(function (r) { S.dayCache = { date: date, r: r }; return r; });
  }

  function renderDay() {
    var dp = $('dp'), date = S.sel;
    if (!dp || !date || !S.data || !dayMap()[date]) return;
    var c = curClass(date), x = dayMap()[date];
    dp.hidden = false;
    var evs = evOn(date), md = c.modality || 'FACE_TO_FACE';
    var head = '<h3>' + fmtLong(date) + '</h3><p>' + tag(CLS_L[c.status], COLOR[c.status]) + (c.status === 'REQUIRED' ? ' ' + tag(MOD_L[md], MODCOLOR[md]) : '') + (c.note ? ' &nbsp;' + esc(c.note) : '') + (c.isDefault ? ' <small>(default calendar)</small>' : '') + '</p>' +
      (evs.length ? '<p>' + evs.map(function (e) { return tag(e.title, EV_COLOR[e.category]) + (e.startDate !== e.endDate ? ' <small>' + fmt(e.startDate, { month: 'short', day: 'numeric' }) + ' \u2013 ' + fmt(e.endDate, { month: 'short', day: 'numeric' }) + '</small>' : '') + (e.note ? ' <small>' + esc(e.note) + '</small>' : ''); }).join(' &nbsp; ') + '</p>' : '');
    var edit = S.staff ? '<button type="button" class="ghost" data-edit="1">Edit this day</button>' : '';
    if (S.mode === 'student') {
      var a = x.att, line = c.status !== 'REQUIRED' ? 'No attendance is counted on this day.'
        : (x.eff ? 'Attendance: ' + tag(ATT_L[x.eff], COLOR[x.eff]) + (a && a.timeIn ? ' &nbsp;time in ' + a.timeIn : '') + (a ? ' &nbsp;<small>(' + (a.source === 'SCAN' ? 'scanned' : 'recorded manually') + ')</small>' : (x.eff === 'ABSENT' ? ' <small>(no record)</small>' : ''))
          : 'Attendance has not been recorded yet.');
      dp.innerHTML = head + '<p>' + line + '</p>' + edit;
      return;
    }
    dp.innerHTML = head + edit + '<p>Loading students…</p>';
    getRoster(date).then(function (r) {
      if (date !== S.sel || !$('dp')) return;
      var req = r.class.status === 'REQUIRED';
      var rows = r.roster.map(function (s) {
        var st = req ? (s.eff ? tag(ATT_L[s.eff], COLOR[s.eff]) : tag('Not recorded yet', COLOR.NO_CLASS)) : tag(CLS_L[r.class.status], COLOR[r.class.status]);
        return '<tr><td>' + esc(s.studentID) + '</td><td>' + esc(s.lname + ', ' + s.fname) + '</td><td>' + st + '</td><td>' + (req && s.status === 'PRESENT' ? '<input type="time" class="att-in" data-time="' + s.id + '" value="' + esc(s.timeIn || '') + '" aria-label="Time in">' : (s.timeIn || '—')) + '</td><td><select class="att-in" data-id="' + s.id + '"' + (req ? '' : ' disabled') + '>' +
          '<option value="">No record</option>' +
          Object.keys(ATT_L).map(function (k) { return '<option value="' + k + '"' + (s.status === k ? ' selected' : '') + '>' + ATT_L[k] + '</option>'; }).join('') +
          '</select></td></tr>';
      }).join('');
      dp.innerHTML = head + edit + (req ? '' : '<p>No attendance is counted on this day.</p>') +
        (r.roster.length ? '<div class="tbl-wrap"><table class="log"><thead><tr><th>ID</th><th>Student</th><th>Status</th><th>Time in</th><th>Change</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="empty">No students in this class.</p>');
    }).catch(function (e) { toast(e.message, true); });
  }

  function select(date, scroll) {
    S.sel = date; S.picked = true; render();
    var dp = $('dp');
    if (scroll && dp && !dp.hidden) dp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- legend, class picker ---------- */
  function renderLegend() {
    var all = [['PRESENT', ATT_L], ['ABSENT', ATT_L], ['EXCUSED', ATT_L], ['EXEMPTED', ATT_L], ['NO_CLASS', CLS_L], ['HOLIDAY', CLS_L], ['CANCELLED', CLS_L], ['OTHER', CLS_L]];
    $('legend').innerHTML = all.map(function (p) { return '<span style="--c:' + COLOR[p[0]] + '">' + p[1][p[0]] + '</span>'; }).join('');
  }
  function fillPeriod() {
    if (S.view !== 'semester' && S.view !== 'term') return;
    var kind = kindOf(S.view), list = terms(kind);
    if (!S.period || S.period.kind !== kind || !list.some(function (t) { return t.id === S.period.id; })) pickPeriod(kind, S.sel);
    $('period').innerHTML = list.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + ' (' + t.startDate + ' to ' + t.endDate + ')</option>'; }).join('');
    if (S.period) $('period').value = S.period.id;
  }

  var classes = [];
  function parse(c) { return { course: c.course, yrAndSec: c.yrAndSec, students: c.students }; }
  var keyOf = function (c) { return c.course + '\u0001' + c.yrAndSec; };

  /* the page opens where you left off: same class and view as last time (stored in this browser only) */
  var MEM = 'g9-attendance-log';
  function recall() { try { return JSON.parse(localStorage.getItem(MEM) || '{}') || {}; } catch (e) { return {}; } }
  function remember() { try { localStorage.setItem(MEM, JSON.stringify({ v: S.view, c: S.cls ? keyOf(S.cls) : '' })); } catch (e) { /* storage unavailable */ } }

  /* one dropdown for the class (course + year + section); the first class is chosen when there is nothing to remember */
  function fillClass(key) {
    var pick = 0;
    classes.forEach(function (c, i) { if (keyOf(c) === key) pick = i; });
    $('cClass').innerHTML = classes.map(function (c, i) {
      return '<option value="' + i + '"' + (i === pick ? ' selected' : '') + '>' + esc(c.course) + ' · ' + esc(c.yrAndSec) + ' (' + c.students + ')</option>';
    }).join('');
    $('cClass').disabled = !classes.length;
    S.cls = classes.length ? { course: classes[pick].course, yrAndSec: classes[pick].yrAndSec } : null;
  }
  function syncStu() {
    var on = S.staff && !!S.studentId;
    $('stuPrev').hidden = !on; $('stuNext').hidden = !on; $('stuAll').hidden = !on;
  }
  function fillStudents() {
    var cur = S.studentId;
    $('student').disabled = !S.cls;
    $('student').innerHTML = '<option value="">All students in this class</option>' + S.roster.map(function (s) {
      return '<option value="' + s.id + '"' + (String(s.id) === String(cur) ? ' selected' : '') + '>' + esc(s.lname + ', ' + s.fname + ' (' + s.studentID + ')') + '</option>';
    }).join('');
    syncStu();
  }
  function stepStudent(n) {
    var i = -1;
    S.roster.forEach(function (s, k) { if (String(s.id) === String(S.studentId)) i = k; });
    var j = i + n;
    if (i < 0 || j < 0 || j >= S.roster.length) return;
    S.studentId = String(S.roster[j].id); run(load());
  }
  function classChanged() {
    var c = classes[+$('cClass').value];
    S.cls = c ? { course: c.course, yrAndSec: c.yrAndSec } : null;
    if (S.staff) sdSync();
    S.studentId = ''; S.roster = []; S.data = null; fillStudents(); remember(); run(load());
  }

  /* ---------- edit dialog ---------- */
  // The time is typed by hand and only applies to a Present record; editing a status never fills it in.
  function syncTime() {
    var t = $('dTime'); if (!t) return;
    t.disabled = $('dAtt').value !== 'PRESENT';
    if (t.disabled) t.value = '';
  }
  // modality only applies to a day with class
  function syncMod() { if ($('dModWrap')) $('dModWrap').hidden = $('dClass').value !== 'REQUIRED'; }
  function openEdit() {
    var date = S.sel, c = curClass(date), stuMode = S.mode === 'student', x = dayMap()[date];
    $('dTitle').textContent = fmtLong(date);
    $('dSub').textContent = stuMode ? S.data.student.fname + ' ' + S.data.student.lname + ' · ' + S.data.student.course + ' ' + S.data.student.yrAndSec : S.cls.course + ' ' + S.cls.yrAndSec;
    $('dClass').value = c.status; $('dNote').value = c.note || ''; $('dScope').value = 'class';
    if ($('dMod')) { $('dMod').value = c.modality || 'FACE_TO_FACE'; syncMod(); }
    $('dAtt').parentNode.hidden = !stuMode;
    if ($('dTimeWrap')) $('dTimeWrap').hidden = !stuMode;
    if (stuMode) $('dAtt').value = x && x.att ? x.att.status : '';
    if ($('dTime')) { $('dTime').value = stuMode && x && x.att && x.att.timeIn ? x.att.timeIn : ''; syncTime(); }
    $('dlg').showModal();
  }
  function classArgs() {
    var cl = S.mode === 'student' ? S.data.student : S.cls;
    return { scope: $('dScope').value, course: cl.course, yrAndSec: cl.yrAndSec };
  }
  function notifyOn(id) { var el = $(id); return el ? el.checked : true; }
  function mailText(m) {
    if (!m) return '';
    if (m.status === 'sending') return ' Emailing ' + m.students + (m.students === 1 ? ' student.' : ' students.');
    if (m.status === 'not_configured') return ' Students were NOT emailed: email is not set up on the server.';
    return '';
  }
  function saveEdit() {
    var date = S.sel, c = curClass(date), jobs = Promise.resolve(), mail = null;
    var status = $('dClass').value, note = $('dNote').value.trim(), mod = $('dMod') ? $('dMod').value : 'FACE_TO_FACE';
    if (status !== c.status || note !== (c.note || '') || (status === 'REQUIRED' && mod !== (c.modality || 'FACE_TO_FACE'))) {
      var a = classArgs(); a.date = date; a.status = status; a.note = note; a.notify = notifyOn('dNotify');
      if (status === 'REQUIRED') a.modality = mod;
      jobs = api('PUT', '/class-day', a).then(function (d) { mail = d && d.mail; });
    }
    if (S.mode === 'student') {
      var x = dayMap()[date], before = x && x.att ? x.att.status : '', now = $('dAtt').value;
      var tb = x && x.att && x.att.timeIn ? x.att.timeIn : '', tn = $('dTime') && now === 'PRESENT' ? $('dTime').value : tb;
      if (now !== before || (now === 'PRESENT' && tn !== tb)) {
        var rec = { studentId: S.data.student.id, date: date, status: now };
        if ($('dTime') && now === 'PRESENT') rec.timeIn = tn;   // only sent when you typed/changed it
        jobs = jobs.then(function () { return api('PUT', '/record', rec); });
      }
    }
    run(jobs.then(function () { $('dlg').close(); toast('Saved.' + mailText(mail)); return load(); }));
  }

  /* ---------- events ---------- */
  function bind() {
    if (!document.querySelector('#views [data-v="day"]')) {   // in case attendance.html was not updated
      var db = document.createElement('button'); db.type = 'button'; db.dataset.v = 'day'; db.textContent = 'Day';
      $('views').insertBefore(db, $('views').firstChild);
    }
    $('views').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.view = b.dataset.v;
      if (S.view === 'day') S.sel = S.sel || today();
      else if (S.view === 'month') { if (S.picked && S.sel) S.anchor = S.sel.slice(0, 7) + '-01'; }
      else { S.period = null; pickPeriod(kindOf(S.view), S.sel); }
      remember(); fillPeriod(); run(load());
    });
    $('prev').onclick = function () { if (S.view === 'day') { S.sel = shift(S.sel, -1); S.picked = true; } else S.anchor = addMonth(S.anchor, -1); run(load()); };
    $('next').onclick = function () { if (S.view === 'day') { S.sel = shift(S.sel, 1); S.picked = true; } else S.anchor = addMonth(S.anchor, 1); run(load()); };
    $('today').onclick = function () { S.picked = true; S.sel = today(); S.anchor = S.sel.slice(0, 7) + '-01'; run(load()); };   // stays in the current mode
    $('period').onchange = function () { S.period = terms(kindOf(S.view)).filter(function (t) { return String(t.id) === $('period').value; })[0] || null; run(load()); };
    $('jump').onchange = function () {   // picking a date never changes the mode
      var d = $('jump').value; if (!d) return;
      if (S.view === 'semester' || S.view === 'term') {
        var hit = terms(kindOf(S.view)).filter(function (t) { return t.startDate <= d && d <= t.endDate; })[0];
        if (!hit) { toast('That date is not inside any ' + (S.view === 'semester' ? 'semester' : 'term') + '.', true); $('jump').value = S.sel || ''; return; }
        S.period = hit; fillPeriod();
      } else if (S.view === 'month') S.anchor = d.slice(0, 7) + '-01';
      S.sel = d; S.picked = true; run(load());
    };
    $('view').addEventListener('click', function (e) {
      var cell = e.target.closest('.cell[data-d]'), row = e.target.closest('tr[data-sid]');
      if (cell) return select(cell.dataset.d, true);
      if (e.target.closest('[data-edit]')) return openEdit();
      if (row) { S.studentId = row.dataset.sid; run(load()); }
    });
    $('view').addEventListener('change', function (e) {
      var tm = e.target.closest('input[data-time]');
      if (tm) {   // typed by hand: set or clear the time of an existing Present record
        run(api('PUT', '/record', { studentId: tm.dataset.time, date: S.sel, status: 'PRESENT', timeIn: tm.value }).then(function () { toast(tm.value ? 'Time updated.' : 'Time cleared.'); return load(); }));
        return;
      }
      var sel = e.target.closest('select[data-id]'); if (!sel) return;
      run(api('PUT', '/record', { studentId: sel.dataset.id, date: S.sel, status: sel.value }).then(function () { toast('Attendance updated.'); return load(); }));
    });
    $('dCancel').onclick = function () { $('dlg').close(); };
    $('dAtt').onchange = syncTime;
    $('dClass').onchange = syncMod;
    $('dSave').onclick = saveEdit;
    $('dReset').onclick = function () {
      var a = classArgs(); a.date = S.sel; a.notify = notifyOn('dNotify');
      run(api('DELETE', '/class-day?' + qs(a)).then(function (d) { $('dlg').close(); toast('Class day reset to default.' + mailText(d && d.mail)); return load(); }));
    };
    $('cClass').onchange = classChanged;
    $('student').onchange = function () { S.studentId = $('student').value; run(load()); };
    $('stuPrev').onclick = function () { stepStudent(-1); };
    $('stuNext').onclick = function () { stepStudent(1); };
    $('stuAll').onclick = function () { S.studentId = ''; run(load()); };
    // left / right arrow keys step to the previous / next day or month
    document.addEventListener('keydown', function (e) {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var t = e.target;
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('dialog[open], .g9-drawer.open') || S.view === 'semester' || S.view === 'term') return;
      e.preventDefault();
      $(e.key === 'ArrowLeft' ? 'prev' : 'next').click();
    });
  }

  /* ---------- set class days (admin / moderator): a date range + weekdays for a section, a course, or everyone ---------- */
  var SD_DAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]];
  var SD_SCOPE = { class: 'this section', course: 'every section of this course', all: 'every course and section' };
  function sdSync() {
    var scope = $('sdScope').value, ok = scope === 'all' || !!S.cls;
    $('sdClass').textContent = scope === 'all' ? 'Everyone' : S.cls ? S.cls.course + ' · ' + (scope === 'course' ? 'every section' : S.cls.yrAndSec) : '';
    $('sdApply').disabled = !ok; $('sdReset').disabled = !ok;
  }
  function sdFillQuick() {
    var cur = $('sdQuick').value;
    $('sdQuick').innerHTML = '<option value="">Custom dates</option>' + ((S.ctx && S.ctx.terms) || []).map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + ' (' + t.startDate + ' to ' + t.endDate + ')</option>';
    }).join('');
    $('sdQuick').value = cur;
  }
  function sdPickQuick() {
    var id = $('sdQuick').value;
    var t = ((S.ctx && S.ctx.terms) || []).filter(function (x) { return String(x.id) === id; })[0];
    if (t) { $('sdFrom').value = t.startDate; $('sdTo').value = t.endDate; }
  }
  function sdArgs() {
    var from = $('sdFrom').value, to = $('sdTo').value || from, scope = $('sdScope').value;
    if (!from) { toast('Choose a start date.', true); return null; }
    if (to < from) { toast('The end date must be on or after the start date.', true); return null; }
    if (scope !== 'all' && !S.cls) { toast('Choose a course, year and section first.', true); return null; }
    var a = { date: from, endDate: to, scope: scope, notify: notifyOn('sdNotify') };
    if (S.cls) { a.course = S.cls.course; a.yrAndSec = S.cls.yrAndSec; }
    return a;
  }
  function sdApply() {
    var a = sdArgs(); if (!a) return;
    var wd = Array.prototype.filter.call($('sdDays').querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return Number(x.value); });
    if (!wd.length) return toast('Choose at least one day of the week.', true);
    if (wd.length < 7) a.weekdays = wd;
    a.status = $('sdStatus').value; a.note = $('sdNote').value.trim();
    if (a.status === 'REQUIRED' && $('sdMod')) a.modality = $('sdMod').value;
    if (a.status === 'OTHER' && !a.note) return toast('Add a short note for this case.', true);
    if (a.scope !== 'class' && !confirm('Set these class days for ' + SD_SCOPE[a.scope] + '?')) return;
    run(api('PUT', '/class-day', a).then(function (d) {
      toast('Saved. ' + d.days + (d.days === 1 ? ' day' : ' days') + ' set to "' + CLS_L[a.status] + '".' + mailText(d.mail));
      return load();
    }));
  }
  function sdReset() {
    var a = sdArgs(); if (!a) return;
    if (!confirm('Reset every day from ' + a.date + ' to ' + a.endDate + ' back to the default (no class) for ' + SD_SCOPE[a.scope] + '? The weekday boxes are ignored for a reset.')) return;
    run(api('DELETE', '/class-day?' + qs(a)).then(function (d) { toast('Class days reset to default.' + mailText(d && d.mail)); return load(); }));
  }
  function sdInit() {
    if (!$('setDays')) return;   // attendance.html was not updated
    $('setDays').hidden = false;
    $('sdDays').innerHTML = SD_DAYS.map(function (d) {
      return '<label class="sd-day"><input type="checkbox" value="' + d[1] + '"' + (d[1] >= 1 && d[1] <= 5 ? ' checked' : '') + '>' + d[0] + '</label>';
    }).join('');
    sdFillQuick();
    var t = today(), cur = ((S.ctx && S.ctx.terms) || []).filter(function (x) { return x.kind === 'SEMESTER' && x.startDate <= t && t <= x.endDate; })[0];
    if (cur) { $('sdQuick').value = cur.id; sdPickQuick(); }
    $('sdQuick').onchange = sdPickQuick;
    $('sdScope').onchange = sdSync;
    $('sdStatus').onchange = function () { $('sdModWrap').hidden = $('sdStatus').value !== 'REQUIRED'; };
    $('sdApply').onclick = sdApply;
    $('sdReset').onclick = sdReset;
    $('setDays').addEventListener('toggle', function () { if ($('setDays').open) sdFillQuick(); });
    sdSync();
  }

  /* ---------- start ---------- */
  function init() {
    S.anchor = today().slice(0, 7) + '-01'; S.sel = today();   // opens on today, so today's details are already showing
    renderLegend(); bind();
    run(api('GET', '/context').then(function (c) {
      S.ctx = c; S.staff = c.userType === 'ADMIN' || c.userType === 'MODERATOR';
      $('stuWrap').hidden = !S.staff;
      var m = recall();
      if (/^(day|month|semester|term)$/.test(m.v || '') && (m.v === 'day' || m.v === 'month' || terms(kindOf(m.v)).length)) S.view = m.v;
      if (S.view === 'semester' || S.view === 'term') { pickPeriod(kindOf(S.view), S.sel); fillPeriod(); }
      if (S.staff) {
        classes = c.classes.map(parse);
        fillClass(m.c); fillStudents(); sdInit();
        $('who').innerHTML = '<b>' + esc(c.userType) + '</b>';
      } else if (c.student) {
        $('who').innerHTML = '<b>' + esc(c.student.fname + ' ' + c.student.lname) + '</b><span>' + esc(c.student.studentID + ' · ' + c.student.course + ' ' + c.student.yrAndSec) + '</span>';
      } else {
        $('heroSub').textContent = 'No student record is linked to your account yet.';
      }
      return load();
    }));
  }
  init();
})();