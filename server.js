require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const path = require('path');

const db = require('./db');
const game = require('./game');
const slots = require('./slots');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
const PORT = process.env.PORT || 3000;
// Приветственный бонус фишками клуба для каждого нового зарегистрированного
// игрока — не реальные деньги, просто стартовый баланс для первой игры.
const WELCOME_BONUS_CHIPS = 100;
// Домен(ы), которым разрешено обращаться к API/сокетам. Через запятую, если несколько.
// Пока не задано (пусто) — разрешено всё, чтобы не сломать локальную проверку.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : { origin: '*' };

if (JWT_SECRET === 'dev-secret-change-me-in-production' && process.env.NODE_ENV === 'production') {
  console.warn('⚠ ВНИМАНИЕ: используется секретный ключ по умолчанию в production. Задайте JWT_SECRET в .env!');
}

const app = express();
app.set('trust proxy', 1); // корректный IP за прокси хостинга (нужно для лимитера запросов)
app.use(helmet({
  contentSecurityPolicy: false // отключаем строгую CSP, т.к. используем внешние шрифты/CDN сокетов
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // увеличенный лимит — нужен для загрузки фото профиля
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

// Ограничение попыток входа/регистрации — защита от подбора пароля.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Подождите немного и попробуйте снова.' }
});

// ===================== ВСПОМОГАТЕЛЬНОЕ =====================
function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
}
function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}
function toPublicUser(u) {
  return { username: u.username, chips: u.chips, isAdmin: !!u.is_admin, banned: !!u.banned, avatar: u.avatar || null };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена авторизации.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserByUsername(payload.username);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден.' });
    if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован.' });
    req.dbUser = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Недействительный токен.' });
  }
}
function adminMiddleware(req, res, next) {
  if (!req.dbUser.is_admin) return res.status(403).json({ error: 'Только для администратора.' });
  next();
}

// ===================== AUTH ROUTES =====================
app.post('/api/register', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Заполните логин и пароль.' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Логин: латиница/цифры/подчёркивание, 3-20 символов.' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов.' });

  const existing = getUserByUsername(username);
  if (existing) return res.status(400).json({ error: 'Такой логин уже занят.' });

  const countRow = db.prepare('SELECT COUNT(*) as n FROM users').get();
  const isFirst = countRow.n === 0;
  const passwordHash = bcrypt.hashSync(password, 10);

  // Защита от повторного получения приветственного бонуса через новые
  // аккаунты: если с этого же IP уже регистрировался хоть один аккаунт —
  // новый создаётся нормально, но БЕЗ стартового бонуса. Это не блокирует
  // регистрацию (мало ли — общий Wi-Fi, семья), просто не даёт бонус
  // повторно с одного и того же адреса. Не панацея (мобильный интернет,
  // VPN легко меняют IP), но отсекает самый частый случай.
  const regIp = req.ip || null;
  const ipAlreadyUsed = regIp
    ? !!db.prepare('SELECT 1 FROM users WHERE reg_ip = ? LIMIT 1').get(regIp)
    : false;
  const startingChips = ipAlreadyUsed ? 0 : WELCOME_BONUS_CHIPS;

  db.prepare('INSERT INTO users (username, password_hash, chips, is_admin, banned, created_at, reg_ip) VALUES (?,?,?,?,?,?,?)')
    .run(username, passwordHash, startingChips, isFirst ? 1 : 0, 0, Date.now(), regIp);

  const user = getUserByUsername(username);
  res.json({ token: signToken(user.username), user: toPublicUser(user), firstAdmin: isFirst });
});

app.post('/api/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Заполните логин и пароль.' });
  const user = getUserByUsername(username);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден.' });
  if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован администратором.' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Неверный пароль.' });
  res.json({ token: signToken(user.username), user: toPublicUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: toPublicUser(req.dbUser) });
});

// ===================== КНОПКИ КАССЫ (настраиваются владельцем клуба) =====================
const DEFAULT_CASHIER_BUTTONS = [
  { label: 'КАССА', url: 'https://t.me/kassasvarastars' },
  { label: 'КАССИР', url: 'https://t.me/kassasvarastars' }
];
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function getCashierButtons() {
  return [1, 2].map(n => ({
    label: getSetting(`cashier_btn${n}_label`, DEFAULT_CASHIER_BUTTONS[n - 1].label),
    url: getSetting(`cashier_btn${n}_url`, DEFAULT_CASHIER_BUTTONS[n - 1].url)
  }));
}

app.get('/api/cashier-buttons', authMiddleware, (req, res) => {
  res.json({ buttons: getCashierButtons() });
});

