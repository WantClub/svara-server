// ===================== ТУРНИРЫ =====================
// Турнир объединяет несколько обычных покерных столов (из game.js) в одно
// событие: все участники стартуют с одинаковым турнирным стеком фишек
// (не связанным напрямую с их кошельком), играют до выбывания, а призовой
// фонд в конце распределяется по итоговым местам.
//
// Архитектура специально сделана так, чтобы столов могло быть МНОГО (не
// один жёстко заданный стол на 6 человек) — при регистрации от единиц до
// тысяч человек турнир просто создаёт нужное количество 6-местных столов
// и потом постепенно "сливает" их по мере выбывания игроков.

const TABLE_SEATS = 6; // размер одного турнирного стола (как и у обычных столов)
const STARTING_STACK = 1000; // стартовый турнирный стек — одинаковый у всех, не связан с кошельком
const ANTE_LEVELS = [10, 20, 40, 80, 160, 320, 640]; // анте растёт со временем, чтобы турнир не длился вечно
const ANTE_LEVEL_UP_MS = 8 * 60 * 1000; // повышение анте каждые 8 минут

function createTournament(id, { name, maxPlayers, entryFee, prizePool, mode, createdBy }) {
  return {
    id, name, maxPlayers, entryFee, prizePool, mode: mode || 'bonus', createdBy,
    status: 'registering', // registering | running | finished
    players: [], // [{username}] — до старта
    tables: new Map(), // tableId -> { seats: [{username, chips, out}], anteLevelIdx }
    eliminationOrder: [], // username в порядке выбывания (последний = победитель)
    anteLevelIdx: 0,
    anteLevelStartedAt: null,
    createdAt: Date.now()
  };
}

function canRegister(tournament) {
  return tournament.status === 'registering' && tournament.players.length < tournament.maxPlayers;
}

function registerPlayer(tournament, username) {
  if (tournament.status !== 'registering') return { ok: false, error: 'Регистрация на этот турнир уже закрыта.' };
  if (tournament.players.some(p => p.username === username)) return { ok: false, error: 'Вы уже зарегистрированы в этом турнире.' };
  if (tournament.players.length >= tournament.maxPlayers) return { ok: false, error: 'Турнир уже набрал максимум участников.' };
  tournament.players.push({ username });
  return { ok: true };
}

function unregisterPlayer(tournament, username) {
  if (tournament.status !== 'registering') return { ok: false, error: 'Турнир уже начался — выйти из регистрации нельзя.' };
  const idx = tournament.players.findIndex(p => p.username === username);
  if (idx < 0) return { ok: false, error: 'Вы не зарегистрированы в этом турнире.' };
  tournament.players.splice(idx, 1);
  return { ok: true };
}

// Распределяет зарегистрированных игроков по нужному числу столов
// (по TABLE_SEATS человек на стол). Возвращает массив групп имён —
// server.js по каждой группе создаст настоящий покерный стол (room).
function splitIntoTables(tournament) {
  const usernames = tournament.players.map(p => p.username);
  // Перемешиваем, чтобы рассадка была случайной, а не по порядку регистрации.
  for (let i = usernames.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [usernames[i], usernames[j]] = [usernames[j], usernames[i]];
  }
  const groups = [];
  for (let i = 0; i < usernames.length; i += TABLE_SEATS) {
    groups.push(usernames.slice(i, i + TABLE_SEATS));
  }
  return groups;
}

function currentAnte(tournament) {
  return ANTE_LEVELS[Math.min(tournament.anteLevelIdx, ANTE_LEVELS.length - 1)];
}

// Проверяет, не пора ли поднять анте (вызывается периодически).
function maybeLevelUpAnte(tournament) {
  if (!tournament.anteLevelStartedAt) return false;
  if (Date.now() - tournament.anteLevelStartedAt < ANTE_LEVEL_UP_MS) return false;
  if (tournament.anteLevelIdx >= ANTE_LEVELS.length - 1) return false;
  tournament.anteLevelIdx++;
  tournament.anteLevelStartedAt = Date.now();
  return true;
}

// Считает призовые по итоговому порядку выбывания. Первым в списке мест —
// победитель (последний, кто остался). Простая и понятная структура:
// на троих и более призовых мест — 50/30/20% от фонда, на двоих — 65/35%,
// на одного — 100%.
function computePrizes(tournament) {
  const standings = tournament.eliminationOrder.slice().reverse(); // победитель первым
  const placesPaid = Math.min(3, standings.length);
  const split = placesPaid === 1 ? [1] : placesPaid === 2 ? [0.65, 0.35] : [0.5, 0.3, 0.2];
  const results = standings.map((username, idx) => {
    const prize = idx < placesPaid ? Math.round(tournament.prizePool * split[idx]) : 0;
    return { username, placement: idx + 1, prize };
  });
  return results;
}

module.exports = {
  TABLE_SEATS, STARTING_STACK, ANTE_LEVELS, ANTE_LEVEL_UP_MS,
  createTournament, canRegister, registerPlayer, unregisterPlayer,
  splitIntoTables, currentAnte, maybeLevelUpAnte, computePrizes
};
