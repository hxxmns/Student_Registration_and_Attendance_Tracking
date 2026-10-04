(function () {
function enhanceSelect(sel) {
    const wrap = document.createElement('div');
    wrap.className = 'dd';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    const label = document.querySelector('label[for="' + sel.id + '"]');
    if (label && !label.id) label.id = sel.id + 'Label';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (label) btn.setAttribute('aria-labelledby', label.id);
    btn.innerHTML = '<span class="dd-text"></span><svg class="dd-chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="#22E6FF" stroke-width="2"/></svg>';
    const text = btn.querySelector('.dd-text');

    const list = document.createElement('ul');
    list.className = 'dd-list';
    list.id = sel.id + 'List';
    list.setAttribute('role', 'listbox');
    btn.setAttribute('aria-controls', list.id);

    const opts = [...sel.options].filter(o => o.value !== '');
    let active = -1;

    const items = opts.map((o, i) => {
        const li = document.createElement('li');
        li.className = 'dd-opt';
        li.id = sel.id + 'Opt' + i;
        li.setAttribute('role', 'option');
        li.textContent = o.textContent;
        li.addEventListener('mousedown', e => e.preventDefault());
        li.addEventListener('mousemove', () => { if (active !== i) setActive(i); });
        li.addEventListener('click', () => choose(i));
        list.appendChild(li);
        return li;
    });
    wrap.appendChild(btn);
    wrap.appendChild(list);

    function sync() {
        const idx = opts.findIndex(o => o.value === sel.value);
        if (idx >= 0) {
            text.textContent = opts[idx].textContent;
            text.classList.remove('ph');
            btn.title = opts[idx].textContent;
        } else {
            text.textContent = sel.options[0] ? sel.options[0].textContent : '';
            text.classList.add('ph');
            btn.removeAttribute('title');
        }
        items.forEach((li, i) => li.setAttribute('aria-selected', String(i === idx)));
        wrap.classList.toggle('is-disabled', sel.disabled);
        btn.disabled = sel.disabled;
    }

    function setActive(i) {
        active = i;
        items.forEach((li, k) => li.classList.toggle('active', k === i));
        if (i < 0) { btn.removeAttribute('aria-activedescendant'); return; }
        btn.setAttribute('aria-activedescendant', items[i].id);
        const el = items[i];
        if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 4;
        else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
            list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 4;
    }

    const isOpen = () => wrap.classList.contains('open');
    function open() {
        if (sel.disabled || isOpen()) return;
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        const cur = opts.findIndex(o => o.value === sel.value);
        setActive(cur >= 0 ? cur : 0);
    }
    function close() {
        if (!isOpen()) return;
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        setActive(-1);
    }
    function choose(i) {
        const changed = sel.value !== opts[i].value;
        sel.value = opts[i].value;
        sync();
        close();
        btn.focus({ preventScroll: true });
        if (changed) {
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    btn.addEventListener('click', () => (isOpen() ? close() : open()));
    btn.addEventListener('keydown', (e) => {
        const k = e.key;
        if (k === 'ArrowDown' || k === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen()) return open();
            setActive(Math.max(0, Math.min(items.length - 1, active + (k === 'ArrowDown' ? 1 : -1))));
        } else if (k === 'Home' && isOpen()) { e.preventDefault(); setActive(0); }
        else if (k === 'End' && isOpen()) { e.preventDefault(); setActive(items.length - 1); }
        else if (k === 'Enter' || k === ' ') {
            e.preventDefault();
            if (!isOpen()) open(); else if (active >= 0) choose(active); else close();
        } else if (k === 'Escape' && isOpen()) { e.preventDefault(); close(); }
        else if (k === 'Tab') close();
        else if (k.length === 1 && /\S/.test(k)) {
            const from = isOpen() ? active + 1 : 0;
            const order = items.map((_, i) => (from + i) % items.length);
            const hit = order.find(i => opts[i].textContent.toLowerCase().startsWith(k.toLowerCase()));
            if (hit !== undefined) { if (!isOpen()) open(); setActive(hit); }
        }
    });
    document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) close(); });
    if (label) label.addEventListener('click', () => btn.focus());
    if (sel.form) sel.form.addEventListener('reset', () => setTimeout(sync, 0));
    new MutationObserver(sync).observe(sel, { attributes: true, attributeFilter: ['disabled'] });
    sync();
}
document.querySelectorAll('.field select').forEach(enhanceSelect);

