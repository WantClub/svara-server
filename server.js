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

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
const PORT = process.env.PORT || 3000;
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
app.use(express.json());
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
  return { username: u.username, chips: u.chips, isAdmin: !!u.is_admin, banned: !!u.banned };
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

  db.prepare('INSERT INTO users (username, password_hash, chips, is_admin, banned, created_at) VALUES (?,?,?,?,?,?)')
    .run(username, passwordHash, 0, isFirst ? 1 : 0, 0, Date.now());

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
      io.to(s.socketId).emit('table:state', game.redactForViewer(room, s.username));
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
      phase: r.phase
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

  socket.on('table:create', ({ betUnit, buyIn }, cb) => {
    const bu = Math.max(5, parseInt(betUnit) || 20);
    const bi = Math.max(bu, parseInt(buyIn) || bu * 10);
    const user = getUserByUsername(socket.username);
    if (!user) return cb({ ok: false, error: 'Пользователь не найден.' });
    if (bi > user.chips) return cb({ ok: false, error: `Недостаточно фишек. На балансе: ${user.chips}.` });

    db.prepare('UPDATE users SET chips = chips - ? WHERE username = ?').run(bi, user.username);

    const code = genCode();
    const room = game.createRoom(code, bu, socket.username);
    room.seats[0] = { username: socket.username, chips: bi, hand: [], folded: false, inHand: false, betThisRound: 0, hasActed: false, socketId: socket.id };
    rooms.set(code, room);

    socket.join('table:' + code);
    socketMeta.set(socket.id, { username: socket.username, roomCode: code });

    cb({ ok: true, code });
    broadcastRoom(code);
    broadcastLobby();
  });

  socket.on('table:join', ({ code, buyIn }, cb) => {
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

    const bi = Math.max(room.betUnit, parseInt(buyIn) || room.betUnit * 10);
    const user = getUserByUsername(socket.username);
    if (bi > user.chips) return cb({ ok: false, error: `Недостаточно фишек. На балансе: ${user.chips}.` });

    db.prepare('UPDATE users SET chips = chips - ? WHERE username = ?').run(bi, user.username);

    room.seats[emptyIdx] = { username: socket.username, chips: bi, hand: [], folded: false, inHand: false, betThisRound: 0, hasActed: false, socketId: socket.id };
    room.log.push(`${socket.username} присоединился(-лась) за стол (бай-ин ${bi}).`);

    socket.join('table:' + code);
    socketMeta.set(socket.id, { username: socket.username, roomCode: code });

    cb({ ok: true, code });
    broadcastRoom(code);
    broadcastLobby();
  });

  function mySeatIndex(room) {
    return room.seats.findIndex(s => s && s.username === socket.username);
  }

  socket.on('table:action', ({ type }, cb) => {
    const meta = socketMeta.get(socket.id);
    const room = meta && rooms.get(meta.roomCode);
    if (!room) return cb && cb({ ok: false, error: 'Вы не за столом.' });
    const idx = mySeatIndex(room);
    if (idx < 0) return cb && cb({ ok: false, error: 'Вы не за столом.' });

    let result;
    if (type === 'deal') result = game.dealHand(room);
    else if (type === 'call') result = game.actCall(room, idx);
    else if (type === 'raise') result = game.actRaise(room, idx);
    else if (type === 'fold') result = game.actFold(room, idx);
    else if (type === 'next') result = game.nextHandReset(room);
    else result = { ok: false, error: 'Неизвестное действие.' };

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

  socket.on('table:leave', (cb) => {
    const meta = socketMeta.get(socket.id);
    const room = meta && rooms.get(meta.roomCode);
    if (room) {
      const idx = room.seats.findIndex(s => s && s.username === socket.username);
      if (idx >= 0) cashOutSeat(room, idx);
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
