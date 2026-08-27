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
  pot_size INTEGER NOT NULL DEFAULT 0,  -- размер банка раздачи — только для расчётной статистики
  created_at INTEGER NOT NULL
);
`);

// Миграция: если таблица hand_history уже существовала до добавления
// колонки pot_size — безопасно добавляем её (игнорируем ошибку, если уже есть).
try {
  db.exec('ALTER TABLE hand_history ADD COLUMN pot_size INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // колонка уже существует — это нормально
}

// Миграция: фото профиля игрока (хранится как data URL прямо в базе —
// так оно переживёт передеплой вместе с остальными данными на диске).
try {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
} catch (e) {
  // колонка уже существует — это нормально
}

// Миграция: IP-адрес регистрации — нужен для защиты от повторного
// получения приветственного бонуса через новые аккаунты с того же IP.
try {
  db.exec('ALTER TABLE users ADD COLUMN reg_ip TEXT');
} catch (e) {
  // колонка уже существует — это нормально
}

// Простая таблица настроек "ключ-значение" — используется, например, для
// текста и ссылок кнопок кассы, которые владелец клуба может менять сам
// через админку, без правки кода.
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// История раундов Mines и Crash — по аналогии со слотами, для истории
// игрока и возможности админу посмотреть статистику по клубу в целом.
db.exec(`
CREATE TABLE IF NOT EXISTS mines_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  bet INTEGER NOT NULL,
  grid_size INTEGER NOT NULL,
  mines_count INTEGER NOT NULL,
  revealed_count INTEGER NOT NULL,
  hit_mine INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crash_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  bet INTEGER NOT NULL,
  crash_point REAL NOT NULL,
  cashed_out_at REAL,
  payout INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Миграция: какой именно слот-автомат использовался в спине (для тех, кто
// уже играл до появления нескольких тематик).
try {
  db.exec("ALTER TABLE slot_spins ADD COLUMN machine_id TEXT NOT NULL DEFAULT 'fruits'");
} catch (e) {
  // колонка уже существует — это нормально
}

module.exports = db;

