const crypto = require('crypto');

const USER_TYPES = ['STUDENT', 'ADMIN', 'MODERATOR'];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Uniform JSON error: { message, field }
const fail = (res, status, message, field) => res.status(status).json({ message, field });

// Store only what the app needs in the session.
function startSession(req, user) {
  req.session.user = { id: user.id, username: user.username, userType: user.userType };
}

module.exports = { USER_TYPES, sha256, fail, startSession };