app.post('/api/admin/cashier-buttons', authMiddleware, adminMiddleware, (req, res) => {
  const { buttons } = req.body || {};
  if (!Array.isArray(buttons) || buttons.length !== 2) {
    return res.status(400).json({ error: 'Нужно ровно 2 кнопки.' });
  }
  for (const b of buttons) {
    if (!b || typeof b.label !== 'string' || typeof b.url !== 'string') {
      return res.status(400).json({ error: 'У каждой кнопки должны быть текст и ссылка.' });
    }
    if (b.label.trim().length === 0 || b.label.length > 20) {
      return res.status(400).json({ error: 'Текст кнопки: от 1 до 20 символов.' });
    }
    if (b.url.trim().length > 0 && !/^https?:\/\//.test(b.url.trim())) {
      return res.status(400).json({ error: 'Ссылка должна начинаться с http:// или https://' });
    }
  }
  buttons.forEach((b, i) => {
    setSetting(`cashier_btn${i + 1}_label`, b.label.trim());
    setSetting(`cashier_btn${i + 1}_url`, b.url.trim());
  });
  res.json({ ok: true, buttons: getCashierButtons() });
});

app.post('/api/me/avatar', authMiddleware, (req, res) => {
  const { imageData } = req.body || {};
  if (!imageData || typeof imageData !== 'string') return res.status(400).json({ error: 'Нет данных изображения.' });
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(imageData)) {
    return res.status(400).json({ error: 'Поддерживаются только PNG, JPEG и WEBP.' });
  }
  if (imageData.length > 700000) { // ~500 КБ после base64 — достаточно для аватарки после сжатия на клиенте
    return res.status(400).json({ error: 'Файл слишком большой. Попробуйте изображение поменьше.' });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE username = ?').run(imageData, req.dbUser.username);
  res.json({ ok: true, avatar: imageData });
});

// ===================== ADMIN ROUTES =====================
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT username, chips, is_admin, banned, created_at FROM users ORDER BY created_at ASC').all();
  res.json({ users: rows.map(u => ({ username: u.username, chips: u.chips, isAdmin: !!u.is_admin, banned: !!u.banned, createdAt: u.created_at })) });
});

app.post('/api/admin/adjust', authMiddleware, adminMiddleware, (req, res) => {
  const { username, amount } = req.body || {};
  const amt = parseInt(amount);
  if (!username || !Number.isFinite(amt) || amt === 0) return res.status(400).json({ error: 'Некорректные данные.' });
  const target = getUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'Игрок не найден.' });
  const newChips = target.chips + amt;
  if (newChips < 0) return res.status(400).json({ error: 'Нельзя уйти в минус по балансу.' });
  db.prepare('UPDATE users SET chips = ? WHERE username = ?').run(newChips, target.username);
  db.prepare('INSERT INTO chip_adjustments (username, amount, admin_username, created_at) VALUES (?,?,?,?)')
    .run(target.username, amt, req.dbUser.username, Date.now());
  res.json({ ok: true, chips: newChips });
});

app.post('/api/admin/ban', authMiddleware, adminMiddleware, (req, res) => {
  const { username } = req.body || {};
  const target = getUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'Игрок не найден.' });
  db.prepare('UPDATE users SET banned = ? WHERE username = ?').run(target.banned ? 0 : 1, target.username);
  res.json({ ok: true, banned: !target.banned });
});

app.post('/api/admin/promote', authMiddleware, adminMiddleware, (req, res) => {
  const { username } = req.body || {};
  const target = getUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'Игрок не найден.' });
  db.prepare('UPDATE users SET is_admin = ? WHERE username = ?').run(target.is_admin ? 0 : 1, target.username);
  res.json({ ok: true, isAdmin: !target.is_admin });
});

// ===================== СПОРТ: МАТЧИ И СТАВКИ =====================
// Коэффициенты задаёт администратор вручную под каждый матч — без
// встроенной наценки/маржи в чью-либо пользу. Ставки идут на фишки клуба.

function toPublicMatch(m) {
  return {
    id: m.id, title: m.title, competition: m.competition,
    oddsHome: m.odds_home, oddsDraw: m.odds_draw, oddsAway: m.odds_away,
    status: m.status, result: m.result, createdAt: m.created_at
  };
}

app.get('/api/sports/matches', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM sport_matches ORDER BY created_at DESC').all();
  res.json({ matches: rows.map(toPublicMatch) });
});

