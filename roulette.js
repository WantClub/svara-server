// ===================== РУЛЕТКА (европейская, 0-36) =====================
// Взято за основу из предоставленного демо-модуля, честность подтверждена:
// стандартные выплаты (прямое число 35:1, красное/чёрное/чёт/нечет/1-18/19-36
// 1:1, дюжины 2:1) — математическая отдача ~97.3%, как у настоящей рулетки
// с одним зелёным сектором. Результат теперь определяет ИСКЛЮЧИТЕЛЬНО сервер
// (Math.random() на клиенте убран полностью) — иначе клиент мог бы подделать
// результат до отправки ставки.

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const MAX_BETS_PER_SPIN = 20; // разумный предел, чтобы не засыпать сервер тысячей ставок за раз

function color(n) {
  return n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
}

function spinWheel() {
  return Math.floor(Math.random() * 37); // 0..36, честно и равновероятно
}

// Возвращает множитель ОБЩЕГО возврата (не чистого выигрыша) — то есть
// 36 для прямого числа означает "вернуть все поставленные фишки, умноженные
// на 36", что при ставке amount даёt чистую прибыль +35×amount, ровно как
// в настоящей рулетке (выплата "35:1").
function betMultiplier(bet, n) {
  if (bet.type === 'number') return bet.value === n ? 36 : 0;
  if (n === 0) return 0; // зелёный "0" не выигрывает ни у одной "внешней" ставки
  const v = bet.value;
  if (v === 'low' && n <= 18) return 2;
  if (v === 'high' && n >= 19) return 2;
  if (v === 'even' && n % 2 === 0) return 2;
  if (v === 'odd' && n % 2 === 1) return 2;
  if (v === 'red' && RED.has(n)) return 2;
  if (v === 'black' && !RED.has(n)) return 2;
  if (v === 'd1' && n <= 12) return 3;
  if (v === 'd2' && n >= 13 && n <= 24) return 3;
  if (v === 'd3' && n >= 25) return 3;
  return 0;
}

function validateBet(bet) {
  if (!bet || typeof bet !== 'object') return false;
  const amt = parseInt(bet.amount);
  if (!Number.isFinite(amt) || amt <= 0) return false;
  if (bet.type === 'number') {
    const v = parseInt(bet.value);
    return Number.isInteger(v) && v >= 0 && v <= 36;
  }
  if (bet.type === 'outside') {
    return ['low', 'high', 'even', 'odd', 'red', 'black', 'd1', 'd2', 'd3'].includes(bet.value);
  }
  return false;
}

// Разыгрывает спин по уже провалидированному списку ставок [{type,value,amount}].
// Возвращает { number, color, totalStake, totalPayout }.
function playSpin(bets) {
  const n = spinWheel();
  let totalPayout = 0;
  bets.forEach(bet => {
    const amt = parseInt(bet.amount);
    totalPayout += Math.round(amt * betMultiplier(bet, n));
  });
  const totalStake = bets.reduce((s, b) => s + parseInt(b.amount), 0);
  return { number: n, color: color(n), totalStake, totalPayout };
}

module.exports = { RED, MAX_BETS_PER_SPIN, color, spinWheel, betMultiplier, validateBet, playSpin };
