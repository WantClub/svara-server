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

CREATE TABLE IF NOT EXISTS sport_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  competition TEXT,
  odds_home REAL NOT NULL,
  odds_draw REAL,
  odds_away REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed | resolved
  result TEXT,                            -- home | draw | away
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sport_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  match_id INTEGER NOT NULL,
  pick TEXT NOT NULL,      -- home | draw | away
  stake INTEGER NOT NULL,
  odds REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | won | lost
  payout INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slot_spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  bet INTEGER NOT NULL,
  r1 TEXT NOT NULL, r2 TEXT NOT NULL, r3 TEXT NOT NULL,
  payout INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chip_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  amount INTEGER NOT NULL,     -- положительное = пополнение, отрицательное = списание
  admin_username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hand_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  room_code TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  delta INTEGER NOT NULL,      -- изменение фишек игрока за эту раздачу (может быть отрицательным)
  won INTEGER NOT NULL,        -- 1 если раздача сыграна в плюс, 0 если в минус
  created_at INTEGER NOT NULL
);
`);

module.exports = db;