app.get('/api/sports/mybets', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, m.title, m.competition FROM sport_bets b
    JOIN sport_matches m ON m.id = b.match_id
    WHERE b.username = ? COLLATE NOCASE ORDER BY b.created_at DESC
  `).all(req.dbUser.username);
  res.json({ bets: rows });
});

app.post('/api/sports/bet', authMiddleware, (req, res) => {
  const { matchId, pick, stake } = req.body || {};
  const st = parseInt(stake);
  if (!matchId || !['home', 'draw', 'away'].includes(pick) || !Number.isFinite(st) || st <= 0) {
    return res.status(400).json({ error: 'Некорректные данные ставки.' });
  }
  const match = db.prepare('SELECT * FROM sport_matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Матч не найден.' });
  if (match.status !== 'open') return res.status(400).json({ error: 'Приём ставок на этот матч закрыт.' });

  const oddsMap = { home: match.odds_home, draw: match.odds_draw, away: match.odds_away };
  const odds = oddsMap[pick];
  if (!odds) return res.status(400).json({ error: 'На этот исход ставки не принимаются.' });

  const user = getUserByUsername(req.dbUser.username);
  if (st > user.chips) return res.status(400).json({ error: `Недостаточно фишек. На балансе: ${user.chips}.` });

  db.prepare('UPDATE users SET chips = chips - ? WHERE username = ?').run(st, user.username);
  db.prepare('INSERT INTO sport_bets (username, match_id, pick, stake, odds, status, payout, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(user.username, matchId, pick, st, odds, 'pending', 0, Date.now());

  res.json({ ok: true, chips: user.chips - st });
});

app.post('/api/admin/sports/create', authMiddleware, adminMiddleware, (req, res) => {
  const { title, competition, oddsHome, oddsDraw, oddsAway } = req.body || {};
  const oh = parseFloat(oddsHome), od = oddsDraw !== undefined && oddsDraw !== '' ? parseFloat(oddsDraw) : null, oa = parseFloat(oddsAway);
  if (!title || !Number.isFinite(oh) || oh <= 1 || !Number.isFinite(oa) || oa <= 1) {
    return res.status(400).json({ error: 'Заполните название и корректные коэффициенты (больше 1.0).' });
  }
  if (od !== null && (!Number.isFinite(od) || od <= 1)) {
    return res.status(400).json({ error: 'Коэффициент на ничью должен быть больше 1.0 (или оставьте поле пустым, если ничьей не бывает).' });
  }
  db.prepare('INSERT INTO sport_matches (title, competition, odds_home, odds_draw, odds_away, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(title, competition || null, oh, od, oa, 'open', req.dbUser.username, Date.now());
  res.json({ ok: true });
});

app.post('/api/admin/sports/close', authMiddleware, adminMiddleware, (req, res) => {
  const { matchId } = req.body || {};
  const match = db.prepare('SELECT * FROM sport_matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Матч не найден.' });
  if (match.status !== 'open') return res.status(400).json({ error: 'Матч уже закрыт или рассчитан.' });
  db.prepare('UPDATE sport_matches SET status = ? WHERE id = ?').run('closed', matchId);
  res.json({ ok: true });
});

app.post('/api/admin/sports/resolve', authMiddleware, adminMiddleware, (req, res) => {
  const { matchId, result } = req.body || {};
  if (!['home', 'draw', 'away'].includes(result)) return res.status(400).json({ error: 'Некорректный результат.' });
  const match = db.prepare('SELECT * FROM sport_matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Матч не найден.' });
  if (match.status === 'resolved') return res.status(400).json({ error: 'Матч уже рассчитан.' });

  const bets = db.prepare('SELECT * FROM sport_bets WHERE match_id = ? AND status = ?').all(matchId, 'pending');
  const settle = db.transaction(() => {
    bets.forEach(b => {
      if (b.pick === result) {
        const payout = Math.round(b.stake * b.odds);
        db.prepare('UPDATE sport_bets SET status = ?, payout = ? WHERE id = ?').run('won', payout, b.id);
        db.prepare('UPDATE users SET chips = chips + ? WHERE username = ? COLLATE NOCASE').run(payout, b.username);
      } else {
        db.prepare('UPDATE sport_bets SET status = ?, payout = 0 WHERE id = ?').run('lost', b.id);
      }
    });
    db.prepare('UPDATE sport_matches SET status = ?, result = ? WHERE id = ?').run('resolved', result, matchId);
  });
  settle();

  res.json({ ok: true, settledBets: bets.length });
});

app.get('/api/admin/sports/matches', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM sport_matches ORDER BY created_at DESC').all();
  res.json({ matches: rows.map(toPublicMatch) });
});

// ===================== СЛОТЫ (фишки клуба, без реальных денег) =====================
app.post('/api/slots/spin', authMiddleware, (req, res) => {
  const bet = parseInt(req.body?.bet);
  if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ error: 'Некорректная ставка.' });

  const user = getUserByUsername(req.dbUser.username);
  if (bet > user.chips) return res.status(400).json({ error: `Недостаточно фишек. На балансе: ${user.chips}.` });

  const result = slots.spinSlots(bet);
  const net = result.payout - bet;
  db.prepare('UPDATE users SET chips = chips + ? WHERE username = ?').run(net, user.username);
  db.prepare('INSERT INTO slot_spins (username, bet, r1, r2, r3, payout, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(user.username, bet, result.reels[0], result.reels[1], result.reels[2], result.payout, Date.now());

  const updated = getUserByUsername(user.username);
  res.json({ ok: true, reels: result.reels, payout: result.payout, chips: updated.chips });
});

app.get('/api/slots/myspins', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM slot_spins WHERE username = ? COLLATE NOCASE ORDER BY id DESC LIMIT 15').all(req.dbUser.username);
  res.json({ spins: rows });
});

app.get('/api/admin/slots/stats', authMiddleware, adminMiddleware, (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as spins, COALESCE(SUM(bet),0) as wagered, COALESCE(SUM(payout),0) as paid FROM slot_spins').get();
  res.json({ spins: row.spins, wagered: row.wagered, paid: row.paid, net: row.wagered - row.paid });
});

// ===================== СТАТИСТИКА ИГРОКА (АДМИН) =====================
// Наблюдательная аналитика для владельца клуба: история ручных
// пополнений/списаний и статистика раздач в покере. Это НЕ доход клуба —
// фишки игрока остаются его фишками внутри закрытой экономики клуба.
//
// RAKE_STAT_PERCENT — чисто расчётный процент для статистики «сколько
// составил бы рейк». Он НИГДЕ не применяется как реальное списание — ни у
// одного игрока фишки за это не удерживаются и никому не начисляются.
// Это просто число для отчёта владельцу.
const RAKE_STAT_PERCENT = 5;

app.get('/api/admin/player/:username/stats', authMiddleware, adminMiddleware, (req, res) => {
  const username = req.params.username;
  const target = getUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'Игрок не найден.' });

  const adjustments = db.prepare(
    'SELECT amount, admin_username, created_at FROM chip_adjustments WHERE username = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 100'
  ).all(username);

  const handsRow = db.prepare(
    `SELECT COUNT(*) as played,
            SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as won,
            SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as lost,
            COALESCE(SUM(delta),0) as netChips,
            COALESCE(SUM(pot_size),0) as totalPotVolume
     FROM hand_history WHERE username = ? COLLATE NOCASE`
  ).get(username);

  const recentHands = db.prepare(
    'SELECT room_code, hand_number, delta, won, pot_size, created_at FROM hand_history WHERE username = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 30'
  ).all(username);

  const theoreticalRake = Math.round((handsRow.totalPotVolume || 0) * RAKE_STAT_PERCENT / 100);

  res.json({
    username: target.username,
    currentChips: target.chips,
    adjustments,
    hands: {
      played: handsRow.played || 0,
      won: handsRow.won || 0,
      lost: handsRow.lost || 0,
      netChips: handsRow.netChips || 0,
      totalPotVolume: handsRow.totalPotVolume || 0
    },
    theoreticalRake,
    rakePercent: RAKE_STAT_PERCENT,
    recentHands
  });
});

app.get('/api/admin/rake-stats', authMiddleware, adminMiddleware, (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) as totalHands, COALESCE(SUM(pot_size),0) as totalPotVolume FROM (
      SELECT DISTINCT room_code, hand_number, pot_size FROM hand_history
    )
  `).get();
  const theoreticalRake = Math.round((row.totalPotVolume || 0) * RAKE_STAT_PERCENT / 100);
  res.json({ totalPotVolume: row.totalPotVolume || 0, totalHands: row.totalHands || 0, theoreticalRake, rakePercent: RAKE_STAT_PERCENT });
});

