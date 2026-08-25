// ===================== КАРТОЧНАЯ ЛОГИКА (Свара) =====================
const RANKS = ["6","7","8","9","10","J","Q","K","A"];
const SUITS = ["♠","♥","♦","♣"];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const POINTS = { "6":6,"7":7,"8":8,"9":9,"10":10,"J":10,"Q":10,"K":10,"A":11 };

function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function evaluateHand(hand) {
  const ranks = hand.map(c => c.r);
  const suits = hand.map(c => c.s);
  const vals = ranks.map(r => RANK_VALUE[r]).sort((a, b) => b - a);

  if (new Set(ranks).size === 1) return [3, vals[0]];
  if (new Set(suits).size === 1) {
    const pts = ranks.reduce((a, r) => a + POINTS[r], 0);
    return [2, pts, ...vals];
  }
  const counts = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
  const pairRank = Object.keys(counts).find(r => counts[r] === 2);
  if (pairRank) {
    const pv = RANK_VALUE[pairRank];
    const kicker = vals.find(v => v !== pv);
    return [1, pv, kicker];
  }
  return [0, ...vals];
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] === undefined ? -1 : a[i];
    const bv = b[i] === undefined ? -1 : b[i];
    if (av !== bv) return av - bv;
  }
  return 0;
}

function handPoints(hand) {
  return hand.reduce((sum, c) => sum + (POINTS[c.r] || 0), 0);
}

function describeHand(hand) {
  const cat = evaluateHand(hand)[0];
  const name = { 3: "Тройка (свара!)", 2: "Флеш", 1: "Пара", 0: "Старшая карта" }[cat];
  return `${name} · ${handPoints(hand)}`;
}

// ===================== СОСТОЯНИЕ СТОЛА =====================
function emptySeats(n) {
  return Array.from({ length: n }, () => null);
}

function createRoom(code, betUnit, hostUsername, maxSeats) {
  const n = [2, 3, 4, 5, 6].includes(maxSeats) ? maxSeats : 6;
  return {
    code, betUnit, hostName: hostUsername, maxSeats: n,
    seats: emptySeats(n),
    phase: 'lobby', // lobby | betting | handEnd
    pot: 0, currentHighBet: 0, turnIndex: null, dealerIndex: 0,
    handNumber: 0, lastWinner: null,
    log: [`Стол создан игроком ${hostUsername}.`]
  };
}

function seatedIndices(room) {
  return room.seats.map((s, i) => s ? i : null).filter(i => i !== null);
}

function nextActiveIndex(room, fromIdx) {
  const n = room.seats.length;
  let i = fromIdx;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    const s = room.seats[i];
    if (s && s.inHand && !s.folded) return i;
  }
  return null;
}

function dealHand(room) {
  if (room.phase !== 'lobby') return { ok: false, error: 'Раздача уже идёт.' };
  const seated = seatedIndices(room).filter(i => room.seats[i].chips > 0);
  if (seated.length < 2) return { ok: false, error: 'Нужно минимум 2 игрока с фишками.' };

  // Запоминаем фишки каждого участника ДО анте — нужно для истории раздач
  // (чтобы честно посчитать, выиграл игрок эту раздачу или проиграл).
  room.handStartChips = {};
  seated.forEach(i => { room.handStartChips[room.seats[i].username] = room.seats[i].chips; });

  const deck = newDeck();
  seated.forEach(i => {
    const s = room.seats[i];
    s.hand = [deck.pop(), deck.pop(), deck.pop()];
    s.folded = false;
    s.inHand = true;
    s.betThisRound = room.betUnit;
    s.hasActed = false;
    s.chips -= room.betUnit;
  });
  room.pot = seated.length * room.betUnit;
  room.currentHighBet = room.betUnit;
  room.phase = 'betting';
  room.handNumber += 1;
  room.lastWinner = null;
  room.dealerIndex = seated[room.handNumber % seated.length];
  room.turnIndex = nextActiveIndex(room, room.dealerIndex);
  room.log.push(`— Раздача №${room.handNumber}. Анте ${room.betUnit} с каждого, банк ${room.pot}. —`);
  return { ok: true };
}

function resolveIfDone(room) {
  const active = seatedIndices(room).filter(i => room.seats[i].inHand && !room.seats[i].folded);

  if (active.length === 1) {
    const w = room.seats[active[0]];
    w.chips += room.pot;
    room.log.push(`${w.username} забирает банк ${room.pot} — все остальные спасовали.`);
    room.phase = 'handEnd';
    room.lastWinner = [w.username];
    room.lastPotSize = room.pot;
    room.pot = 0;
    return;
  }

  const allMatched = active.every(i => room.seats[i].hasActed && room.seats[i].betThisRound === room.currentHighBet);
  if (allMatched) {
    let bestScore = null, winners = [];
    active.forEach(i => {
      const sc = evaluateHand(room.seats[i].hand);
      if (bestScore === null || compareScores(sc, bestScore) > 0) { bestScore = sc; winners = [i]; }
      else if (compareScores(sc, bestScore) === 0) winners.push(i);
    });
    const share = Math.floor(room.pot / winners.length);
    winners.forEach(i => room.seats[i].chips += share);
    room.lastWinner = winners.map(i => room.seats[i].username);
    room.log.push(`Вскрытие: ${active.map(i => `${room.seats[i].username} — ${describeHand(room.seats[i].hand)}`).join('; ')}.`);
    room.log.push(`Банк ${room.pot} забирает: ${room.lastWinner.join(', ')}.`);
    room.phase = 'handEnd';
    room.lastPotSize = room.pot;
    room.pot = 0;
    return;
  }

  room.turnIndex = nextActiveIndex(room, room.turnIndex);
}

