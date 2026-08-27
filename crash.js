// ===================== CRASH (Авиатор) =====================
// Множитель растёт со временем по формуле сервера; игрок должен успеть
// "забрать" ставку до момента краха. Момент краха определяется СЕРВЕРОМ
// в момент старта раунда и никогда не передаётся клиенту заранее —
// клиент лишь показывает нарастающий множитель, а решает, выиграл игрок
// или нет, всегда сервер, по реальному времени.

const HOUSE_EDGE = 0.08; // отдача ~92%, как и у остальных игр клуба
const GROWTH_RATE = 0.18; // скорость роста множителя (подобрано на глаз для приятного темпа)
const MAX_ROUND_MS = 25000; // не даём раунду висеть в памяти вечно

// Множитель в момент времени t (секунды с начала раунда).
function multiplierAtTime(elapsedSeconds) {
  return Math.exp(elapsedSeconds * GROWTH_RATE);
}

// Честная точка краха: распределение с "тяжёлым хвостом", как в реальных
// crash-играх — большинство раундов рушится рано, изредка встречаются
// крупные множители. HOUSE_EDGE даёт клубу отдачу ~92% в среднем.
function generateCrashPoint() {
  const r = Math.random();
  if (r < HOUSE_EDGE) return 1.00; // мгновенный крах — это и есть "комиссия" клуба
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.max(1.00, Math.floor(raw * 100) / 100);
}

function createRound(bet) {
  return {
    bet,
    crashPoint: generateCrashPoint(),
    startedAt: Date.now(),
    resolved: false
  };
}

function currentMultiplier(round) {
  const elapsed = (Date.now() - round.startedAt) / 1000;
  return Math.round(multiplierAtTime(elapsed) * 100) / 100;
}

// Игрок нажал "забрать". Возвращает { ok, crashed, multiplier, payout }.
function cashOut(round) {
  if (!round || round.resolved) return { ok: false, error: 'Раунд уже завершён.' };
  const elapsed = (Date.now() - round.startedAt) / 1000;
  const liveMultiplier = multiplierAtTime(elapsed);
  round.resolved = true;
  if (liveMultiplier >= round.crashPoint) {
    // К моменту нажатия кнопки крах уже произошёл.
    return { ok: true, crashed: true, crashPoint: round.crashPoint, payout: 0 };
  }
  const multiplier = Math.round(liveMultiplier * 100) / 100;
  return { ok: true, crashed: false, multiplier, payout: Math.round(round.bet * multiplier) };
}

// Раунд считается "просроченным", если игрок ни разу не забрал выигрыш
// и прошло больше MAX_ROUND_MS — чистим память, засчитываем проигрыш
// (ставка и так уже была списана при старте).
function isExpired(round) {
  return Date.now() - round.startedAt > MAX_ROUND_MS;
}

module.exports = { HOUSE_EDGE, GROWTH_RATE, MAX_ROUND_MS, createRound, currentMultiplier, cashOut, isExpired, generateCrashPoint, multiplierAtTime };
