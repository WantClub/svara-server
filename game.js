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
  const vals = ranks.map(r => RANK_VALUE[r]).sort((a, b) => b - a);

  // "Свара!" — особая категория, всегда старше всего остального, независимо
  // от очков. В этом клубе это ИМЕННО три туза, а не любая тройка одинаковых
  // карт — тройка из любых других карт (дамы, валеты и т.д.) особого статуса
  // не имеет и сравнивается по очкам вместе со всеми остальными руками.
  if (ranks.every(r => r === 'A')) return [1, vals[0]];

  // Всё остальное (в том числе тройка НЕ из тузов, флеш, пара, старшая
  // карта) НЕ имеет иерархии между собой — побеждают просто набранные очки
  // (та же формула, что видит игрок). Если очки равны — это честная ничья
  // (банк делится пополам/поровну), поэтому здесь НЕТ дополнительного
  // сравнения по конкретным картам как запасного критерия.
  return [0, handPoints(hand)];
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
  // Настоящее правило Свары: в очки идут только карты общей (самой
  // многочисленной) масти. Если все три карты одной масти — суммируются
  // все три. Если только две совпадают мастью — третья (одиночная) карта
  // в очки не идёт вообще. Если все три карты разных мастей — считается
  // только одна старшая карта.
  const bySuit = {};
  hand.forEach(c => { (bySuit[c.s] = bySuit[c.s] || []).push(c); });
  const groups = Object.values(bySuit).sort((a, b) => b.length - a.length);
  const top = groups[0];
  if (top.length >= 2) {
    return top.reduce((sum, c) => sum + (POINTS[c.r] || 0), 0);
  }
  return Math.max(...hand.map(c => POINTS[c.r] || 0));
}

function handCategoryName(hand) {
  const ranks = hand.map(c => c.r);
  const suits = hand.map(c => c.s);
  // "Свара!" — именно три туза, а не любая тройка одинаковых карт.
  if (ranks.every(r => r === 'A')) return "Тройка (свара!)";
  if (new Set(suits).size === 1) return "Флеш";
  const counts = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
  if (Object.values(counts).includes(2) || Object.values(counts).includes(3)) return "Пара";
  return "Старшая карта";
}

