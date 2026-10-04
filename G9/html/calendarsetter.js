// Calendar setter: the Calendar | Calendar setter toggle, the school year / semester / term manager and the events manager.
// Loaded by academiccalendar.js ONLY when the signed-in user is an ADMIN or MODERATOR. The server also refuses these
// requests for anyone else (needStaff in attendanceroutes.js), so hiding this from students is not the only protection.
(function () {
  'use strict';
  var G = window.G9Cal;
  if (!G || !G.staff) return;
  var API = '/api/attendance';
  var main = document.querySelector('main'), calView = document.getElementById('calView');
  if (!main || !calView || document.getElementById('setView')) return;

  if (!document.querySelector('link[href^="calendarsetter.css"]')) {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'calendarsetter.css?v=3';
    document.head.appendChild(css);
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CAT = { EVENT: 'Event', ACTIVITY: 'Activity', HOLIDAY: 'Holiday', EXAM: 'Exam' };
  var events = [], editId = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(s) { var p = s.split('-'); return MON[p[1] - 1] + ' ' + Number(p[2]); }
  function fmt(s) { return short(s) + ', ' + s.slice(0, 4); }
  function range(a, b) {
    if (a === b) return fmt(a);
    return a.slice(0, 4) === b.slice(0, 4) ? short(a) + ' – ' + short(b) + ', ' + b.slice(0, 4) : fmt(a) + ' – ' + fmt(b);
  }
  function say(msg, err) {
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }
  function call(method, path, body) {
    return fetch(API + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.message || 'Something went wrong.'); return d; }); });
  }
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

  /* ---------- toggle: Calendar | Calendar setter ---------- */
  var bar = document.createElement('section');
  bar.className = 'att-card att-bar';
  bar.innerHTML = '<div class="seg" id="modeSeg" role="tablist" aria-label="Calendar mode">' +
    '<button type="button" role="tab" aria-selected="true" data-mode="calendar" class="on">Calendar</button>' +
    '<button type="button" role="tab" aria-selected="false" data-mode="setter">Calendar setter</button></div>';
  main.insertBefore(bar, calView);

  /* ---------- setter panel ---------- */
  var set = document.createElement('div');
  set.id = 'setView'; set.hidden = true;
  set.innerHTML =
    '<section class="att-card"><div class="cs-head"><div><h2>School years, semesters &amp; terms</h2>' +
    '<p>Set up the school calendar once. It applies to every course and section.</p></div></div>' +
    '<ol class="steps"><li><b>1</b><span>School year<small>e.g. 2026-2027</small></span></li>' +
    '<li><b>2</b><span>Semesters<small>e.g. 1st Semester</small></span></li>' +
    '<li><b>3</b><span>Terms<small>e.g. Midterm, Finals</small></span></li></ol>' +
    '<div id="hier"></div></section>' +
    '<section class="att-card" id="evBox"><div class="cs-head"><div><h2>Events</h2>' +
    '<p>School-wide events such as Teachers\' Day or Intramurals Week. They show on the calendar for everyone.</p></div>' +
    '<button type="button" class="btn-submit" id="evAdd">+ Add event</button></div>' +
    '<div id="evList"></div></section>';
  main.appendChild(set);

  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]'); if (!b) return;
    var setter = b.dataset.mode === 'setter';
    Array.prototype.forEach.call(bar.querySelectorAll('button'), function (x) {
      x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b));
    });
    calView.hidden = setter; set.hidden = !setter;
    if (setter) loadEvents(); else G.reload();   // calendar re-reads everything so it shows what was just set
  });

  /* ---------- events list ---------- */
  function row(e) {
    var p = e.startDate.split('-');
    return '<article class="ev" data-cat="' + e.category + '"><div class="ev-date"><b>' + Number(p[2]) + '</b><span>' + MON[p[1] - 1].toUpperCase() + '</span></div>' +
      '<div class="ev-body"><div class="ev-top"><i class="ev-cat">' + CAT[e.category] + '</i><b>' + esc(e.title) + '</b></div>' +
      '<small>' + range(e.startDate, e.endDate) + (e.note ? ' · ' + esc(e.note) : '') + '</small></div>' +
      '<div class="ev-act"><button type="button" class="cs-btn" data-act="edit" data-id="' + e.id + '" aria-label="Edit ' + esc(e.title) + '">Edit</button>' +
      '<button type="button" class="cs-btn danger" data-act="del" data-id="' + e.id + '" aria-label="Delete ' + esc(e.title) + '">Delete</button></div></article>';
  }
  function renderEvents() {
    var coming = events.filter(function (e) { return e.endDate >= today; });
    var past = events.filter(function (e) { return e.endDate < today; }).reverse();
    var h = coming.length ? '<div class="evs">' + coming.map(row).join('') + '</div>'
      : '<div class="cs-empty"><b>No upcoming events</b>Use “Add event” to create one, for example Teachers\' Day or Intramurals Week.</div>';
    if (past.length) h += '<details class="ev-past"><summary>Past events (' + past.length + ')</summary><div class="evs">' + past.map(row).join('') + '</div></details>';
    $('evList').innerHTML = h;
  }
  function loadEvents() {
    return call('GET', '/events').then(function (d) { events = d.events || []; renderEvents(); })
      .catch(function (err) { $('evList').innerHTML = '<p class="empty">' + esc(err.message) + '</p>'; });
  }

  /* ---------- add / edit dialog ---------- */
  var dlg = document.createElement('dialog');
  dlg.className = 'cs-dlg';
  dlg.innerHTML = '<h3 id="eTitleH"></h3><p class="dsub">For a single day, leave the end date the same as the start date.</p>' +
    '<label class="att-lbl">Event name<input id="eName" class="att-in" maxlength="100" placeholder="e.g. Teachers\' Day, Intramurals Week"></label>' +
    '<label class="att-lbl">Type<select id="eCat" class="att-in">' +
    Object.keys(CAT).map(function (k) { return '<option value="' + k + '">' + CAT[k] + '</option>'; }).join('') + '</select></label>' +
    '<div class="cs-two"><label class="att-lbl">Starts<input id="eStart" type="date" class="att-in"></label>' +
    '<label class="att-lbl">Ends<input id="eEnd" type="date" class="att-in"></label></div>' +
    '<label class="att-lbl">Note (optional)<input id="eNote" class="att-in" maxlength="255"></label>' +
    '<p class="form-error" id="eErr" role="alert"></p>' +
    '<div class="dact"><button type="button" class="cs-btn" id="eCancel">Cancel</button><button type="button" class="btn-submit" id="eSave">Save</button></div>';
  document.body.appendChild(dlg);

  function openForm(item) {
    editId = item ? item.id : 0;
    $('eTitleH').textContent = item ? 'Edit event' : 'Add event';
    $('eName').value = item ? item.title : '';
    $('eCat').value = item ? item.category : 'EVENT';
    $('eStart').value = item ? item.startDate : '';
    $('eEnd').value = item ? item.endDate : '';
    $('eNote').value = item && item.note ? item.note : '';
    $('eErr').style.display = 'none';
    dlg.showModal();
    $('eName').focus();
  }

  $('eStart').addEventListener('change', function () {
    var s = $('eStart').value;
    $('eEnd').min = s;
    if (s && (!$('eEnd').value || $('eEnd').value < s)) $('eEnd').value = s;
  });
  $('evAdd').addEventListener('click', function () { openForm(null); });
  $('eCancel').addEventListener('click', function () { dlg.close(); });
  $('eSave').addEventListener('click', function () {
    var start = $('eStart').value, body = {
      title: $('eName').value, category: $('eCat').value,
      startDate: start, endDate: $('eEnd').value || start, note: $('eNote').value,
    };
    $('eSave').disabled = true;
    call(editId ? 'PUT' : 'POST', '/events' + (editId ? '/' + editId : ''), body)
      .then(function () { dlg.close(); say('Saved.'); return loadEvents(); })
      .catch(function (err) { $('eErr').textContent = err.message; $('eErr').style.display = 'block'; })
      .then(function () { $('eSave').disabled = false; });
  });

  $('evList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var id = Number(b.dataset.id), item = events.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    if (b.dataset.act === 'edit') return openForm(item);
    if (!window.confirm('Delete the event "' + item.title + '"?')) return;
    call('DELETE', '/events/' + id).then(function () { say('Deleted.'); return loadEvents(); }).catch(function (err) { say(err.message, true); });
  });

  /* ---------- school year > semester > term manager (existing script, needs #hier above) ---------- */
  var s = document.createElement('script');
  s.src = 'attendanceterms.js?v=3';
  s.onerror = function () { problem('attendanceterms.js could not be loaded.'); };
  document.body.appendChild(s);
  function problem(why) {
    var h = $('hier'); if (!h) return;
    h.innerHTML = '<div class="cs-empty"><b>The school year editor did not start</b>' + why +
      ' Put <b>attendanceterms.js</b> in the same folder as academiccalendar.html, restart node server.js, then press Ctrl+Shift+R.</div>';
  }
  $('hier').innerHTML = '<p class="cs-hint">Loading school years…</p>';
  setTimeout(function () { if (!window.G9Terms) problem('It is taking too long or the file is missing.'); }, 6000);

  loadEvents();
})();