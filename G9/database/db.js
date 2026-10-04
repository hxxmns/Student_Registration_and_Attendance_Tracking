require('dotenv').config();
const mysql = require('mysql2/promise');

// Single shared connection pool used by every controller.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'student_information_system',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;