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
  fruits: { name: 'Фрукты Classic', symbols: ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'] },
  egypt:  { name: 'Золото Египта',  symbols: ['🐫', '🏺', '🔺', '👁️', '👑', '💰'] },
  space:  { name: 'Космо Джекпот',  symbols: ['🌟', '🌙', '🚀', '🪐', '🛸', '👽'] },
  ocean:  { name: 'Глубина Океана', symbols: ['🐚', '🐟', '🦀', '⚓', '🧜‍♀️', '🦪'] },
  gold:   { name: 'Золотая Лихорадка', symbols: ['🪨', '⛏️', '🐴', '🚂', '👑', '🪙'] },
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