function actCall(room, seatIdx) {
  if (room.phase !== 'betting') return { ok: false, error: 'Сейчас не время торговли.' };
  if (room.turnIndex !== seatIdx) return { ok: false, error: 'Сейчас не ваш ход.' };
  const s = room.seats[seatIdx];
  const need = room.currentHighBet - s.betThisRound;
  if (need > 0) {
    const pay = Math.min(need, s.chips);
    s.chips -= pay; s.betThisRound += pay; room.pot += pay;
  }
  s.hasActed = true;
  room.log.push(`${s.username}: играет (уравнивает ${room.currentHighBet}).`);
  resolveIfDone(room);
  return { ok: true };
}

function actRaise(room, seatIdx, raiseAmount) {
  if (room.phase !== 'betting') return { ok: false, error: 'Сейчас не время торговли.' };
  if (room.turnIndex !== seatIdx) return { ok: false, error: 'Сейчас не ваш ход.' };
  const s = room.seats[seatIdx];
  // Игрок может поднять на любую сумму от своего желания — минимум один анте (betUnit).
  const parsedAmount = parseInt(raiseAmount);
  const raiseBy = Number.isFinite(parsedAmount) && parsedAmount > 0 ? Math.max(parsedAmount, room.betUnit) : room.betUnit;
  const newHigh = room.currentHighBet + raiseBy;
  const need = newHigh - s.betThisRound;
  const pay = Math.min(need, s.chips);
  s.chips -= pay; s.betThisRound += pay; room.pot += pay;
  room.currentHighBet = s.betThisRound;
  s.hasActed = true;
  seatedIndices(room).forEach(i => {
    if (i !== seatIdx && room.seats[i].inHand && !room.seats[i].folded) room.seats[i].hasActed = false;
  });
  room.log.push(`${s.username}: поднимает до ${room.currentHighBet}.`);
  resolveIfDone(room);
  return { ok: true };
}

function actFold(room, seatIdx) {
  if (room.phase !== 'betting') return { ok: false, error: 'Сейчас не время торговли.' };
  if (room.turnIndex !== seatIdx) return { ok: false, error: 'Сейчас не ваш ход.' };
  const s = room.seats[seatIdx];
  s.folded = true; s.inHand = false; s.hasActed = true;
  room.log.push(`${s.username}: пас.`);
  resolveIfDone(room);
  return { ok: true };
}

function nextHandReset(room) {
  if (room.phase !== 'handEnd') return { ok: false, error: 'Раздача ещё не завершена.' };
  room.seats.forEach(s => {
    if (s) { s.hand = []; s.folded = false; s.inHand = false; s.betThisRound = 0; s.hasActed = false; }
  });
  room.phase = 'lobby';
  room.currentHighBet = 0;
  room.lastWinner = null;
  return { ok: true };
}

// Урезанная версия состояния для конкретного зрителя: чужие карты скрыты,
// кроме момента вскрытия (handEnd) для тех, кто не сбросил карты.
function redactForViewer(room, viewerUsername) {
  const seats = room.seats.map(s => {
    if (!s) return null;
    const isMe = s.username === viewerUsername;
    const reveal = isMe || (room.phase === 'handEnd' && !s.folded);
    return {
      username: s.username,
      avatar: s.avatar || null,
      chips: s.chips,
      folded: s.folded,
      inHand: s.inHand,
      betThisRound: s.betThisRound,
      hand: (s.inHand && s.hand.length) ? (reveal ? s.hand : s.hand.map(() => null)) : []
    };
  });
  return {
    code: room.code, betUnit: room.betUnit, hostName: room.hostName, maxSeats: room.maxSeats || room.seats.length,
    seats, phase: room.phase, pot: room.pot, currentHighBet: room.currentHighBet,
    turnIndex: room.turnIndex, handNumber: room.handNumber,
    lastWinner: room.lastWinner, log: room.log.slice(-16),
    turnDeadline: room.turnDeadline || null
  };
}

// Полное состояние без сокрытия карт — только для администратора-наблюдателя.
function fullStateForAdmin(room) {
  const seats = room.seats.map(s => {
    if (!s) return null;
    return {
      username: s.username, avatar: s.avatar || null, chips: s.chips, folded: s.folded,
      inHand: s.inHand, betThisRound: s.betThisRound, hand: s.hand || []
    };
  });
  return {
    code: room.code, betUnit: room.betUnit, hostName: room.hostName, maxSeats: room.maxSeats || room.seats.length,
    seats, phase: room.phase, pot: room.pot, currentHighBet: room.currentHighBet,
    turnIndex: room.turnIndex, handNumber: room.handNumber,
    lastWinner: room.lastWinner, log: room.log.slice(-30)
  };
}

module.exports = {
  RANKS, SUITS, evaluateHand, compareScores, describeHand, newDeck,
  createRoom, seatedIndices, nextActiveIndex, dealHand, actCall, actRaise, actFold,
  nextHandReset, redactForViewer, fullStateForAdmin
};
