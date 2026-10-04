(function () {
    'use strict';
    window.__g9mon = 'loaded';
    var API = '/api/attendance', SHOW_MS = 5000, MIN_SCAN_MS = 350;
    var $ = function (id) { return document.getElementById(id); };
    var reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- clock: Philippine (Manila) time, 12-hour ---------- */
    var time = $('monTime'), date = $('monDate');
    function tick() {
        var d = new Date();
        time.textContent = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        date.textContent = d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    tick();
    setInterval(tick, 1000);

    /* ---------- student number box + 5-second student card (admin / moderator only) ---------- */
    var box = $('scanSection');
    if (!box) return;
    var sbox = $('scanBox'), input = $('scanInput'), msg = $('scanMsg'), card = $('scanCard'), rec = $('scRec'), recLabel = $('scRecLabel');
    var CHIP = { idle: 'Standby', scan: 'Scanning', found: 'Student found', ok: 'Recorded', err: 'Not found' };
    var cur = null, hideT = null, cdT = null, msgT = null, idleT = null, seq = 0, busy = false;

    /* sound: tiny synthesised blips; follows the same on/off setting as the menu's Sound button */
    var actx = null;
    function muted() { try { return localStorage.getItem('g9-sound') === 'off'; } catch (e) { return false; } }
    function tone(o) {
        try {
            if (muted()) return;
            var AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (!AC) return;
            if (!actx) actx = new AC();
            if (actx.state === 'suspended') actx.resume();
            var t = actx.currentTime + (o.delay || 0), osc = actx.createOscillator(), g = actx.createGain();
            osc.type = o.type || 'sine';
            osc.frequency.setValueAtTime(o.from, t);
            osc.frequency.exponentialRampToValueAtTime(o.to || o.from, t + o.dur);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(o.vol || 0.05, t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t); osc.stop(t + o.dur + 0.05);
        } catch (e) { /* sound is never essential */ }
    }
    var sfx = {
        scan: function () { tone({ type: 'sawtooth', from: 200, to: 1500, dur: .3, vol: .03 }); },
        found: function () { tone({ type: 'sine', from: 880, to: 1320, dur: .12, vol: .05 }); tone({ type: 'sine', from: 1320, to: 1760, dur: .14, vol: .05, delay: .1 }); },
        ok: function () { [660, 880, 1320].forEach(function (f, i) { tone({ type: 'triangle', from: f, to: f * 1.02, dur: .16, vol: .06, delay: i * .08 }); }); },
        err: function () { tone({ type: 'square', from: 220, to: 110, dur: .28, vol: .04 }); }
    };

    /* text "decode" effect: random glyphs that resolve left to right into the real text */
    var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*<>/';
    function decode(el, final, ms) {
        var token = (el._d = (el._d || 0) + 1);
        if (reduce || typeof requestAnimationFrame !== 'function') { el.textContent = final; return; }
        var t0 = Date.now();
        (function step() {
            if (el._d !== token) return;
            var p = Math.min(1, (Date.now() - t0) / ms), out = '';
            for (var i = 0; i < final.length; i++) {
                out += (final.charAt(i) === ' ' || i < p * final.length) ? final.charAt(i) : GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
            }
            el.textContent = p < 1 ? out : final;
            if (p < 1) requestAnimationFrame(step);
        })();
    }

    function call(method, path, body) {
        var ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 10000) : null;
        return fetch(API + path, { method: method, credentials: 'same-origin', signal: ctl ? ctl.signal : undefined, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) {
                clearTimeout(timer);
                return r.text().then(function (txt) {
                    var d = {};
                    try { d = txt ? JSON.parse(txt) : {}; } catch (e) { /* not JSON, e.g. an HTML 404 page */ }
                    if (r.status === 401) { location.href = 'login.html'; throw new Error('You are signed out. Sign in again.'); }
                    if (!r.ok) {
                        var m = d.message || (r.status === 404
                            ? 'Server route not found (HTTP 404): ' + API + path.split('?')[0] + '. Mount attendanceroutes in server.js and restart node.'
                            : 'Server error (HTTP ' + r.status + ').');
                        console.error('[monitoring] ' + method + ' ' + API + path + ' -> ' + r.status, txt.slice(0, 300));
                        throw new Error(m);
                    }
                    return d;
                });
            }, function () {
                clearTimeout(timer);
                console.error('[monitoring] could not reach ' + API + path);
                throw new Error('Cannot reach the server. Open the site at http://localhost:3000 while node server.js is running (not by double-clicking the file or Live Server).');
            });
    }
    function pause(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); }); }
    function state(s) {
        clearTimeout(idleT);
        sbox.setAttribute('data-state', s);
        $('scanChipText').textContent = CHIP[s];
    }
    function say(text, kind) {
        clearTimeout(msgT);
        msg.textContent = text;
        msg.className = 'mon-scan-msg' + (kind ? ' ' + kind : '');
        if (kind === 'err') msgT = setTimeout(function () { msg.textContent = ''; msg.className = 'mon-scan-msg'; }, 9000);
    }
    function hideCard() {
        clearTimeout(hideT); clearInterval(cdT);
        card.hidden = true;
        cur = null;
        state('idle');
        input.focus();
    }
    function initials(s) { return ((s.fname || '').charAt(0) + (s.lname || '').charAt(0)).toUpperCase(); }

    // particles flying out of the button when attendance is recorded
    function burst() {
        if (reduce) return;
        var b = $('scBurst'), n = 28;
        b.innerHTML = '';
        for (var i = 0; i < n; i++) {
            var p = document.createElement('i'), a = Math.PI * 2 * i / n + Math.random() * .4, dist = 90 + Math.random() * 160;
            p.style.setProperty('--dx', Math.cos(a) * dist + 'px');
            p.style.setProperty('--dy', Math.sin(a) * dist * .75 + 'px');
            p.style.animationDelay = (Math.random() * .12) + 's';
            b.appendChild(p);
        }
    }

    function show(d) {
        var s = d.student, already = !!(d.record && d.record.status === 'PRESENT');
        cur = d;
        decode($('scName'), s.fname + ' ' + s.lname, 560);
        decode($('scId'), s.studentID, 700);
        $('scCourse').textContent = s.course;
        $('scYs').textContent = s.yrAndSec;
        var ph = $('scPhoto');
        if (s.photo) { ph.style.backgroundImage = 'url("' + s.photo + '")'; ph.textContent = ''; ph.classList.add('has'); }
        else { ph.style.backgroundImage = ''; ph.textContent = initials(s); ph.classList.remove('has'); }

        var note = $('scNote');
        note.className = 'sc-note';
        rec.classList.remove('fire'); rec.classList.remove('done');
        if (already) { rec.disabled = true; recLabel.textContent = '\u2713 Recorded ' + d.record.time; rec.classList.add('done'); note.textContent = ''; }
        else if (!d.canRecord) { rec.disabled = true; recLabel.textContent = 'Cannot record'; note.textContent = d.reason; note.className = 'sc-note warn'; }
        else {
            rec.disabled = false; recLabel.textContent = 'Record attendance';
            note.textContent = d.startsDay ? 'Recording this starts today\u2019s class for ' + s.course + ' ' + s.yrAndSec + '.' : '';
        }
        card.setAttribute('data-s', already ? 'done' : d.canRecord ? 'ready' : 'warn');
        card.classList.remove('stamped');
        $('scBurst').innerHTML = '';

        // unfold the card (CSS), start the 5-second countdown ring + number, hide after exactly 5 seconds
        card.hidden = false;
        card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
        // the card opens under the scan box: bring it into view so it never appears off-screen on a small display
        try { card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); }
        var left = Math.round(SHOW_MS / 1000);
        $('scCount').textContent = left;
        clearInterval(cdT);
        cdT = setInterval(function () { left--; if (left > 0) $('scCount').textContent = left; else clearInterval(cdT); }, 1000);
        clearTimeout(hideT);
        hideT = setTimeout(hideCard, SHOW_MS);

        state(already ? 'ok' : 'found');
        sfx.found();
        say('');
        $('scanSr').textContent = 'Student found: ' + s.fname + ' ' + s.lname + ', ' + s.course + ' ' + s.yrAndSec + '.' + (d.canRecord ? ' Press Record attendance.' : ' ' + d.reason);
    }

    function lookup(code) {
        var mine = ++seq, t0 = Date.now();
        state('scan'); sfx.scan();
        say('Scanning ' + code + '\u2026');
        var wait = function () { return pause(MIN_SCAN_MS - (Date.now() - t0)); };   // let the scan animation read as a scan
        call('GET', '/lookup?studentID=' + encodeURIComponent(code))
            .then(function (d) { return wait().then(function () { return d; }); }, function (e) { return wait().then(function () { throw e; }); })
            .then(function (d) { if (mine === seq) show(d); })
            .catch(function (e) {
                if (mine !== seq) return;
                hideCard(); state('err'); sfx.err();
                say(e.message, 'err');
                idleT = setTimeout(function () { state('idle'); }, 4000);
            });
    }

    /* ---------- statistics for ONE section: the section that recorded attendance last today ---------- */
    var dayEl = $('dayPanel');
    var dayKey = null, dayRec = 0, daySeq = 0, dayTimer = null;

    sfx.classOn = function () {
        [523, 659, 784, 1047].forEach(function (f, i) { tone({ type: 'triangle', from: f, to: f * 1.01, dur: .2, vol: .06, delay: .3 + i * .09 }); });
        tone({ type: 'sine', from: 130, to: 520, dur: .55, vol: .05, delay: .3 });
    };
    sfx.tick = function () { tone({ type: 'square', from: 1400, to: 1900, dur: .05, vol: .025 }); };

    function countTo(el, to) {
        var from = el._v == null ? 0 : el._v, token = (el._c = (el._c || 0) + 1);
        el._v = to;
        if (reduce || from === to || typeof requestAnimationFrame !== 'function') { el.textContent = to; return; }
        var t0 = Date.now();
        (function step() {
            if (el._c !== token) return;
            var p = Math.min(1, (Date.now() - t0) / 700), e = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(from + (to - from) * e);
            if (p < 1) requestAnimationFrame(step);
        })();
    }
    function longDate(s) {
        try { return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
        catch (e) { return s; }
    }

    function renderDay(d, mode) {
        var l = d.last, key = l ? l.course + '|' + l.yrAndSec : '';
        var rec = l ? l.recorded : 0, tot = l ? l.students : 0;
        var started = mode !== 'init' && dayKey !== null && dayKey === '' && !!l;
        var grew = mode !== 'init' && dayKey === key && !!l && rec > dayRec;

        dayEl.setAttribute('data-state', l ? 'on' : 'off');
        $('dpDate').textContent = longDate(d.date);
        $('dpLive').textContent = 'Live';

        var title = $('dpTitle'), want = l ? 'HAS CLASS' : 'NO CLASS';
        if (title.getAttribute('data-k') !== want) { title.setAttribute('data-k', want); decode(title, want, started ? 800 : 520); }
        $('dpSub').textContent = l
            ? l.course + ' \u00b7 ' + l.yrAndSec + ' \u00b7 the last section to record attendance today.'
            : 'No attendance has been recorded yet today. The first student you record starts class for their section.';

        $('dpFill').style.width = (tot ? Math.round(rec / tot * 100) : 0) + '%';
        countTo($('dpRec'), rec);
        $('dpTot').textContent = tot;

        var ul = $('dpSecs');
        ul.textContent = '';
        if (l) {
            var li = document.createElement('li'), b = document.createElement('b'), sp = document.createElement('span'), em = document.createElement('em'), u = document.createElement('u');
            li.className = 'dp-sec'; li.style.setProperty('--i', 0);
            b.textContent = l.yrAndSec; sp.textContent = l.course; em.textContent = rec + '/' + tot;
            u.style.width = (tot ? Math.round(rec / tot * 100) : 0) + '%';
            li.appendChild(b); li.appendChild(sp); li.appendChild(em); li.appendChild(u);
            ul.appendChild(li);
        }

        if (started) { dayEl.classList.remove('boom'); void dayEl.offsetWidth; dayEl.classList.add('boom'); sfx.classOn(); }
        else if (grew || (mode !== 'init' && dayKey !== null && key !== dayKey && l)) sfx.tick();
        dayKey = key;
        dayRec = rec;
    }

    // mode: 'init' (first load), 'self' (right after you recorded someone), 'poll' (background refresh)
    function refreshDay(mode) {
        if (!dayEl) return;
        var mine = ++daySeq;
        call('GET', '/today-status').then(function (d) { if (mine === daySeq) renderDay(d, mode); })
            .catch(function (e) {
                if (mine !== daySeq) return;
                $('dpLive').textContent = 'Offline';
                if (dayEl.getAttribute('data-state') === 'loading') { decode($('dpTitle'), 'UNAVAILABLE', 400); $('dpSub').textContent = e.message; }
            });
    }
    function startDay() {
        if (!dayEl || dayTimer) return;
        refreshDay('init');
        dayTimer = setInterval(function () { if (!document.hidden) refreshDay('poll'); }, 15000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshDay('poll'); });
    }

    var lastSub = 0;
    function submitScan() {
        var now = Date.now();
        if (now - lastSub < 250) return;            // keydown + keypress both fire for one Enter
        lastSub = now;
        var code = input.value.trim().toUpperCase();
        input.value = '';
        if (!code) { say('Type or scan a student number first.', 'err'); return; }
        lookup(code);
    }
    function onEnter(e) { if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.keyCode === 13) { e.preventDefault(); submitScan(); } }
    input.addEventListener('keydown', onEnter);
    input.addEventListener('keypress', onEnter);
    window.__g9mon = 'ready';

    rec.addEventListener('click', function () {
        if (!cur || busy) return;
        var mine = cur, s = mine.student;
        busy = true; rec.disabled = true; recLabel.textContent = 'Recording\u2026';
        rec.classList.remove('fire'); void rec.offsetWidth; rec.classList.add('fire');
        call('POST', '/checkin', { studentID: s.studentID })
            .then(function (r) {
                sfx.ok();
                refreshDay('self');
                say(s.fname + ' ' + s.lname + ' recorded at ' + r.time + (r.startedDay ? ' \u00b7 class day started for ' + s.course + ' ' + s.yrAndSec : ''), 'ok');
                $('scanSr').textContent = s.fname + ' ' + s.lname + ' recorded at ' + r.time + '.';
                if (cur !== mine) return;
                state('ok');
                card.setAttribute('data-s', 'done');
                rec.classList.add('done');
                recLabel.textContent = '\u2713 Recorded ' + r.time;
                $('scNote').textContent = r.startedDay ? 'Class day started for ' + s.course + ' ' + s.yrAndSec + '.' : '';
                $('scNote').className = 'sc-note';
                card.classList.add('stamped');
                burst();
            })
            .catch(function (e) {
                sfx.err();
                say(e.message, 'err');
                if (cur !== mine) return;
                state('err');
                card.setAttribute('data-s', 'warn');
                recLabel.textContent = 'Cannot record'; $('scNote').textContent = e.message; $('scNote').className = 'sc-note warn';
            })
            .then(function () { busy = false; input.focus(); });
    });

    // the cursor always stays in the student number box (except while the menu, a dropdown or a dialog is in use)
    function keepFocus() {
        if (box.hidden || document.hidden) return;
        var a = document.activeElement;
        if (a === input) return;
        if (a && a.closest && a.closest('.g9-drawer, select, textarea, dialog')) return;
        var dr = $('g9Drawer');
        if (dr && dr.classList.contains('open')) return;
        input.focus({ preventScroll: true });
    }
    var later = function () { setTimeout(keepFocus, 0); };
    input.addEventListener('blur', later);
    document.addEventListener('click', later);
    document.addEventListener('keydown', function (e) {
        if (e.target === input || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
        keepFocus();                                  // typing anywhere on the page goes into the box
    }, true);
    window.addEventListener('focus', keepFocus);
    window.addEventListener('pageshow', keepFocus);
    document.addEventListener('visibilitychange', keepFocus);
    setInterval(keepFocus, 700);

    // Shown by default. Only a STUDENT account hides it (the server also refuses lookups/recording for students).
    input.focus();
    call('GET', '/context').then(function (d) {
        var student = d.userType === 'STUDENT';
        console.info('[monitoring] signed in as ' + d.userType + (student ? ' - scanner hidden' : ' - scanner on'));
        if (student) { box.hidden = true; return; }
        box.hidden = false;
        input.focus();
        startDay();
    }).catch(function (e) {
        // could not read the account type: keep the scanner visible; the server still blocks non-staff requests
        console.warn('[monitoring] could not read the account type, scanner left on:', e.message);
        startDay();
    });
})();