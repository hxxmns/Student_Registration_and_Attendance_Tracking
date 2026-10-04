// School year > semesters > terms manager for the "Semesters & terms" box on attendance.html (admin / moderator).
(function () {
  'use strict';
  var API = '/api/attendance', box = document.getElementById('hier');
  if (!box) return;
  window.G9Terms = true;   // lets calendarsetter.js know this file loaded

  var LABEL = { year: 'School year', semester: 'Semester', term: 'Term' };
  var PATH = { year: '/school-years', semester: '/semesters', term: '/terms' };
  var PARENT_KEY = { semester: 'schoolYearId', term: 'semesterId' };
  var HINT = { year: 'e.g. 2025-2026', semester: 'e.g. 1st Semester', term: 'e.g. Midterm' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var years = [], edit = null, staff = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(d) { var p = d.split('-'); return MON[p[1] - 1] + ' ' + Number(p[2]) + ', ' + p[0]; }
  function say(msg, err) {
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }
  function call(method, path, body) {
    return fetch(API + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) {
            console.error('[school years] ' + method + ' ' + API + path + ' -> ' + r.status, d);
            if (r.status === 401) { location.href = 'login.html'; throw new Error('You are signed out. Please sign in again.'); }
            if (r.status === 403) throw new Error(d.message || 'Only an admin or moderator can change the school calendar.');
            if (r.status === 404 && !d.message) throw new Error('The server does not have this route (' + API + path.split('?')[0] + '). Restart node server.js with the latest attendanceroutes.js.');
            throw new Error(d.message || 'The server returned an error (HTTP ' + r.status + '). Check the node server window for the reason.');
          }
          return d;
        });
      }, function () { throw new Error('Cannot reach the server. Make sure node server.js is running and you opened the site at http://localhost:3000.'); });
  }
  function load() {
    return call('GET', '/context').then(function (d) { staff = d.userType === 'ADMIN' || d.userType === 'MODERATOR'; years = d.schoolYears || []; render(); })
      .catch(function (err) {
        box.innerHTML = '<div class="cs-empty"><b>Could not load the school years</b>' + esc(err.message) + '<div style="margin-top:1rem"><button type="button" class="cs-btn" data-act="retry">Try again</button></div></div>';
      });
  }

  function running(it) { var d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); return it.startDate <= d && d <= it.endDate; }
  function head(lv, it) {
    return '<div class="hi hi-' + lv + '"><div class="hi-main"><i class="hi-tag">' + LABEL[lv] + '</i><b class="hi-name">' + esc(it.name) + '</b>' + (running(it) ? '<span class="now">Running now</span>' : '') + '</div>' +
      '<div class="hi-date">' + fmt(it.startDate) + '<span>&rarr;</span>' + fmt(it.endDate) + '</div>' +
      (staff ? '<div class="hi-act"><button type="button" class="cs-btn" data-act="edit" data-lv="' + lv + '" data-id="' + it.id + '" aria-label="Edit ' + esc(it.name) + '">Edit</button>' +
      '<button type="button" class="cs-btn danger" data-act="del" data-lv="' + lv + '" data-id="' + it.id + '" aria-label="Delete ' + esc(it.name) + '">Delete</button></div>' : '') + '</div>';
  }
  function render() {
    var h = staff ? '<div class="cs-bar"><button type="button" class="btn-submit" data-act="add" data-lv="year">+ Add school year</button></div>' : '';
    if (!years.length) h += '<div class="cs-empty"><b>' + (staff ? 'No school year yet' : 'Nothing has been set up yet') + '</b>' +
      (staff ? 'Start by adding a school year such as 2026-2027. Then add its semesters, and the terms inside each semester.' : 'A school year will show here once an admin or moderator sets it up.') + '</div>';
    years.forEach(function (y) {
      h += '<article class="hy">' + head('year', y) + '<div class="hs-wrap">';
      if (!y.semesters.length) h += '<p class="cs-hint">No semesters in this school year yet.</p>';
      y.semesters.forEach(function (s) {
        h += '<div class="hs">' + head('semester', s) + '<div class="ht-wrap">';
        s.terms.forEach(function (t) { h += '<div class="ht">' + head('term', t) + '</div>'; });
        if (!s.terms.length) h += '<p class="cs-hint">No terms in this semester yet.</p>';
        h += (staff ? '<button type="button" class="cs-add" data-act="add" data-lv="term" data-parent="' + s.id + '">Add a term to ' + esc(s.name) + '</button>' : '') + '</div></div>';
      });
      h += (staff ? '<button type="button" class="cs-add" data-act="add" data-lv="semester" data-parent="' + y.id + '">Add a semester to ' + esc(y.name) + '</button>' : '') + '</div></article>';
    });
    box.innerHTML = h;
    showNow();
  }
  // Which school year / semester / term is running today (Manila date).
  function showNow() {
    if (window.G9Cal) return;   // the calendar page already shows the running school year / semester / term
    var el = document.getElementById('now'); if (!el) return;
    var d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()), sy = null, se = null, tm = null;
    function In(x) { return x.startDate <= d && d <= x.endDate; }
    years.forEach(function (y) { if (!In(y)) return; sy = y; y.semesters.forEach(function (s) { if (!In(s)) return; se = s; s.terms.forEach(function (t) { if (In(t)) tm = t; }); }); });
    el.innerHTML = sy ? '<b>' + esc(sy.name) + '</b><span>' + (se ? esc(se.name) : 'No semester running') + (tm ? ' · ' + esc(tm.name) : '') + '</span>' : '<b>No school year running</b><span>Today is outside every school year</span>';
  }
  function find(lv, id) {
    var out = null;
    years.forEach(function (y) {
      if (lv === 'year' && y.id === id) out = y;
      y.semesters.forEach(function (s) {
        if (lv === 'semester' && s.id === id) out = s;
        s.terms.forEach(function (t) { if (lv === 'term' && t.id === id) out = t; });
      });
    });
    return out;
  }
  function parentOf(lv, parentId) {
    var out = null;
    years.forEach(function (y) {
      if (lv === 'semester' && y.id === parentId) out = y;
      y.semesters.forEach(function (s) { if (lv === 'term' && s.id === parentId) out = s; });
    });
    return out;
  }
  function parentOfExisting(lv, id) {
    var out = null;
    years.forEach(function (y) { y.semesters.forEach(function (s) {
      if (lv === 'semester' && s.id === id) out = y;
      s.terms.forEach(function (t) { if (lv === 'term' && t.id === id) out = s; });
    }); });
    return out;
  }

  var dlg = document.createElement('dialog');
  dlg.className = 'cs-dlg';
  dlg.innerHTML = '<h3 id="hTitle"></h3><p class="dsub" id="hSub"></p>' +
    '<label class="att-lbl">Name<input id="hName" class="att-in" maxlength="40"></label>' +
    '<div class="cs-two"><label class="att-lbl">Starts<input id="hStart" type="date" class="att-in"></label>' +
    '<label class="att-lbl">Ends<input id="hEnd" type="date" class="att-in"></label></div>' +
    '<p class="form-error" id="hErr" role="alert"></p>' +
    '<div class="dact"><button type="button" class="cs-btn" id="hCancel">Cancel</button><button type="button" class="btn-submit" id="hSave">Save</button></div>';
  document.body.appendChild(dlg);
  function $(id) { return document.getElementById(id); }

  function openForm(lv, item, parent) {
    edit = { lv: lv, id: item ? item.id : 0, parent: parent || null };
    $('hTitle').textContent = (item ? 'Edit ' : 'Add ') + LABEL[lv].toLowerCase();
    $('hSub').textContent = parent ? 'Inside ' + LABEL[lv === 'term' ? 'semester' : 'year'].toLowerCase() + ' "' + parent.name + '" (' + fmt(parent.startDate) + ' to ' + fmt(parent.endDate) + '). Pick dates within it.' : 'School years cannot overlap each other.';
    $('hName').placeholder = HINT[lv];
    $('hName').value = item ? item.name : '';
    $('hStart').value = item ? item.startDate : '';
    $('hEnd').value = item ? item.endDate : '';
    $('hErr').style.display = 'none';
    dlg.showModal();
    $('hName').focus();
  }

  box.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var lv = b.dataset.lv, id = Number(b.dataset.id) || 0, act = b.dataset.act;
    if (act === 'retry') { box.innerHTML = '<p class="cs-hint">Loading…</p>'; return load(); }
    if (act === 'add') return openForm(lv, null, lv === 'year' ? null : parentOf(lv, Number(b.dataset.parent)));
    var item = find(lv, id); if (!item) return;
    if (act === 'edit') return openForm(lv, item, lv === 'year' ? null : parentOfExisting(lv, id));
    var extra = lv === 'year' ? ' All its semesters and terms will be deleted too.' : lv === 'semester' ? ' All its terms will be deleted too.' : '';
    if (!window.confirm('Delete ' + LABEL[lv].toLowerCase() + ' "' + item.name + '"?' + extra)) return;
    call('DELETE', PATH[lv] + '/' + id).then(function () { say('Deleted.'); return load(); }).catch(function (err) { say(err.message, true); });
  });

  $('hCancel').addEventListener('click', function () { dlg.close(); });
  $('hSave').addEventListener('click', function () {
    var body = { name: $('hName').value, startDate: $('hStart').value, endDate: $('hEnd').value };
    if (!edit.id && edit.lv !== 'year') body[PARENT_KEY[edit.lv]] = edit.parent && edit.parent.id;
    $('hSave').disabled = true;
    call(edit.id ? 'PUT' : 'POST', PATH[edit.lv] + (edit.id ? '/' + edit.id : ''), body)
      .then(function () { dlg.close(); say('Saved.'); return load(); })
      .catch(function (err) { $('hErr').textContent = err.message; $('hErr').style.display = 'block'; })
      .then(function () { $('hSave').disabled = false; });
  });

  load();
})();