// One-time script: converts every plain-text password in `users` to a bcrypt hash.
// Run from the G9 folder:  node database/hashPasswords.js
const bcrypt = require('bcryptjs');
const db = require('./db');

(async () => {
  try {
    const [rows] = await db.execute("SELECT id, username, password FROM users WHERE password NOT LIKE '$2%'");
    for (const u of rows) {
      await db.execute('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(u.password, 10), u.id]);
      console.log('hashed:', u.username);
    }
    console.log(`Done. ${rows.length} password(s) converted.`);
  } catch (err) {
    console.error('failed:', err.message);
  } finally {
    await db.end();
  }
})();