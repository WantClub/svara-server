// ===================== MINES (сапёр клеток) =====================
// Игрок выбирает размер поля и число мин, открывает клетки одну за одной.
// Каждая безопасная клетка поднимает множитель; в любой момент можно
// забрать выигрыш. Попадание на мину — раздача проиграна, ставка уже списана.
//
// Честность: позиции мин определяются СЕРВЕРОМ в момент старта и никогда
// не передаются клиенту заранее — только те клетки, которые игрок реально
// открыл. Множитель считается по формуле честной вероятности (см. ниже),
// с фиксированной "комиссией" клуба ~8% (то есть отдача ~92%, как и у слотов).

const HOUSE_EDGE = 0.08; // отдача ~92%
const MIN_GRID = 9;   // 3x3
const MAX_GRID = 36;  // 6x6

// Простая проверка допустимости размера поля/числа мин.
function validSetup(gridSize, minesCount) {
  if (!Number.isInteger(gridSize) || gridSize < MIN_GRID || gridSize > MAX_GRID) return false;
  if (!Number.isInteger(minesCount) || minesCount < 1 || minesCount >= gridSize) return false;
  return true;
}

function pickMinePositions(gridSize, minesCount) {
  const all = Array.from({ length: gridSize }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return new Set(all.slice(0, minesCount));
}

// Честный множитель после k успешных открытий (гипергеометрическая
// вероятность выжить k раз подряд), домноженный на (1 - HOUSE_EDGE).
function multiplierAfter(gridSize, minesCount, revealedCount) {
  let survivalProb = 1;
  for (let i = 0; i < revealedCount; i++) {
    survivalProb *= (gridSize - minesCount - i) / (gridSize - i);
  }
  const fairMultiplier = 1 / survivalProb;
  return Math.round(fairMultiplier * (1 - HOUSE_EDGE) * 100) / 100;
}

function createRound(bet, gridSize, minesCount) {
  return {
    bet,
    gridSize,
    minesCount,
    mines: pickMinePositions(gridSize, minesCount),
    revealed: new Set(),
    startedAt: Date.now(),
    active: true
  };
}

// Открыть клетку. Возвращает { ok, hitMine, multiplier, payout } либо { ok:false, error }.
function revealTile(round, tileIndex) {
  if (!round || !round.active) return { ok: false, error: 'Раунд уже завершён.' };
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= round.gridSize) {
    return { ok: false, error: 'Некорректная клетка.' };
  }
  if (round.revealed.has(tileIndex)) return { ok: false, error: 'Эта клетка уже открыта.' };

  if (round.mines.has(tileIndex)) {
    round.active = false;
    return { ok: true, hitMine: true, multiplier: 0, payout: 0 };
  }

  round.revealed.add(tileIndex);
  const multiplier = multiplierAfter(round.gridSize, round.minesCount, round.revealed.size);
  const allSafeOpened = round.revealed.size === (round.gridSize - round.minesCount);
  if (allSafeOpened) round.active = false; // открыл все безопасные клетки — раунд завершается автоматически
  return {
    ok: true,
    hitMine: false,
    multiplier,
    payout: Math.round(round.bet * multiplier),
    allSafeOpened
  };
}

function cashOut(round) {
  if (!round || !round.active) return { ok: false, error: 'Раунд уже завершён.' };
  if (round.revealed.size === 0) return { ok: false, error: 'Откройте хотя бы одну клетку перед тем, как забрать выигрыш.' };
  const multiplier = multiplierAfter(round.gridSize, round.minesCount, round.revealed.size);
  round.active = false;
  return { ok: true, multiplier, payout: Math.round(round.bet * multiplier) };
}

module.exports = { HOUSE_EDGE, MIN_GRID, MAX_GRID, validSetup, createRound, revealTile, cashOut, multiplierAfter };
