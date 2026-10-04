// Academic calendar page: a month calendar of school years, semesters, terms and events. Everyone can see it.
// Admins / moderators additionally get the Calendar | Calendar setter toggle (set up by loadSetter below, staff only).
(function () {
  'use strict';
  var API = '/api/attendance';
  var grid = document.getElementById('calGrid');
  if (!grid) return;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CAT = { EVENT: 'Event', ACTIVITY: 'Activity', HOLIDAY: 'Holiday', EXAM: 'Exam' };

  var st = document.createElement('style');
  st.textContent = '.ev-top { display: flex; align-items: center; gap: .6rem; } ' +
    '.ev-live { padding: 1px 8px; font-size: .62rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ok); border: 1px solid var(--ok); border-radius: 999px; background: rgba(61,255,176,.1); box-shadow: 0 0 10px rgba(61,255,176,.3); }';
  document.head.appendChild(st);

  var today = manila();
  var cursor = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
  var sel = today, years = [], events = [], upcoming = [], staff = false, token = 0;

  function manila() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dt(s) { return new Date(s + 'T00:00:00Z'); }
  function addDays(s, n) { var d = dt(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function short(s) { var p = s.split('-'); return MON[p[1] - 1] + ' ' + Number(p[2]); }
  function fmt(s) { return short(s) + ', ' + s.slice(0, 4); }
  function range(a, b) {
    if (a === b) return fmt(a);
    return a.slice(0, 4) === b.slice(0, 4) ? short(a) + ' – ' + short(b) + ', ' + b.slice(0, 4) : fmt(a) + ' – ' + fmt(b);
  }
  function longDate(s) { return dt(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  function inR(x, d) { return x.startDate <= d && d <= x.endDate; }
  function $(id) { return document.getElementById(id); }

  function call(path) {
    return fetch(API + path, { credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.message || 'Something went wrong.'); return d; }); });
  }

  // Which school year / semester / term a date falls in.
  function periodOf(d) {
    var o = { year: null, sem: null, term: null };
    years.forEach(function (y) {
      if (!inR(y, d)) return;
      o.year = y;
      (y.semesters || []).forEach(function (s) {
        if (!inR(s, d)) return;
        o.sem = s;
        (s.terms || []).forEach(function (t) { if (inR(t, d)) o.term = t; });
      });
    });
    return o;
  }
  function periodText(p) {
    return p.year ? p.year.name + (p.sem ? ' · ' + p.sem.name : '') + (p.term ? ' · ' + p.term.name : '') : '';
  }
  function evOn(d) { return events.filter(function (e) { return e.startDate <= d && d <= e.endDate; }); }

  function gridBounds() {
    var first = cursor.y + '-' + pad(cursor.m) + '-01';
    var offset = dt(first).getUTCDay();
    var days = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
    var rows = Math.ceil((offset + days) / 7), start = addDays(first, -offset);
    return { first: first, last: cursor.y + '-' + pad(cursor.m) + '-' + pad(days), start: start, end: addDays(start, rows * 7 - 1), cells: rows * 7 };
  }

  // "Now" box in the hero: the school year / semester / term running today.
  function showNow() {
    var el = $('now'); if (!el) return;
    var p = periodOf(today);
    el.innerHTML = p.year
      ? '<b>' + esc(p.year.name) + '</b><span>' + (p.sem ? esc(p.sem.name) : 'No semester running') + (p.term ? ' · ' + esc(p.term.name) : '') + '</span>'
      : '<b>No school year running</b><span>Today is outside every school year</span>';
  }

  function renderPeriods(g) {
    var out = [];
    function hit(x) { return x.startDate <= g.last && x.endDate >= g.first; }
    years.forEach(function (y) {
      if (hit(y)) out.push(['School year', y]);
      (y.semesters || []).forEach(function (s) {
        if (hit(s)) out.push(['Semester', s]);
        (s.terms || []).forEach(function (t) { if (hit(t)) out.push(['Term', t]); });
      });
    });
    $('calPeriods').innerHTML = out.length
      ? out.map(function (o) { return '<li><i>' + o[0] + '</i><b>' + esc(o[1].name) + '</b><small>' + range(o[1].startDate, o[1].endDate) + '</small></li>'; }).join('')
      : '<li class="none">No school year, semester or term covers this month.</li>';
  }

  function renderGrid() {
    var g = gridBounds(), h = '';
    $('calLabel').textContent = MONTHS[cursor.m - 1] + ' ' + cursor.y;
    renderPeriods(g);
    DOW.forEach(function (n) { h += '<div class="cal-dow">' + n + '</div>'; });
    for (var i = 0; i < g.cells; i++) {
      var d = addDays(g.start, i), dow = i % 7, p = periodOf(d), list = evOn(d);
      var cls = 'cal-cell' + (d.slice(0, 7) !== g.first.slice(0, 7) ? ' other' : '') + (d === today ? ' today' : '') + (d === sel ? ' sel' : '') +
        (p.term ? ' p-term' : p.sem ? ' p-sem' : p.year ? ' p-year' : '');
      var label = fmt(d) + (list.length ? ', ' + list.length + (list.length === 1 ? ' event' : ' events') : '');
      h += '<button type="button" class="' + cls + '" data-d="' + d + '" aria-label="' + esc(label) + '"><span class="cal-n">' + Number(d.slice(8)) + '</span>';
      list.slice(0, 2).forEach(function (e) {
        // A range shows its name on the first day and on each Sunday; the days in between are just the coloured bar.
        var named = d === e.startDate || dow === 0;
        h += '<span class="cal-ev' + (d > e.startDate ? ' cl' : '') + (d < e.endDate ? ' cr' : '') + '" data-cat="' + e.category + '">' + (named ? esc(e.title) : '&nbsp;') + '</span>';
      });
      if (list.length > 2) h += '<span class="cal-more">+' + (list.length - 2) + ' more</span>';
      if (list.length) {
        h += '<span class="cal-dots">';
        list.slice(0, 4).forEach(function (e) { h += '<i data-cat="' + e.category + '"></i>'; });
        h += '</span>';
      }
      h += '</button>';
    }
    grid.innerHTML = h;
  }

  // An event is "ongoing" when today (Manila) falls inside its date range.
  function evCard(e) {
    var live = e.startDate <= today && today <= e.endDate;
    return '<li class="ev-item" data-cat="' + e.category + '"><div class="ev-top"><i class="ev-cat" data-cat="' + e.category + '">' + CAT[e.category] + '</i>' +
      (live ? '<span class="ev-live">Ongoing</span>' : '') + '</div><b>' + esc(e.title) + '</b>' +
      '<small>' + range(e.startDate, e.endDate) + '</small>' + (e.note ? '<p>' + esc(e.note) + '</p>' : '') + '</li>';
  }

  function renderDay() {
    var box = $('calDay');
    if (!sel) { box.innerHTML = '<p class="empty">Select a day to see its details.</p>'; return; }
    var p = periodOf(sel), list = evOn(sel);
    box.innerHTML = '<h3 class="cal-h">' + longDate(sel) + '</h3>' +
      '<p class="dsub">' + (p.year ? esc(periodText(p)) : 'Outside every school year') + '</p>' +
      (list.length ? '<ul class="ev-list">' + list.map(evCard).join('') + '</ul>' : '<p class="empty">No events on this day.</p>');
  }

  function renderUpcoming() {
    var list = upcoming.slice(0, 8);
    $('calUp').innerHTML = '<h3 class="cal-h">Upcoming events</h3>' +
      (list.length ? '<ul class="ev-list">' + list.map(evCard).join('') + '</ul>' : '<p class="empty">No upcoming events yet.</p>');
  }

  function renderLegend() {
    $('calLegend').innerHTML =
      '<span><i class="sw p-term"></i>Term</span><span><i class="sw p-sem"></i>Semester</span><span><i class="sw p-year"></i>School year</span>' +
      Object.keys(CAT).map(function (k) { return '<span><i class="sw ev" data-cat="' + k + '"></i>' + CAT[k] + '</span>'; }).join('');
  }

  function renderAll() { showNow(); renderGrid(); renderDay(); renderUpcoming(); }

  // Fetches school years + the events shown on the grid + upcoming events, then redraws.
  function refresh() {
    var g = gridBounds(), mine = ++token;
    return Promise.all([
      call('/context'),
      call('/events?from=' + g.start + '&to=' + g.end),
      call('/events?from=' + today + '&to=' + addDays(today, 180)),
    ]).then(function (r) {
      if (mine !== token) return null;
      years = r[0].schoolYears || [];
      staff = r[0].userType === 'ADMIN' || r[0].userType === 'MODERATOR';
      events = r[1].events || [];
      upcoming = r[2].events || [];
      renderAll();
      return r[0];
    });
  }

  // Only the events change when you move between months.
  function loadMonth() {
    var g = gridBounds(), mine = ++token;
    return call('/events?from=' + g.start + '&to=' + g.end).then(function (r) {
      if (mine !== token) return;
      events = r.events || [];
      renderGrid(); renderDay();
    }).catch(function () { /* keep showing the previous month's events */ });
  }

  function goto(y, m, pick) {
    cursor.y = y; cursor.m = m;
    sel = pick || (today.slice(0, 7) === y + '-' + pad(m) ? today : y + '-' + pad(m) + '-01');
    renderGrid(); renderDay();
    return loadMonth();
  }
  function step(n) {
    var m = cursor.m + n, y = cursor.y;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    goto(y, m);
  }

  $('calPrev').addEventListener('click', function () { step(-1); });
  $('calNext').addEventListener('click', function () { step(1); });
  $('calToday').addEventListener('click', function () { goto(Number(today.slice(0, 4)), Number(today.slice(5, 7)), today); });
  grid.addEventListener('click', function (e) {
    var b = e.target.closest('.cal-cell'); if (!b) return;
    var d = b.dataset.d;
    if (d.slice(0, 7) !== cursor.y + '-' + pad(cursor.m)) return goto(Number(d.slice(0, 4)), Number(d.slice(5, 7)), d);
    sel = d; renderGrid(); renderDay();
  });

  // ---------- Calendar setter (admin / moderator only) ----------
  // The setter screens (school year > semester > term manager and the events manager) live in calendarsetter.js,
  // attendanceterms.js and calendarsetter.css. They are loaded only for staff; the server also refuses these
  // requests for everyone else.
  function loadSetter() {
    if (document.getElementById('setView') || document.getElementById('calSetterJs')) return;
    var s = document.createElement('script');
    s.id = 'calSetterJs';
    s.src = 'calendarsetter.js?v=3';
    document.body.appendChild(s);
  }

  renderLegend();
  refresh().then(function (ctx) {
    if (!ctx) return;
    console.info('[academic calendar] signed in as ' + ctx.userType + (staff ? ' - calendar setter enabled' : ' - view only (log in as an ADMIN or MODERATOR to get the setter)'));
    if (!staff) return;
    window.G9Cal = { staff: true, reload: refresh };
    try { loadSetter(); } catch (e) { console.error('[academic calendar] setter failed to start:', e); }
  }).catch(function (err) {
    grid.innerHTML = '<p class="empty">' + esc(err.message || 'Could not load the calendar.') + ' Try refreshing the page.</p>';
  });
})();