// ===================== ИГРОВЫЕ КОМНАТЫ (в памяти сервера) =====================
const rooms = new Map();        // code -> room object (game.js), + seats[i].socketId
const socketMeta = new Map();   // socket.id -> { username, roomCode }

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(c) ? genCode() : c;
}

function broadcastRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.seats.forEach(s => {
    if (s && s.socketId) {
      const viewerUser = getUserByUsername(s.username);
      const viewerIsAdmin = !!(viewerUser && viewerUser.is_admin);
      io.to(s.socketId).emit('table:state', game.redactForViewer(room, s.username, viewerIsAdmin));
    }
  });
  if (room.spectatorSocketIds && room.spectatorSocketIds.length) {
    room.spectatorSocketIds.forEach(sid => {
      io.to(sid).emit('admin:tableState', game.fullStateForAdmin(room));
    });
  }
}

function broadcastLobby() {
  const list = Array.from(rooms.values())
    .filter(r => r.phase !== 'closed')
    .map(r => ({
      code: r.code,
      hostName: r.hostName,
      betUnit: r.betUnit,
      playerCount: game.seatedIndices(r).length,
      maxSeats: r.maxSeats || r.seats.length,
      phase: r.phase,
      players: r.seats.filter(Boolean).map(s => ({ username: s.username, avatar: s.avatar || null }))
    }));
  io.to('lobby').emit('lobby:rooms', list);
}