const $ = (id) => document.getElementById(id);
const form = $('regForm');
const formError = $('formError');
const btn = form.querySelector('.btn-submit');
const card = $('idCard');
const fields = ['studentID', 'fname', 'lname', 'email', 'course', 'yrAndSec', 'profile'];
let photoData = '';

function clearErrors() {
    formError.style.display = 'none';
    $('notice').classList.remove('show');
    fields.forEach(f => { $(f + 'Error').style.display = 'none'; });
}

function showError(field, message) {
    const span = field && $(field + 'Error');
    if (span) {
        span.style.display = 'none';
        span.textContent = message;
        span.style.display = 'block';
    } else {
        formError.style.display = 'none';
        formError.textContent = message;
        formError.style.display = 'block';
    }
}

function setText(id, text, isEmpty) {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle('empty', isEmpty);
}

const ID_PH = '2024-00999-SR-0', FN_PH = 'Juan Ponce', LN_PH = 'Enrile', COURSE_PH = 'Your full course name';

function typedId() { return $('studentID').value.trim().toUpperCase(); }
function mergedId(t) { return t + ID_PH.slice(t.length); }

function setParts(id, parts) {
    const el = $(id);
    el.classList.remove('empty');
    el.textContent = '';
    parts.forEach(p => {
        if (!p[0]) return;
        const s = document.createElement('span');
        s.textContent = p[0];
        if (p[1]) s.className = 'empty';
        el.appendChild(s);
    });
}

function preview() {
    const f = $('fname').value.trim(), l = $('lname').value.trim();
    setParts('pvName', [[f || FN_PH, !f], [' ', false], [l || LN_PH, !l]]);
    const t = typedId();
    setParts('pvId', [[t, false], [ID_PH.slice(t.length), true]]);
    const course = $('course').value.trim();
    setText('pvCourse', course || COURSE_PH, !course);
    const year = $('year').value;
    const sec = $('section').value.trim().toUpperCase();
    setText('pvYs', year && sec ? year + '-' + sec : '—', !(year && sec));
}

['studentID', 'fname', 'lname', 'course', 'section'].forEach(id => $(id).addEventListener('input', preview));
$('year').addEventListener('change', preview);
$('course').addEventListener('change', preview);
['input','change','keyup'].forEach(ev => form.addEventListener(ev, preview));
$('studentID').addEventListener('input', function () { this.value = this.value.toUpperCase(); preview(); });

function setPhoto(dataUrl) {
    photoData = dataUrl;
    const has = !!dataUrl;
    $('thumb').style.backgroundImage = has ? 'url(' + dataUrl + ')' : '';
    $('thumb').classList.toggle('has', has);
    $('pvPhoto').style.backgroundImage = has ? 'url(' + dataUrl + ')' : '';
    $('pvPhoto').classList.toggle('has', has);
    $('dropTitle').textContent = has ? 'Photo added. Click to change it' : 'Choose a photo';
    $('removePhoto').hidden = !has;
}

function loadPhoto(file) {
    $('profileError').style.display = 'none';
    if (!file) return;
    if (!file.type.startsWith('image/')) return showError('profile', 'Choose an image file.');
    if (file.size > 10 * 1024 * 1024) return showError('profile', 'Photo must be under 10 MB.');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const S = 400;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        const m = Math.min(img.width, img.height);
        ctx.fillStyle = '#05080f';
        ctx.fillRect(0, 0, S, S);
        ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
        URL.revokeObjectURL(url);
        setPhoto(c.toDataURL('image/jpeg', 0.85));
        G9FX.toast('Photo added to your ID card.', 'success', 2200);
    };
    img.onerror = () => { URL.revokeObjectURL(url); showError('profile', 'That image could not be read.'); };
    img.src = url;
}

const drop = $('drop');
drop.addEventListener('click', () => $('photo').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('photo').click(); } });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); loadPhoto(e.dataTransfer.files[0]); });
$('photo').addEventListener('change', (e) => { loadPhoto(e.target.files[0]); e.target.value = ''; });
$('removePhoto').addEventListener('click', () => setPhoto(''));

