const tls = require('tls');
const crypto = require('crypto');

function sendMail({ from, to, subject, text, html }) {
  const host = process.env.MAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.MAIL_PORT) || 465;
  const user = process.env.MAIL_USER;
  const pass = String(process.env.MAIL_PASS || '').replace(/\s+/g, '');

  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const wrap = (s) => b64(s).replace(/.{76}/g, '$&\r\n');
  const boundary = '=_g9_' + crypto.randomBytes(8).toString('hex');

  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${String(user).split('@')[1] || 'localhost'}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(html),
    `--${boundary}--`,
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    socket.setEncoding('utf8');
    socket.setTimeout(20000);

    const replies = [];
    const waiters = [];
    let lines = [];
    let buffer = '';
    let closed = false;

    function fail(err) {
      if (closed) return;
      closed = true;
      socket.destroy();
      while (waiters.length) waiters.shift().reject(err);
      reject(err);
    }

    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('SMTP connection timed out')));
    socket.on('close', () => fail(new Error('SMTP connection closed')));

    socket.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        lines.push(line);
        if (/^\d{3}( |$)/.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), text: lines.join(' ') };
          lines = [];
          const w = waiters.shift();
          if (w) w.resolve(reply); else replies.push(reply);
        }
      }
    });

    function nextReply() {
      if (replies.length) return Promise.resolve(replies.shift());
      return new Promise((res, rej) => waiters.push({ resolve: res, reject: rej }));
    }

    async function expect(codes) {
      const r = await nextReply();
      if (!codes.includes(r.code)) {
        const err = new Error(`SMTP ${r.code}: ${r.text}`);
        err.code = r.code === 535 ? 'EAUTH' : 'ESMTP';
        throw err;
      }
      return r;
    }

    async function cmd(line, codes) {
      socket.write(line + '\r\n');
      return expect(codes);
    }

    (async () => {
      await expect([220]);
      await cmd('EHLO g9.local', [250]);
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(user), [334]);
      await cmd(b64(pass), [235]);
      await cmd(`MAIL FROM:<${user}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      socket.write(message + '\r\n.\r\n');
      await expect([250]);
      socket.write('QUIT\r\n');
      closed = true;
      socket.end();
      resolve();
    })().catch(fail);
  });
}

module.exports = { sendMail };