function cashOutSeat(room, idx) {
  const s = room.seats[idx];
  if (!s) return;
  const target = getUserByUsername(s.username);
  if (target) {
    db.prepare('UPDATE users SET chips = chips + ? WHERE username = ?').run(s.chips, target.username);
  }
  room.log.push(`${s.username} встал(а) из-за стола (забрал(а) ${s.chips} фишек).`);
  room.seats[idx] = null;
}

// ===================== ИСТОРИЯ РАЗДАЧ =====================
function logHandHistoryIfNeeded(room) {
  if (room.phase !== 'handEnd') return;
  if (room.lastLoggedHand === room.handNumber) return; // уже записали эту раздачу
  room.lastLoggedHand = room.handNumber;
  const starts = room.handStartChips || {};
  const potSize = room.lastPotSize || 0;
  room.seats.forEach(s => {
    if (!s) return;
    const startChips = starts[s.username];
    if (startChips === undefined) return; // не участвовал в этой раздаче
    const delta = s.chips - startChips;
    db.prepare('INSERT INTO hand_history (username, room_code, hand_number, delta, won, pot_size, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(s.username, room.code, room.handNumber, delta, delta > 0 ? 1 : 0, potSize, Date.now());
  });
}

// ===================== ТАЙМЕР ХОДА (авто-пас, если не успел сходить) =====================
const TURN_SECONDS = 30;
function scheduleTurnTimer(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (room.phase !== 'betting' || room.turnIndex === null || room.turnIndex === undefined) {
    room.turnDeadline = null;
    return;
  }
  room.turnDeadline = Date.now() + TURN_SECONDS * 1000;
  const seatIdx = room.turnIndex;
  room.turnTimer = setTimeout(() => {
    const fresh = rooms.get(room.code);
    if (!fresh || fresh.phase !== 'betting' || fresh.turnIndex !== seatIdx) return;
    const seatObj = fresh.seats[seatIdx];
    const result = game.actFold(fresh, seatIdx);
    if (result.ok) {
      fresh.log.push(`⏱ Автопас по истечении времени хода.`);
      logHandHistoryIfNeeded(fresh);

      // Если игрок не реагирует на свой ход уже вторую раздачу подряд —
      // аккуратно встаём его из-за стола (фишки возвращаются в кошелёк,
      // аккаунт и остальной баланс не трогаются), чтобы не задерживать
      // остальных за столом.
      if (seatObj) {
        seatObj.consecutiveTimeouts = (seatObj.consecutiveTimeouts || 0) + 1;
        if (seatObj.consecutiveTimeouts >= 2) {
          const kickedName = seatObj.username;
          const kickedSocketId = seatObj.socketId;
          cashOutSeat(fresh, seatIdx);
          fresh.log.push(`${kickedName} автоматически встал(а) из-за стола — не отвечал(а) на ход две раздачи подряд.`);
          if (kickedSocketId) {
            io.to(kickedSocketId).emit('table:kicked', {
              reason: 'inactive',
              message: 'Вы автоматически встали из-за стола — не было хода две раздачи подряд. Фишки возвращены в кошелёк.'
            });
          }
          broadcastLobby();
        }
      }

      if (fresh.phase === 'handEnd') scheduleAutoNextHand(fresh);
      scheduleTurnTimer(fresh);
      broadcastRoom(fresh.code);
    }
  }, TURN_SECONDS * 1000);
}

// ===================== АВТОМАТИЧЕСКАЯ РАЗДАЧА =====================
function tryAutoDeal(room) {
  if (room.phase !== 'lobby') return;
  const seated = game.seatedIndices(room).filter(i => room.seats[i].chips > 0);
  if (seated.length >= 2) {
    const result = game.dealHand(room);
    if (result.ok) {
      // Редкий краевой случай: если у всех сразу не хватило фишек даже на
      // полноценную торговлю (все ушли в ва-банк прямо на анте), раздача
      // может завершиться сразу же внутри dealHand — тогда нужно записать
      // историю и запустить автостарт следующей раздачи, а не таймер хода.
      if (room.phase === 'handEnd') {
        logHandHistoryIfNeeded(room);
        scheduleAutoNextHand(room);
      } else {
        scheduleTurnTimer(room);
      }
    }
  }
}

const AUTO_NEXT_HAND_DELAY = 10000; // время показать итог раздачи (кто выиграл и с какими картами), прежде чем начать следующую
function scheduleAutoNextHand(room) {
  if (room.autoNextTimer) { clearTimeout(room.autoNextTimer); room.autoNextTimer = null; }
  if (room.phase !== 'handEnd') return;
  room.autoNextTimer = setTimeout(() => {
    const fresh = rooms.get(room.code);
    if (!fresh || fresh.phase !== 'handEnd') return;
    const result = game.nextHandReset(fresh);
    if (result.ok) {
      // Игроки, у которых закончились фишки, больше не могут играть дальше —
      // нет смысла держать за ними место, пока за столом ждут другие. Перед
      // следующей раздачей автоматически освобождаем их места.
      fresh.seats.forEach((s, idx) => {
        if (s && s.chips <= 0) {
          fresh.log.push(`${s.username} автоматически встал(а) из-за стола — закончились фишки.`);
          cashOutSeat(fresh, idx);
        }
      });
      tryAutoDeal(fresh);
      broadcastRoom(fresh.code);
      broadcastLobby();
    }
  }, AUTO_NEXT_HAND_DELAY);
}

// ===================== SOCKET.IO AUTH =====================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('no_token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserByUsername(payload.username);
    if (!user) return next(new Error('user_not_found'));
    if (user.banned) return next(new Error('banned'));
    socket.username = user.username;
    socket.isAdmin = !!user.is_admin;
    next();
  } catch (e) {
    next(new Error('bad_token'));
  }
});

