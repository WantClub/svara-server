// ===================== СЛОТЫ (только фишки клуба, без реальных денег) =====================
// Веса и таблица выплат — ОДНИ И ТЕ ЖЕ для всех тематик (проверено
// симуляцией: отдача ~91%, как в обычном игровом автомате). Меняются
// только сами картинки-символы и название темы.
const PAYTABLE = [
  { weight: 35, pay3: 5 },
  { weight: 28, pay3: 8 },
  { weight: 18, pay3: 15 },
  { weight: 11, pay3: 35 },
  { weight: 6,  pay3: 70 },
  { weight: 2,  pay3: 150 },
];
const TOTAL_WEIGHT = PAYTABLE.reduce((a, s) => a + s.weight, 0); // = 100

const MACHINES = {
  fruits:    { name: 'Фрукты Classic',    symbols: ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'] },
  egypt:     { name: 'Золото Египта',     symbols: ['🐫', '🏺', '🔺', '👁️', '👑', '💰'] },
  space:     { name: 'Космо Джекпот',     symbols: ['🌟', '🌙', '🚀', '🪐', '🛸', '👽'] },
  ocean:     { name: 'Глубина Океана',    symbols: ['🐚', '🐟', '🦀', '⚓', '🧜‍♀️', '🦪'] },
  gold:      { name: 'Золотая Лихорадка', symbols: ['🪨', '⛏️', '🐴', '🚂', '👑', '🪙'] },
  halloween: { name: 'Хэллоуин',          symbols: ['🕷️', '👻', '🦇', '🌙', '🎃', '💀'] },
  jungle:    { name: 'Джунгли',           symbols: ['🌴', '🐒', '🦜', '🐘', '🐯', '🦁'] },
  music:     { name: 'Рок-н-Ролл',        symbols: ['🎵', '🎧', '💿', '🎹', '🎤', '🎸'] },
  dragons:   { name: 'Драконы и Магия',   symbols: ['🛡️', '⚔️', '🏰', '🔮', '🧙', '🐉'] },
  wildwest:  { name: 'Дикий Запад',       symbols: ['🌵', '🐎', '🤠', '⭐', '🔫', '💰' ] },
  slot1: { name: 'Дикий Клуб', symbols: ['🐶', '🐼', '🐵', '🐺', '🐌', '🦐'] },
  slot2: { name: 'Огненный Клуб', symbols: ['🐮', '🦅', '🐝', '🦎', '🐬', '🦧'] },
  slot3: { name: 'Лунный Клуб', symbols: ['🐗', '🐞', '🦞', '🐆', '🐪', '🐑'] },
  slot4: { name: 'Золотой Клуб', symbols: ['🐙', '🐳', '🐘', '🐄', '🍏', '🫐'] },
  slot5: { name: 'Серебряный Клуб', symbols: ['🦓', '🐫', '🐐', '🍉', '🍍', '🌽'] },
  slot6: { name: 'Тайный Клуб', symbols: ['🐎', '🍊', '🍒', '🥑', '🧀', '🍪'] },
  slot7: { name: 'Древний Клуб', symbols: ['🍇', '🥥', '🍞', '🍟', '🍭', '🏀'] },
  slot8: { name: 'Магический Клуб', symbols: ['🥦', '🍔', '🎂', '🍨', '🏐', '🎯'] },
  slot9: { name: 'Королевский Клуб', symbols: ['🍿', '🧁', '🏈', '🏸', '🃏', '🚓'] },
  slot10: { name: 'Небесный Клуб', symbols: ['🍯', '🏉', '🎳', '🚗', '✈️', '🛴'] },
  slot11: { name: 'Ледяной Клуб', symbols: ['🥊', '♠️', '🚑', '🚤', '🗿', '⚡'] },
  slot12: { name: 'Штормовой Клуб', symbols: ['🚕', '🛸', '🏍️', '🌛', '☀️', '🌸'] },
  slot13: { name: 'Изумрудный Клуб', symbols: ['🚂', '🏆', '🔥', '🌋', '💍', '🧿'] },
  slot14: { name: 'Рубиновый Клуб', symbols: ['🌟', '⛄', '🌺', '🕶️', '🎸', '💡'] },
  slot15: { name: 'Алмазный Клуб', symbols: ['🎆', '👑', '🗝️', '🎹', '🐭', '🐯'] },
  slot16: { name: 'Багровый Клуб', symbols: ['💼', '🥁', '⏰', '🐻', '🐸', '🦇'] },
  slot17: { name: 'Полночный Клуб', symbols: ['🎬', '🐹', '🦁', '🐦', '🦄', '🐍'] },
  slot18: { name: 'Звёздный Клуб', symbols: ['🐼', '🐵', '🐺', '🐌', '🦐', '🐊'] },
  slot19: { name: 'Быстрый Клуб', symbols: ['🦅', '🐝', '🦎', '🐬', '🦧', '🦘'] },
  slot20: { name: 'Счастливый Клуб', symbols: ['🐞', '🦞', '🐆', '🐪', '🐑', '🍌'] },
  slot21: { name: 'Дикий Джекпот', symbols: ['🐳', '🐘', '🐄', '🍏', '🫐', '🍅'] },
  slot22: { name: 'Огненный Джекпот', symbols: ['🐫', '🐐', '🍉', '🍍', '🌽', '🌮'] },
  slot23: { name: 'Лунный Джекпот', symbols: ['🍊', '🍒', '🥑', '🧀', '🍪', '🍦'] },
  slot24: { name: 'Золотой Джекпот', symbols: ['🥥', '🍞', '🍟', '🍭', '🏀', '🏓'] },
  slot25: { name: 'Серебряный Джекпот', symbols: ['🍔', '🎂', '🍨', '🏐', '🎯', '♦️'] },
  slot26: { name: 'Тайный Джекпот', symbols: ['🧁', '🏈', '🏸', '🃏', '🚓', '⛵'] },
  slot27: { name: 'Древний Джекпот', symbols: ['🏉', '🎳', '🚗', '✈️', '🛴', '🌝'] },
  slot28: { name: 'Магический Джекпот', symbols: ['♠️', '🚑', '🚤', '🗿', '⚡', '🌪️'] },
  slot29: { name: 'Королевский Джекпот', symbols: ['🛸', '🏍️', '🌛', '☀️', '🌸', '🎩'] },
  slot30: { name: 'Небесный Джекпот', symbols: ['🏆', '🔥', '🌋', '💍', '🧿', '🎻'] },
  slot31: { name: 'Ледяной Джекпот', symbols: ['⛄', '🌺', '🕶️', '🎸', '💡', '🦊'] },
  slot32: { name: 'Штормовой Джекпот', symbols: ['👑', '🗝️', '🎹', '🐭', '🐯', '🐧'] },
  slot33: { name: 'Изумрудный Джекпот', symbols: ['🥁', '⏰', '🐻', '🐸', '🦇', '🦋'] },
  slot34: { name: 'Рубиновый Джекпот', symbols: ['🐹', '🦁', '🐦', '🦄', '🐍', '🐠'] },
  slot35: { name: 'Алмазный Джекпот', symbols: ['🐵', '🐺', '🐌', '🦐', '🐊', '🦛'] },
  slot36: { name: 'Багровый Джекпот', symbols: ['🐝', '🦎', '🐬', '🦧', '🦘', '🍎'] },
  slot37: { name: 'Полночный Джекпот', symbols: ['🦞', '🐆', '🐪', '🐑', '🍌', '🥭'] },
  slot38: { name: 'Звёздный Джекпот', symbols: ['🐘', '🐄', '🍏', '🫐', '🍅', '🥨'] },
  slot39: { name: 'Быстрый Джекпот', symbols: ['🐐', '🍉', '🍍', '🌽', '🌮', '🍬'] },
  slot40: { name: 'Счастливый Джекпот', symbols: ['🍒', '🥑', '🧀', '🍪', '🍦', '🎾'] },
  slot41: { name: 'Дикий Улёт', symbols: ['🍞', '🍟', '🍭', '🏀', '🏓', '🎲'] },
  slot42: { name: 'Огненный Улёт', symbols: ['🎂', '🍨', '🏐', '🎯', '♦️', '🚀'] },
  slot43: { name: 'Лунный Улёт', symbols: ['🏈', '🏸', '🃏', '🚓', '⛵', '⚓'] },
  slot44: { name: 'Золотой Улёт', symbols: ['🎳', '🚗', '✈️', '🛴', '🌝', '🌈'] },
  slot45: { name: 'Серебряный Улёт', symbols: ['🚑', '🚤', '🗿', '⚡', '🌪️', '🌹'] },
  slot46: { name: 'Тайный Улёт', symbols: ['🏍️', '🌛', '☀️', '🌸', '🎩', '🎺'] },
  slot47: { name: 'Древний Улёт', symbols: ['🔥', '🌋', '💍', '🧿', '🎻', '🐱'] },
  slot48: { name: 'Магический Улёт', symbols: ['🌺', '🕶️', '🎸', '💡', '🦊', '🐷'] },
  slot49: { name: 'Королевский Улёт', symbols: ['🗝️', '🎹', '🐭', '🐯', '🐧', '🐴'] },
  slot50: { name: 'Небесный Улёт', symbols: ['⏰', '🐻', '🐸', '🦇', '🦋', '🦑'] },
  slot51: { name: 'Ледяной Улёт', symbols: ['🦁', '🐦', '🦄', '🐍', '🐠', '🦍'] },
  slot52: { name: 'Штормовой Улёт', symbols: ['🐺', '🐌', '🦐', '🐊', '🦛', '🐖'] },
  slot53: { name: 'Изумрудный Улёт', symbols: ['🦎', '🐬', '🦧', '🦘', '🍎', '🍓'] },
  slot54: { name: 'Рубиновый Улёт', symbols: ['🐆', '🐪', '🐑', '🍌', '🥭', '🌶️'] },
  slot55: { name: 'Алмазный Улёт', symbols: ['🐄', '🍏', '🫐', '🍅', '🥨', '🍩'] },
  slot56: { name: 'Багровый Улёт', symbols: ['🍉', '🍍', '🌽', '🌮', '🍬', '⚽'] },
  slot57: { name: 'Полночный Улёт', symbols: ['🥑', '🧀', '🍪', '🍦', '🎾', '🥋'] },
  slot58: { name: 'Звёздный Улёт', symbols: ['🍟', '🍭', '🏀', '🏓', '🎲', '🚙'] },
  slot59: { name: 'Быстрый Улёт', symbols: ['🍨', '🏐', '🎯', '♦️', '🚀', '🚲'] },
  slot60: { name: 'Счастливый Улёт', symbols: ['🏸', '🃏', '🚓', '⛵', '⚓', '✨'] },
  slot61: { name: 'Дикий Рай', symbols: ['🚗', '✈️', '🛴', '🌝', '🌈', '🎇'] },
  slot62: { name: 'Огненный Рай', symbols: ['🚤', '🗿', '⚡', '🌪️', '🌹', '🔮'] },
  slot63: { name: 'Лунный Рай', symbols: ['🌛', '☀️', '🌸', '🎩', '🎺', '📷'] },
  slot64: { name: 'Золотой Рай', symbols: ['🌋', '💍', '🧿', '🎻', '🐱', '🐨'] },
  slot65: { name: 'Серебряный Рай', symbols: ['🕶️', '🎸', '💡', '🦊', '🐷', '🦉'] },
  slot66: { name: 'Тайный Рай', symbols: ['🎹', '🐭', '🐯', '🐧', '🐴', '🐢'] },
  slot67: { name: 'Древний Рай', symbols: ['🐻', '🐸', '🦇', '🦋', '🦑', '🦈'] },
  slot68: { name: 'Магический Рай', symbols: ['🐦', '🦄', '🐍', '🐠', '🦍', '🦒'] },
  slot69: { name: 'Королевский Рай', symbols: ['🐌', '🦐', '🐊', '🦛', '🐖', '🍋'] },
  slot70: { name: 'Небесный Рай', symbols: ['🐬', '🦧', '🦘', '🍎', '🍓', '🥝'] },
  slot71: { name: 'Ледяной Рай', symbols: ['🐪', '🐑', '🍌', '🥭', '🌶️', '🍕'] },
  slot72: { name: 'Штормовой Рай', symbols: ['🍏', '🫐', '🍅', '🥨', '🍩', '🥧'] },
  slot73: { name: 'Изумрудный Рай', symbols: ['🍍', '🌽', '🌮', '🍬', '⚽', '🎱'] },
  slot74: { name: 'Рубиновый Рай', symbols: ['🧀', '🍪', '🍦', '🎾', '🥋', '♣️'] },
  slot75: { name: 'Алмазный Рай', symbols: ['🍭', '🏀', '🏓', '🎲', '🚙', '🚁'] },
  slot76: { name: 'Багровый Рай', symbols: ['🏐', '🎯', '♦️', '🚀', '🚲', '🌞'] },
  slot77: { name: 'Полночный Рай', symbols: ['🃏', '🚓', '⛵', '⚓', '✨', '🌊'] },
  slot78: { name: 'Звёздный Рай', symbols: ['✈️', '🛴', '🌝', '🌈', '🎇', '🔱'] },
  slot79: { name: 'Быстрый Рай', symbols: ['🗿', '⚡', '🌪️', '🌹', '🔮', '🎷'] },
  slot80: { name: 'Счастливый Рай', symbols: ['☀️', '🌸', '🎩', '🎺', '📷', '🐰'] },
  slot81: { name: 'Дикий Триумф', symbols: ['💍', '🧿', '🎻', '🐱', '🐨', '🐔'] },
  slot82: { name: 'Огненный Триумф', symbols: ['🎸', '💡', '🦊', '🐷', '🦉', '🐛'] },
  slot83: { name: 'Лунный Триумф', symbols: ['🐭', '🐯', '🐧', '🐴', '🐢', '🐡'] },
  slot84: { name: 'Золотой Триумф', symbols: ['🐸', '🦇', '🦋', '🦑', '🦈', '🦏'] },
  slot85: { name: 'Серебряный Триумф', symbols: ['🦄', '🐍', '🐠', '🦍', '🦒', '🦙'] },
  slot86: { name: 'Тайный Триумф', symbols: ['🦐', '🐊', '🦛', '🐖', '🍋', '🍑'] },
  slot87: { name: 'Древний Триумф', symbols: ['🦧', '🦘', '🍎', '🍓', '🥝', '🥐'] },
  slot88: { name: 'Магический Триумф', symbols: ['🐑', '🍌', '🥭', '🌶️', '🍕', '🍫'] },
  slot89: { name: 'Королевский Триумф', symbols: ['🫐', '🍅', '🥨', '🍩', '🥧', '⚾'] },
  slot90: { name: 'Небесный Триумф', symbols: ['🌽', '🌮', '🍬', '⚽', '🎱', '🎮'] },
};
const DEFAULT_MACHINE = 'fruits';

function listMachines() {
  return Object.entries(MACHINES).map(([id, m]) => ({ id, name: m.name, symbols: m.symbols }));
}

function getMachine(machineId) {
  return MACHINES[machineId] || MACHINES[DEFAULT_MACHINE];
}

function spinReel(symbols) {
  let r = Math.random() * TOTAL_WEIGHT;
  for (let i = 0; i < PAYTABLE.length; i++) {
    if (r < PAYTABLE[i].weight) return { key: symbols[i], idx: i };
    r -= PAYTABLE[i].weight;
  }
  return { key: symbols[0], idx: 0 };
}

// Возвращает { reels: [a,b,c], multiplier, payout }
function spinSlots(bet, machineId) {
  const machine = getMachine(machineId);
  const spins = [spinReel(machine.symbols), spinReel(machine.symbols), spinReel(machine.symbols)];
  const reels = spins.map(s => s.key);
  let multiplier = 0;

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    multiplier = PAYTABLE[spins[0].idx].pay3;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    // Любая пара одинаковых символов — небольшая утешительная выплата.
    multiplier = 0.65;
  }

  return { reels, multiplier, payout: Math.round(bet * multiplier) };
}

module.exports = { PAYTABLE, MACHINES, listMachines, getMachine, spinSlots };