function describeHand(hand) {
  return `${handCategoryName(hand)} · ${handPoints(hand)}`;
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
    // Игроку, у которого уже 0 фишек (полный ва-банк), больше нечем ходить —
    // ему не должны передавать ход вообще, как и в настоящем покере.
    if (s && s.inHand && !s.folded && s.chips > 0) return i;
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
  let potTotal = 0;
  seated.forEach(i => {
    const s = room.seats[i];
    s.hand = [deck.pop(), deck.pop(), deck.pop()];
    s.folded = false;
    s.inHand = true;
    // Анте не должно уводить игрока в минус — если фишек меньше, чем анте
    // (сидел с остатком после прошлой раздачи), списываем ровно столько,
    // сколько у него реально есть, и это сразу считается его ва-банком.
    const ante = Math.min(room.betUnit, s.chips);
    s.betThisRound = ante;
    s.hasActed = false;
    s.chips -= ante;
    potTotal += ante;
  });
  room.pot = potTotal;
  room.currentHighBet = room.betUnit;
  room.phase = 'betting';
  room.handNumber += 1;
  room.lastWinner = null;
  room.dealerIndex = seated[room.handNumber % seated.length];
  room.turnIndex = nextActiveIndex(room, room.dealerIndex);
  room.log.push(`— Раздача №${room.handNumber}. Анте ${room.betUnit} с каждого, банк ${room.pot}. —`);
  // Редкий, но реальный краевой случай: если у ВСЕХ участников фишек хватило
  // ровно на анте (все сразу ушли в ва-банк с нуля) — ходить некому вообще
  // (turnIndex будет null), и без этой проверки раздача зависла бы намертво
  // сразу после раздачи карт. Сразу проверяем — если ходить действительно
  // некому, переходим прямо к вскрытию карт.
  resolveIfDone(room);
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

  // Игрок, ушедший ва-банк (фишки закончились в процессе торговли), физически
  // не может доплатить до текущей высокой ставки — его ставка навсегда
  // останется ниже. Раньше это блокировало завершение раздачи навечно: код
  // ждал точного совпадения ставок у всех, а у игрока с 0 фишек оно просто
  // никогда не наступит. Теперь считаем такого игрока "сделавшим всё, что мог".
  //
  // ВАЖНО: если у игрока 0 фишек — этого одного достаточно, ЧТО БЫ НИ БЫЛО
  // с флагом "уже ходил". Если фишки закончились прямо на анте (до первого
  // собственного хода), а хода ему больше не дают (см. nextActiveIndex) —
  // hasActed так и останется false навсегда, и это НЕ должно вечно блокировать
  // раздачу. У игрока с 0 фишек в принципе нечего больше решать.
  const allMatched = active.every(i => {
    const seat = room.seats[i];
    if (seat.chips <= 0) return true;
    return seat.hasActed && seat.betThisRound === room.currentHighBet;
  });
  if (allMatched) {
    let bestScore = null, winners = [];
    active.forEach(i => {
      const sc = evaluateHand(room.seats[i].hand);
      if (bestScore === null || compareScores(sc, bestScore) > 0) { bestScore = sc; winners = [i]; }
      else if (compareScores(sc, bestScore) === 0) winners.push(i);
    });
    // Делим банк поровну между победителями (при ничьей). Если банк не
    // делится нацело — остаток раньше просто "исчезал" (терялся при
    // округлении вниз). Теперь раздаём остаток по одной фишке первым
    // победителям по очереди, чтобы ни одна фишка банка не пропадала.
    const share = Math.floor(room.pot / winners.length);
    const remainder = room.pot - share * winners.length;
    winners.forEach((i, idx) => {
      room.seats[i].chips += share + (idx < remainder ? 1 : 0);
    });
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
  const oldHighBet = room.currentHighBet;
  // Игрок может поднять на любую сумму от своего желания — минимум один анте (betUnit).
  const parsedAmount = parseInt(raiseAmount);
  const raiseBy = Number.isFinite(parsedAmount) && parsedAmount > 0 ? Math.max(parsedAmount, room.betUnit) : room.betUnit;
  const newHigh = room.currentHighBet + raiseBy;
  const need = newHigh - s.betThisRound;
  const pay = Math.min(need, s.chips);
  s.chips -= pay; s.betThisRound += pay; room.pot += pay;
  // Общая "высокая ставка" стола не должна никогда УМЕНЬШАТЬСЯ — а именно
  // это раньше и происходило, если у поднимающего не хватало фишек даже
  // на то, чтобы сравнять существующую ставку (пытался "поднять", по факту
  // идя ва-банк меньшей суммой). Раньше эта строка безусловно перезаписывала
  // currentHighBet итоговой (заниженной) ставкой игрока, "ломая" уже
  // корректно сравнявшихся соперников и заставляя раздачу зависать/кружить
  // между игроками бесконечно.
  room.currentHighBet = Math.max(room.currentHighBet, s.betThisRound);
  s.hasActed = true;
  // КЛЮЧЕВОЙ МОМЕНТ: если у игрока не хватило фишек и его "подъём" по факту
  // НЕ превысил уже существующую ставку (просто ва-банк вровень или ниже) —
  // это НЕ настоящий подъём, а обычный call. Раньше в этом случае всё равно
  // сбрасывалась отметка "уже походил" у всех остальных — из-за этого
  // игрока, у которого не хватало фишек на реальный подъём, каждый его
  // клик "Поднять" заново заставлял всех отвечать, хотя по факту ничего не
  // менялось — отсюда и бесконечное хождение по кругу с одинаковой ставкой.
  const isGenuineRaise = room.currentHighBet > oldHighBet;
  if (isGenuineRaise) {
    seatedIndices(room).forEach(i => {
      if (i !== seatIdx && room.seats[i].inHand && !room.seats[i].folded && room.seats[i].chips > 0) {
        room.seats[i].hasActed = false;
      }
    });
    room.log.push(`${s.username}: поднимает до ${room.currentHighBet}.`);
  } else {
    room.log.push(`${s.username}: идёт ва-банк (${s.betThisRound}) — фишек на реальный подъём не хватило.`);
  }
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
function redactForViewer(room, viewerUsername, viewerIsAdmin) {
  const seats = room.seats.map(s => {
    if (!s) return null;
    const isMe = s.username === viewerUsername;
    // Администратору клуба карты видны всегда — и в наблюдении, и когда он
    // сам сидит за столом и играет (полный контроль владельца заведения).
    const reveal = isMe || !!viewerIsAdmin || (room.phase === 'handEnd' && !s.folded);
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
    lastWinner: room.lastWinner, lastPotSize: room.lastPotSize || 0, log: room.log.slice(-16),
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
  nextHandReset, redactForViewer, fullStateForAdmin, resolveIfDone
};