function removeSpectator(socketId) {
  rooms.forEach(room => {
    if (room.spectatorSocketIds) {
      room.spectatorSocketIds = room.spectatorSocketIds.filter(id => id !== socketId);
    }
  });
}

io.on('connection', (socket) => {
  socketMeta.set(socket.id, { username: socket.username, roomCode: null });

  socket.on('lobby:join', () => {
    socket.join('lobby');
    broadcastLobby();
  });

  socket.on('table:create', ({ betUnit, maxSeats }, cb) => {
    const bu = Math.max(5, parseInt(betUnit) || 20);
    const seatCount = [2, 3, 4, 5, 6].includes(parseInt(maxSeats)) ? parseInt(maxSeats) : 6;
    const user = getUserByUsername(socket.username);
    if (!user) return cb({ ok: false, error: 'Пользователь не найден.' });
    if (user.chips <= 0) return cb({ ok: false, error: 'На балансе нет фишек — обратитесь к администратору клуба.' });
    if (user.chips < bu) return cb({ ok: false, error: `Недостаточно фишек для этой ставки. На балансе: ${user.chips}.` });

    const bi = user.chips; // садимся всем балансом кошелька
    db.prepare('UPDATE users SET chips = 0 WHERE username = ?').run(user.username);

    const code = genCode();
    const room = game.createRoom(code, bu, socket.username, seatCount);
    room.seats[0] = { username: socket.username, avatar: user.avatar || null, chips: bi, hand: [], folded: false, inHand: false, betThisRound: 0, hasActed: false, consecutiveTimeouts: 0, socketId: socket.id };
    rooms.set(code, room);

    socket.join('table:' + code);
    socketMeta.set(socket.id, { username: socket.username, roomCode: code });

    cb({ ok: true, code });
    broadcastRoom(code);
    broadcastLobby();
  });

  socket.on('table:join', ({ code }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Стол не найден.' });

    const already = room.seats.findIndex(s => s && s.username === socket.username);
    if (already >= 0) {
      room.seats[already].socketId = socket.id;
      socket.join('table:' + code);
      socketMeta.set(socket.id, { username: socket.username, roomCode: code });
      cb({ ok: true, code });
      broadcastRoom(code);
      return;
    }

    const emptyIdx = room.seats.findIndex(s => !s);
    if (emptyIdx < 0) return cb({ ok: false, error: 'Стол уже заполнен.' });

    const user = getUserByUsername(socket.username);
    if (!user) return cb({ ok: false, error: 'Пользователь не найден.' });
    if (user.chips <= 0) return cb({ ok: false, error: 'На балансе нет фишек — обратитесь к администратору клуба.' });
    if (user.chips < room.betUnit) return cb({ ok: false, error: `Недостаточно фишек для этого стола (нужно минимум ${room.betUnit}). На балансе: ${user.chips}.` });

    const bi = user.chips; // садимся всем балансом кошелька
    db.prepare('UPDATE users SET chips = 0 WHERE username = ?').run(user.username);

    room.seats[emptyIdx] = { username: socket.username, avatar: user.avatar || null, chips: bi, hand: [], folded: false, inHand: false, betThisRound: 0, hasActed: false, consecutiveTimeouts: 0, socketId: socket.id };
    room.log.push(`${socket.username} присоединился(-лась) за стол (${bi} фишек).`);

    socket.join('table:' + code);
    socketMeta.set(socket.id, { username: socket.username, roomCode: code });

    tryAutoDeal(room);

    cb({ ok: true, code });
    broadcastRoom(code);
    broadcastLobby();
  });

  function mySeatIndex(room) {
    return room.seats.findIndex(s => s && s.username === socket.username);
  }

  socket.on('table:action', ({ type, amount }, cb) => {
    const meta = socketMeta.get(socket.id);
    const room = meta && rooms.get(meta.roomCode);
    if (!room) return cb && cb({ ok: false, error: 'Вы не за столом.' });
    const idx = mySeatIndex(room);
    if (idx < 0) return cb && cb({ ok: false, error: 'Вы не за столом.' });

    // Раз это реальное действие живого игрока (не автопас по таймеру —
    // тот вызывается отдельно, напрямую, минуя этот обработчик) — сбрасываем
    // счётчик пропущенных подряд раздач.
    if ((type === 'call' || type === 'raise' || type === 'fold') && room.seats[idx]) {
      room.seats[idx].consecutiveTimeouts = 0;
    }

    let result;
    if (type === 'deal') result = game.dealHand(room);
    else if (type === 'call') result = game.actCall(room, idx);
    else if (type === 'raise') result = game.actRaise(room, idx, amount);
    else if (type === 'fold') result = game.actFold(room, idx);
    else if (type === 'next') result = game.nextHandReset(room);
    else result = { ok: false, error: 'Неизвестное действие.' };

    if (result.ok) logHandHistoryIfNeeded(room);
    if (result.ok && room.phase === 'handEnd') scheduleAutoNextHand(room);
    if (result.ok) scheduleTurnTimer(room);
    if (cb) cb(result);
    if (result.ok) broadcastRoom(room.code);
  });

  // ===== Админ: список активных столов и режим наблюдения с открытыми картами =====
  socket.on('admin:listTables', (cb) => {
    if (!socket.isAdmin) return cb && cb({ ok: false, error: 'Только для администратора.' });
    const list = Array.from(rooms.values()).map(r => ({
      code: r.code, hostName: r.hostName, betUnit: r.betUnit,
      playerCount: game.seatedIndices(r).length, phase: r.phase
    }));
    cb && cb({ ok: true, tables: list });
  });

  socket.on('admin:spectate', ({ code }, cb) => {
    if (!socket.isAdmin) return cb && cb({ ok: false, error: 'Только для администратора.' });
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: 'Стол не найден.' });
    room.spectatorSocketIds = room.spectatorSocketIds || [];
    if (!room.spectatorSocketIds.includes(socket.id)) room.spectatorSocketIds.push(socket.id);
    cb && cb({ ok: true });
    io.to(socket.id).emit('admin:tableState', game.fullStateForAdmin(room));
  });

  socket.on('admin:unspectate', ({ code }) => {
    const room = rooms.get(code);
    if (room && room.spectatorSocketIds) {
      room.spectatorSocketIds = room.spectatorSocketIds.filter(id => id !== socket.id);
    }
  });

  socket.on('table:chat', (text, cb) => {
    const meta = socketMeta.get(socket.id);
    const room = meta && rooms.get(meta.roomCode);
    if (!room) return cb && cb({ ok: false, error: 'Вы не за столом.' });
    const idx = room.seats.findIndex(s => s && s.username === socket.username);
    if (idx < 0) return cb && cb({ ok: false, error: 'Вы не за столом.' });
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return cb && cb({ ok: false, error: 'Пустое сообщение.' });
    if (!room.chat) room.chat = [];
    room.chat.push({ username: socket.username, text: clean, ts: Date.now() });
    if (room.chat.length > 100) room.chat = room.chat.slice(-100);
    broadcastRoom(room.code);
    if (cb) cb({ ok: true });
  });

  socket.on('table:leave', (cb) => {
    const meta = socketMeta.get(socket.id);
    const room = meta && rooms.get(meta.roomCode);
    if (room) {
      const idx = room.seats.findIndex(s => s && s.username === socket.username);
      if (idx >= 0) {
        // Если игрок уходит посреди активной раздачи, будучи ещё "в игре"
        // (не спасовавшим) — раньше место просто обнулялось, а ход и
        // проверка завершения раздачи никогда не пересчитывались. Если это
        // как раз был его ход — очередь навсегда зависала на теперь уже
        // пустом месте. Его ставка в банке остаётся (как при обычном пасе),
        // но раздача должна корректно понять, что его больше нет.
        const wasActiveInHand = room.phase === 'betting' && room.seats[idx].inHand && !room.seats[idx].folded;
        const wasTheirTurn = room.phase === 'betting' && room.turnIndex === idx;
        cashOutSeat(room, idx);
        if (wasActiveInHand) {
          if (wasTheirTurn) room.turnIndex = game.nextActiveIndex(room, idx);
          game.resolveIfDone(room);
          if (room.phase === 'handEnd') { logHandHistoryIfNeeded(room); scheduleAutoNextHand(room); }
          else if (room.phase === 'betting') scheduleTurnTimer(room);
        }
      }
      socket.leave('table:' + room.code);
      socketMeta.set(socket.id, { username: socket.username, roomCode: null });
      broadcastRoom(room.code);
      broadcastLobby();
      if (game.seatedIndices(room).length === 0) rooms.delete(room.code);
    }
    if (cb) cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    if (meta && meta.roomCode) {
      const room = rooms.get(meta.roomCode);
      if (room) {
        // Не забираем место сразу — игрок может переподключиться (обновил страницу).
        const seat = room.seats.find(s => s && s.username === meta.username);
        if (seat) seat.socketId = null;
      }
    }
    removeSpectator(socket.id);
    socketMeta.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Свара-сервер запущен на порту ${PORT}`);
});

// ===================== БЕЗОПАСНОЕ ЗАВЕРШЕНИЕ =====================
// Render (и любой другой хостинг) при передеплое сначала посылает SIGTERM
// и даёт немного времени на завершение, прежде чем убить процесс. Раньше
// фишки игроков, сидящих за столом, хранились только в памяти и терялись
// при перезапуске. Теперь при остановке сервера мы ПЕРЕД выходом
// принудительно возвращаем фишки всех, кто сейчас сидит за любым столом,
// обратно в их кошельки в базе данных — деньги не теряются даже при
// деплое посреди игры.
let shuttingDown = false;
function cashOutAllActiveRooms() {
  let affected = 0;
  rooms.forEach(room => {
    room.seats.forEach(s => {
      if (s && s.chips > 0) {
        db.prepare('UPDATE users SET chips = chips + ? WHERE username = ? COLLATE NOCASE').run(s.chips, s.username);
        affected++;
      }
    });
  });
  if (affected > 0) {
    console.log(`Безопасное завершение: фишки возвращены в кошельки для ${affected} мест за активными столами.`);
  }
}
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен сигнал ${signal} — сохраняем фишки всех активных столов перед остановкой…`);
  try {
    cashOutAllActiveRooms();
  } catch (e) {
    console.error('Ошибка при сохранении фишек во время остановки:', e);
  }
  // Запись в базу synchronous (better-sqlite3) и уже завершена к этому месту —
  // дальше можно выходить сразу, не дожидаясь закрытия сетевых соединений.
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ===================== ЗАЩИТА ОТ ВНЕЗАПНОГО КРАША =====================
// Раньше защита срабатывала только при плановой остановке (SIGTERM) —
// например, когда нажимают "Manual Deploy". Но сервер может упасть и
// САМ, из-за необработанной ошибки в коде ("Exited with status 1" от
// Render) — и в этом случае SIGTERM не приходит вообще, защита не
// срабатывала, и фишки игроков, сидящих за столом, терялись. Теперь
// сохраняем фишки и в этом сценарии тоже, перед тем как процесс упадёт.
process.on('uncaughtException', (err) => {
  console.error('НЕОБРАБОТАННАЯ ОШИБКА — сохраняем фишки активных столов перед аварийным завершением:', err);
  try { cashOutAllActiveRooms(); } catch (e) { console.error('Ошибка при аварийном сохранении фишек:', e); }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('НЕОБРАБОТАННЫЙ REJECTION — сохраняем фишки активных столов перед аварийным завершением:', reason);
  try { cashOutAllActiveRooms(); } catch (e) { console.error('Ошибка при аварийном сохранении фишек:', e); }
  process.exit(1);
});
