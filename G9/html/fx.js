(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-bg';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  const COLORS = ['34,230,255', '123,92,255', '255,61,203'];
  const LINK_DIST = 140;
  const MOUSE_DIST = 190;
  const mouse = { x: -9999, y: -9999 };
  let w = 0, h = 0, nodes = [], rings = [], lastRing = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.min(120, Math.floor((w * h) / 13000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.6 + 0.7,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }

  function frame(t) {
    ctx.clearRect(0, 0, w, h);

    for (const n of nodes) {
      const dx = n.x - mouse.x;
      const dy = n.y - mouse.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < 150) {
        const f = (1 - d / 150) * 0.9;
        n.x += (dx / d) * f;
        n.y += (dy / d) * f;
      }
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -10) n.x = w + 10; else if (n.x > w + 10) n.x = -10;
      if (n.y < -10) n.y = h + 10; else if (n.y > h + 10) n.y = -10;
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK_DIST) {
          ctx.strokeStyle = 'rgba(34,230,255,' + ((1 - d / LINK_DIST) * 0.32).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const n = nodes[i];
      const md = Math.hypot(n.x - mouse.x, n.y - mouse.y);
      if (md < MOUSE_DIST) {
        ctx.strokeStyle = 'rgba(255,61,203,' + ((1 - md / MOUSE_DIST) * 0.5).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }

    for (const n of nodes) {
      ctx.fillStyle = 'rgba(' + n.c + ',0.9)';
      ctx.shadowColor = 'rgba(' + n.c + ',0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (!reduceMotion && t - lastRing > 1800 && nodes.length) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      rings.push({ x: n.x, y: n.y, r: 2, c: n.c });
      lastRing = t;
    }
    rings = rings.filter((r) => r.r < 110);
    for (const r of rings) {
      r.r += 0.9;
      ctx.strokeStyle = 'rgba(' + r.c + ',' + (0.5 * (1 - r.r / 110)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!reduceMotion) requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
  resize();
  requestAnimationFrame(frame);

  let enabled = true;
  try { enabled = localStorage.getItem('g9-sound') !== 'off'; } catch (e) {}
  let unlocked = false;
  let audio = null;
  let out = null;
  let lastPlay = 0;

  function getAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
      const comp = audio.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 6;
      comp.ratio.value = 12;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      const master = audio.createGain();
      master.gain.value = 1.6;
      master.connect(comp);
      comp.connect(audio.destination);
      out = master;
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function tone(f0, f1, dur, type, vol, delay) {
    const a = getAudio();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  const SOUNDS = {
    click() {
      tone(1500, 650, 0.09, 'square', 0.5);
      tone(520, 980, 0.08, 'sine', 0.6, 0.03);
    },
    success() {
      tone(660, 660, 0.12, 'square', 0.4);
      tone(880, 880, 0.12, 'square', 0.4, 0.11);
      tone(1320, 1320, 0.24, 'square', 0.45, 0.22);
    },
    error() {
      tone(230, 140, 0.28, 'sawtooth', 0.6);
      tone(210, 120, 0.3, 'sawtooth', 0.6, 0.15);
    },
  };

  function play(name) {
    if (!enabled || !unlocked) return;
    const now = performance.now();
    if (now - lastPlay < 40) return;
    lastPlay = now;
    (SOUNDS[name] || SOUNDS.click)();
  }

  document.addEventListener('pointerdown', (e) => {
    unlocked = true;
    const el = e.target.closest && e.target.closest('button, a[href], input[type="checkbox"], select, .btn-submit');
    if (!el || el.disabled || el.classList.contains('fx-toggle') || el.classList.contains('pw-toggle')) return;
    play('click');
  }, true);

  document.addEventListener('keydown', () => { unlocked = true; }, true);

  new MutationObserver((muts) => {
    for (const m of muts) {
      const el = m.target;
      if (!(el instanceof HTMLElement)) continue;
      const d = el.style.display;
      if (!d || d === 'none') continue;
      if (el.matches('.form-error, .field-error')) return play('error');
      if (el.matches('.form-success')) return play('success');
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fx-toggle';
  function label() {
    toggle.textContent = 'SOUND: ' + (enabled ? 'ON' : 'OFF');
    toggle.setAttribute('aria-pressed', String(enabled));
  }
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem('g9-sound', enabled ? 'on' : 'off'); } catch (e) {}
    label();
    if (enabled) { unlocked = true; SOUNDS.click(); }
  });
  label();
  document.body.appendChild(toggle);

  window.G9FX = { play, tone, SOUNDS };
})();

(function () {
  'use strict';
  if (window.__g9ui) return;
  window.__g9ui = true;
  const FX = window.G9FX = window.G9FX || {};
  const noop = function () {};
  const play = FX.play || noop;
  const tone = FX.tone || noop;
  const SOUNDS = FX.SOUNDS || {};

  const css = `
.pw-wrap{position:relative}
.pw-wrap input{padding-right:2.9rem!important}
.pw-toggle{position:absolute;right:.4rem;top:50%;transform:translateY(-50%);width:2.2rem;height:2.2rem;display:grid;place-items:center;padding:0;background:none;border:0;border-radius:6px;color:var(--muted);cursor:pointer;transition:color .15s,text-shadow .15s,transform .15s}
.pw-toggle:hover{color:var(--cyan);text-shadow:0 0 10px var(--cyan)}
.pw-toggle:active{transform:translateY(-50%) scale(.85)}
.pw-toggle.is-on{color:var(--cyan)}
.pw-toggle svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pw-toggle .eye-off{display:none}
.pw-toggle.is-on .eye-off{display:block}
.pw-toggle.is-on .eye-open{display:none}

.g9-toasts{position:fixed!important;top:18px;left:50%;transform:translateX(-50%);z-index:20!important;display:flex;flex-direction:column;gap:.6rem;width:min(92vw,400px);pointer-events:none}
.g9-toast{--tc:var(--cyan);pointer-events:auto;position:relative;overflow:hidden;display:flex;align-items:flex-start;gap:.75rem;padding:.85rem 1rem;border:1px solid var(--tc);border-radius:8px;background:var(--glass-strong);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 0 24px color-mix(in srgb,var(--tc) 30%,transparent),0 12px 30px rgba(0,0,0,.5);animation:toastIn .4s cubic-bezier(.2,.9,.3,1.25) both}
.g9-toast.success{--tc:var(--ok)}
.g9-toast.error{--tc:var(--error)}
.g9-toast.out{animation:toastOut .25s ease forwards}
.g9-toast .ico{flex:none;width:22px;height:22px;margin-top:1px;color:var(--tc);filter:drop-shadow(0 0 6px var(--tc))}
.g9-toast .ico svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.g9-toast .msg{flex:1;font-weight:600;font-size:1rem;line-height:1.35}
.g9-toast .x{flex:none;background:none;border:0;color:var(--muted);font-size:1.3rem;line-height:1;cursor:pointer;padding:0 .2rem}
.g9-toast .x:hover{color:var(--ink)}
.g9-toast .bar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:var(--tc);box-shadow:0 0 8px var(--tc);transform-origin:left;animation:toastBar linear forwards}
.g9-toast.success .ico svg{stroke-dasharray:30;animation:draw .6s .15s ease both}
@keyframes toastIn{from{opacity:0;transform:translateY(-24px) scale(.94)}to{opacity:1;transform:none}}
@keyframes toastOut{to{opacity:0;transform:translateY(-16px) scale(.96)}}
@keyframes toastBar{to{transform:scaleX(0)}}
@keyframes draw{from{stroke-dashoffset:30}to{stroke-dashoffset:0}}

.auth-form-wrap{animation:rise .6s cubic-bezier(.2,.8,.2,1) backwards}
.auth-form-wrap form>*{animation:rise .5s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*55ms + 150ms)}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.field{transition:transform .2s}
.field:focus-within{transform:translateX(4px)}
.field label{transition:color .2s,text-shadow .2s}
.field:focus-within label{color:var(--cyan);text-shadow:0 0 10px rgba(34,230,255,.6)}
.shake{animation:shake .45s cubic-bezier(.36,.07,.19,.97)!important}
@keyframes shake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
.form-error,.form-success,.field-error{animation:pop .3s cubic-bezier(.2,.9,.3,1.3)}
@keyframes pop{from{opacity:0;transform:scale(.95) translateY(-4px)}to{opacity:1;transform:none}}

.btn-submit .ripple{position:absolute;border-radius:50%;background:rgba(255,255,255,.55);transform:scale(0);animation:ripple .65s ease-out forwards;pointer-events:none}
@keyframes ripple{to{transform:scale(1);opacity:0}}
.btn-submit.is-loading::before{content:"";display:inline-block;width:.9em;height:.9em;margin-right:.6rem;vertical-align:-.12em;border:2px solid rgba(3,6,12,.3);border-top-color:#03060C;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.check-row input[type=checkbox]{transition:transform .15s}
.check-row input[type=checkbox]:active{transform:scale(1.3)}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  SOUNDS.focus = () => tone(880, 1250, 0.07, 'sine', 0.45);
  SOUNDS.key = () => tone(1700 + Math.random() * 400, 1100, 0.035, 'square', 0.16);
  SOUNDS.hover = () => tone(1200, 1500, 0.04, 'sine', 0.14);
  SOUNDS.on = () => { tone(600, 1000, 0.09, 'triangle', 0.6); tone(1000, 1400, 0.08, 'sine', 0.4, 0.06); };
  SOUNDS.off = () => tone(1000, 450, 0.12, 'triangle', 0.6);
  SOUNDS.submit = () => tone(420, 980, 0.14, 'sawtooth', 0.3);
  SOUNDS.info = () => tone(720, 1040, 0.11, 'sine', 0.5);

  const EYE = '<svg class="eye-open" viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg class="eye-off" viewBox="0 0 24 24"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A10.7 10.7 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/></svg>';

  document.querySelectorAll('input[type="password"]').forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pw-toggle';
    b.setAttribute('aria-label', 'Show password');
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = EYE + EYE_OFF;
    b.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.classList.toggle('is-on', show);
      b.setAttribute('aria-pressed', String(show));
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      play(show ? 'on' : 'off');
    });
    wrap.appendChild(b);
  });

  document.querySelectorAll('.auth-form-wrap form > *').forEach((el, i) => el.style.setProperty('--i', i));

  const ICONS = {
    success: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>',
    error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 8h.01"/></svg>',
  };

  function toast(message, type, ms) {
    type = ICONS[type] ? type : 'info';
    ms = ms || 4000;
    let box = document.querySelector('.g9-toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'g9-toasts';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'g9-toast ' + type;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.innerHTML = '<span class="ico">' + ICONS[type] + '</span><div class="msg"></div>' +
      '<button type="button" class="x" aria-label="Dismiss">&times;</button><span class="bar"></span>';
    t.querySelector('.msg').textContent = message;
    t.querySelector('.bar').style.animationDuration = ms + 'ms';
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      t.classList.add('out');
      setTimeout(() => t.remove(), 260);
    };
    t.querySelector('.x').addEventListener('click', close);
    box.appendChild(t);
    setTimeout(close, ms);
    play(type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
    return close;
  }

  function busy(btn, on, label) {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || 'Please wait…';
      btn.classList.add('is-loading');
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }

  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type="checkbox"]), select, textarea')) play('focus');
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('input:not([type="checkbox"]), textarea')) play('key');
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('select, input[type="checkbox"]')) play('on');
  });
  document.addEventListener('submit', () => play('submit'), true);

  let lastHover = null;
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('button:not(:disabled), a[href]');
    if (el && el !== lastHover) play('hover');
    lastHover = el || null;
  });

  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn-submit');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (e.clientX - r.left - size / 2) + 'px;top:' + (e.clientY - r.top - size / 2) + 'px';
    b.appendChild(s);
    setTimeout(() => s.remove(), 700);
  });

  new MutationObserver((muts) => {
    for (const m of muts) {
      const el = m.target;
      if (!(el instanceof HTMLElement) || !el.matches('.form-error, .field-error')) continue;
      if (!el.style.display || el.style.display === 'none') continue;
      const target = (el.closest('.field') && el.closest('.field').querySelector('input, select')) || el;
      target.classList.remove('shake');
      void target.offsetWidth;
      target.classList.add('shake');
      target.addEventListener('animationend', () => target.classList.remove('shake'), { once: true });
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });

  FX.toast = toast;
  FX.busy = busy;
})();