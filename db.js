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

// Миграция: разделение кошелька на два независимых баланса — бонусные
// фишки (подарок за регистрацию, ничем не подкреплены) и купленные
// (то, что владелец клуба начислил вручную после реальной оплаты).
// Переносим существующий общий баланс (chips) целиком в бонусный —
// на момент этой миграции никто ещё не покупал фишки реально, поэтому
// это абсолютно безопасно и ничего не теряет.
try {
  db.exec('ALTER TABLE users ADD COLUMN chips_bonus INTEGER');
} catch (e) {
  // колонка уже существует — это нормально
}
try {
  db.exec('ALTER TABLE users ADD COLUMN chips_real INTEGER NOT NULL DEFAULT 0');
} catch (e) {
  // колонка уже существует — это нормально
}
try {
  db.exec('ALTER TABLE users ADD COLUMN active_mode TEXT NOT NULL DEFAULT \'bonus\'');
} catch (e) {
  // колонка уже существует — это нормально
}
// chips_bonus начинается как NULL (колонка только что добавлена) — заполняем
// один раз текущим общим балансом; дальше эта колонка живёт своей жизнью.
db.exec('UPDATE users SET chips_bonus = chips WHERE chips_bonus IS NULL');

// Простая таблица настроек "ключ-значение" — используется, например, для
// текста и ссылок кнопок кассы, которые владелец клуба может менять сам
// через админку, без правки кода.
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Одноразовая очистка: раньше IP определялся неверно (за прокси хостинга
// возвращался один и тот же внутренний адрес для ВСЕХ регистраций), из-за
// чего проверка на мультиаккаунтинг в админке ошибочно находила "всех
// подряд". Это уже исправлено для новых регистраций, но старые записи
// остались испорченными — стираем их один раз, чтобы больше не создавать
// ложных совпадений. Флаг в settings не даёт этой очистке повториться
// при следующих перезапусках (иначе стирались бы уже нормальные новые данные).
const alreadyCleanedRow = db.prepare("SELECT value FROM settings WHERE key = 'reg_ip_cleanup_done'").get();
if (!alreadyCleanedRow) {
  db.exec("UPDATE users SET reg_ip = NULL");
  db.prepare("INSERT INTO settings (key, value) VALUES ('reg_ip_cleanup_done', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
}

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
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  max_players INTEGER NOT NULL,
  entry_fee INTEGER NOT NULL,
  prize_pool INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'bonus',
  status TEXT NOT NULL DEFAULT 'registering',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS tournament_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  placement INTEGER,
  prize INTEGER NOT NULL DEFAULT 0,
  registered_at INTEGER NOT NULL,
  eliminated_at INTEGER
);
CREATE TABLE IF NOT EXISTS vf_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_num INTEGER NOT NULL,
  username TEXT NOT NULL,
  pick TEXT NOT NULL,
  stake INTEGER NOT NULL,
  odds REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payout INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'bonus',
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

// Миграция: в каком режиме (бонусном/купленном) была сделана ставка/спин/
// раунд — нужно, чтобы выигрыш возвращался в тот же кошелёк, из которого
// была ставка, а не в тот, что у игрока активен прямо сейчас.
try { db.exec("ALTER TABLE sport_bets ADD COLUMN mode TEXT NOT NULL DEFAULT 'bonus'"); } catch (e) {}
try { db.exec("ALTER TABLE slot_spins ADD COLUMN mode TEXT NOT NULL DEFAULT 'bonus'"); } catch (e) {}
try { db.exec("ALTER TABLE mines_rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'bonus'"); } catch (e) {}
try { db.exec("ALTER TABLE crash_rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'bonus'"); } catch (e) {}

module.exports = db;

