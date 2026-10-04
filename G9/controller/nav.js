(function () {
  'use strict';

  /* ---------- Sound (synthesised with Web Audio, no files needed) ---------- */
  var ctx = null, muted = false;
  try { muted = localStorage.getItem('g9-sound') === 'off'; } catch (e) {}

  function audio() {
    if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(o) {
    if (muted) return;
    var c = audio(); if (!c) return;
    var t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain(), node = osc;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(o.to || o.from, t + o.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.06, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    if (o.lp) {
      var f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 7;
      f.frequency.setValueAtTime(o.lp[0], t);
      f.frequency.exponentialRampToValueAtTime(o.lp[1], t + o.dur);
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }
  var sfx = {
    open: function () {
      tone({ type: 'sawtooth', from: 110, to: 700, dur: .38, vol: .07, lp: [250, 4200] });
      tone({ type: 'sine', from: 880, to: 1760, dur: .16, vol: .05, delay: .14 });
      tone({ type: 'triangle', from: 1320, to: 2640, dur: .12, vol: .04, delay: .28 });
    },
    close: function () {
      tone({ type: 'sawtooth', from: 700, to: 90, dur: .32, vol: .07, lp: [4200, 220] });
      tone({ type: 'sine', from: 1320, to: 550, dur: .16, vol: .05 });
    },
    hover: function () { tone({ type: 'square', from: 1800, to: 2600, dur: .04, vol: .015 }); },
    click: function () {
      tone({ type: 'square', from: 900, to: 1500, dur: .06, vol: .03 });
      tone({ type: 'square', from: 1500, to: 2200, dur: .06, vol: .03, delay: .06 });
    }
  };

  /* ---------- Load nav.html and wire it up ---------- */
  var FALLBACK = "<header class=\"g9-topbar\">\r\n    <button type=\"button\" class=\"g9-toggle\" aria-expanded=\"false\" aria-controls=\"g9Drawer\" aria-label=\"Open navigation\">\r\n        <i></i><i></i><i></i>Menu\r\n    </button>\r\n    <span class=\"g9-brand\">G9</span>\r\n    <span class=\"g9-crumb\"></span>\r\n    <span class=\"g9-status\">Online</span>\r\n    <button type=\"button\" class=\"g9-sound\" aria-pressed=\"true\" aria-label=\"Toggle menu sound effects\">Sound</button>\r\n</header>\r\n\r\n<div class=\"g9-scrim\"></div>\r\n\r\n<aside class=\"g9-drawer\" id=\"g9Drawer\" aria-label=\"Site navigation\">\r\n    <div class=\"g9-drawer-head\">\r\n        Navigation\r\n        <button type=\"button\" class=\"g9-close\" aria-label=\"Close navigation\">&times;</button>\r\n    </div>\r\n\r\n    <nav>\r\n        <a class=\"g9-link\" href=\"monitoring.html\" style=\"--i:0\">\r\n            <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 12h4l3-8 4 16 3-8h4\"/></svg>Monitoring\r\n        </a>\r\n        <a class=\"g9-link\" href=\"studentregistration.html\" style=\"--i:1\">\r\n            <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><circle cx=\"9\" cy=\"11\" r=\"2\"/><path d=\"M6 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3M15 10h3M15 14h3\"/></svg>Registration\r\n        </a>\r\n        <a class=\"g9-link\" href=\"attendance.html\" style=\"--i:2\">\r\n            <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4\"/></svg>Attendance\r\n        </a>\r\n        <a class=\"g9-link\" href=\"academiccalendar.html\" style=\"--i:3\">\r\n            <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M8 3v4M16 3v4M7 14h3M14 14h3M7 17h3\"/></svg>Academic calendar\r\n        </a>\r\n    </nav>\r\n\r\n    <div class=\"g9-foot\">Group 9 \u00b7 Registration System</div>\r\n</aside>";

  // Use nav.html; if it can't be fetched (wrong path, file://), fall back to the same markup built in.
  fetch('nav.html')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(function (t) { if (t.indexOf('g9-drawer') < 0) throw new Error('not nav.html'); return t; })
    .catch(function (e) { console.warn('nav.html not loaded, using built-in copy:', e); return FALLBACK; })
    .then(init);

  function init(html) {
    if (!document.querySelector('link[href*="nav.css"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'nav.css'; document.head.appendChild(l);
    }
    var wrap = document.createElement('div');
    wrap.id = 'g9nav';
    wrap.innerHTML = html;
    document.body.insertBefore(wrap, document.body.firstChild);

    var toggle = wrap.querySelector('.g9-toggle'),
        drawer = wrap.querySelector('.g9-drawer'),
        scrim = wrap.querySelector('.g9-scrim'),
        closeBtn = wrap.querySelector('.g9-close'),
        crumb = wrap.querySelector('.g9-crumb'),
        snd = wrap.querySelector('.g9-sound'),
        links = wrap.querySelectorAll('.g9-link');

    var here = location.pathname.split('/').pop() || 'monitoring.html';
    links.forEach(function (a) {
      if (a.getAttribute('href') === here) {
        a.setAttribute('aria-current', 'page');
        crumb.textContent = a.textContent.trim();
      }
      a.addEventListener('mouseenter', sfx.hover);
      a.addEventListener('click', sfx.click);
    });

    function syncSound() { snd.setAttribute('aria-pressed', String(!muted)); }
    syncSound();
    snd.addEventListener('click', function () {
      muted = !muted;
      try { localStorage.setItem('g9-sound', muted ? 'off' : 'on'); } catch (e) {}
      syncSound();
      sfx.click();
    });

    function setOpen(open, silent) {
      if (open === drawer.classList.contains('open')) return;
      drawer.classList.toggle('open', open);
      scrim.classList.toggle('show', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      drawer.inert = !open;
      document.body.style.overflow = open ? 'hidden' : '';
      if (!silent) (open ? sfx.open : sfx.close)();
      if (open) closeBtn.focus({ preventScroll: true });
      else if (drawer.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    }

    drawer.inert = true;
    toggle.addEventListener('click', function () { setOpen(!drawer.classList.contains('open')); });
    closeBtn.addEventListener('click', function () { setOpen(false); });
    scrim.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (!drawer.classList.contains('open')) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'Tab') {
        var f = drawer.querySelectorAll('button, a[href]'), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('pageshow', function () { setOpen(false, true); });
  }
})();