const panel = document.querySelector('.auth-form-panel');
panel.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = 'perspective(900px) rotateY(' + (x * 10) + 'deg) rotateX(' + (-y * 10) + 'deg)';
    card.style.setProperty('--mx', ((x + 0.5) * 100) + '%');
});
panel.addEventListener('pointerleave', () => { card.style.transform = ''; });

function courseProblem(c) {
    if (!c) return 'Choose your course.';
    if (![...$('course').options].some(o => o.value && o.value === c)) return 'Choose a course from the list.';
    return '';
}

function lockForm(message) {
    const n = $('notice');
    n.textContent = message;
    n.classList.add('show');
    form.querySelectorAll('input, select, button.btn-submit').forEach(el => { el.disabled = true; });
    $('drop').style.pointerEvents = 'none';
    G9FX.toast(message, 'info', 5000);
}

form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrors();

    const typed = typedId();
    const studentID = mergedId(typed);
    const fname = $('fname').value.trim();
    const lname = $('lname').value.trim();
    const course = $('course').value.trim().replace(/\s+/g, ' ');
    const year = $('year').value;
    const section = $('section').value.trim().toUpperCase();
    let bad = false;

    if (!typed) { showError('studentID', 'Enter your student number.'); bad = true; }
    else if (!/^[A-Z0-9-]{5,15}$/.test(studentID)) { showError('studentID', 'Enter 5–15 letters, numbers or dashes, like 2024-00999-SR-0.'); bad = true; }
    if (!fname) { showError('fname', 'Enter your first name.'); bad = true; }
    if (!lname) { showError('lname', 'Enter your last name.'); bad = true; }
    const email = $('email').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 100) { showError('email', 'Enter a valid email address.'); bad = true; }
    const cp = courseProblem(course);
    if (cp) { showError('course', cp); bad = true; }
    if (!year || !/^[A-Z0-9]{1,3}$/.test(section)) { showError('yrAndSec', 'Choose a year level and enter a section (up to 3 characters).'); bad = true; }
    if (bad) return;

    G9FX.busy(btn, true, 'Registering…');
    let redirecting = false;
    try {
        const res = await fetch('/api/student/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentID, fname, lname, email, course, yrAndSec: year + '-' + section, profile: photoData })
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 401) { window.location.href = 'login.html'; return; }
        if (!res.ok) {
            showError(data.field, data.message || 'Registration failed.');
            return;
        }

        card.classList.add('stamped');
        if (data.staff) {
            G9FX.toast(data.message || 'Student registered.', 'success', 4200);
            if (data.account && data.account.created) {
                const n = $('notice');
                n.textContent = 'Login created. Username: ' + data.account.username + ' · Password: ' + data.account.password +
                    (data.emailed ? ' (also emailed to the student)' : ' (the email could not be sent, so give these to the student)');
                n.classList.add('show');
            }
            setTimeout(() => {
                form.reset();
                setPhoto('');
                card.classList.remove('stamped');
                preview();
                $('studentID').focus();
            }, 1800);
            return;
        }
        redirecting = true;
        G9FX.toast('Registration complete. Taking you to monitoring…', 'success', 2400);
        setTimeout(() => { window.location.href = data.redirect || 'monitoring.html'; }, 2200);
    } catch (err) {
        showError(null, 'Cannot reach the server. Check your connection and try again.');
    } finally {
        if (!redirecting) G9FX.busy(btn, false);
    }
});

(async () => {
    try {
        const res = await fetch('/api/student/status');
        if (res.status === 401) { window.location.href = 'login.html'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const staff = data.userType === 'ADMIN' || data.userType === 'MODERATOR';
        if (staff) {
            const sub = document.querySelector('.auth-subtext');
            if (sub) sub.textContent = 'Register a student. Their login is created automatically. This does not affect your own account.';
        } else if (data.userType !== 'STUDENT') lockForm('This account cannot register students.');
        else {
            if (data.email) { $('email').value = data.email; $('email').readOnly = true; }
            $('emailHint').textContent = 'This is the email on your account.';
            if (data.isRegistered) lockForm('Your registration is already on file.');
        }
    } catch (err) {}
})();
preview();
})();