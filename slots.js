// ===================== СЛОТЫ (только фишки клуба, без реальных денег) =====================
// Символы и веса на один барабан (сумма весов = 100). Барабаны независимы.
const SYMBOLS = [
  { key: '🍒', weight: 35, pay3: 5 },
  { key: '🍋', weight: 28, pay3: 8 },
  { key: '🔔', weight: 18, pay3: 15 },
  { key: '⭐', weight: 11, pay3: 35 },
  { key: '💎', weight: 6,  pay3: 70 },
  { key: '7️⃣', weight: 2,  pay3: 150 },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((a, s) => a + s.weight, 0); // = 100

function spinReel() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SYMBOLS) {
    if (r < s.weight) return s.key;
    r -= s.weight;
  }
  return SYMBOLS[0].key;
}

// Возвращает { reels: [a,b,c], multiplier, payout }
function spinSlots(bet) {
  const reels = [spinReel(), spinReel(), spinReel()];
  let multiplier = 0;

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    const sym = SYMBOLS.find(s => s.key === reels[0]);
    multiplier = sym.pay3;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    // Любая пара одинаковых символов — небольшая утешительная выплата.
    multiplier = 0.65;
  }

  return { reels, multiplier, payout: Math.round(bet * multiplier) };
}

module.exports = { SYMBOLS, spinSlots };
