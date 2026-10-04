const path = require('path');
const result = require('dotenv').config({ path: path.join(__dirname, '.env') });

if (result.error) console.error('dotenv could not load .env:', result.error.message);

const express = require('express');
const session = require('express-session');

const { signup } = require('./controller/signup');
const { login } = require('./controller/login');
const { forgotPassword } = require('./controller/forgotpass');
const { resetPassword } = require('./controller/resetpass');
const { requirePageAuth, requireApiAuth, me, logout } = require('./controller/homepage');
const { registerStudent, studentStatus } = require('./controller/studentregistration');
const { requireUser, requireStaff } = require('./controller/guards');
const { scan, today } = require('./controller/attendance');
const attendanceRoutes = require('./controller/attendanceroutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

app.post('/api/signup', signup);
app.post('/api/login', login);
app.post('/api/forgot-password', forgotPassword);
app.post('/api/reset-password', resetPassword);
app.get('/api/me', requireApiAuth, me);
app.post('/api/logout', logout);
app.get('/api/student/status', requireApiAuth, studentStatus);
app.post('/api/student/register', requireApiAuth, registerStudent);

// scan + today stay here (staff only); everything else for attendance lives in attendanceroutes.js
app.post('/api/attendance/scan', requireStaff, scan);
app.get('/api/attendance/today', requireStaff, today);
app.use('/api/attendance', requireUser, attendanceRoutes);

app.get('/monitoring.html', requirePageAuth);
app.get('/studentregistration.html', requirePageAuth);
app.get('/attendance.html', requirePageAuth);
app.use(express.static(path.join(__dirname, 'html')));
app.use(express.static(path.join(__dirname, 'css')));
app.get('/', (req, res) => res.redirect('/login.html'));

app.listen(PORT, () => console.log(`G9 running at http://localhost:${PORT}`));