const Database = require('better-sqlite3');
const path = require('path');

// Если задан DB_PATH (например, путь к постоянному диску на хостинге вроде
// /data/svara.db) — используем его. Иначе, для локального запуска —
// обычный файл рядом с кодом.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'svara.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  chips INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

module.exports = db;
