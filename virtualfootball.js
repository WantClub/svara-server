// ===================== ВИРТУАЛЬНЫЙ ФУТБОЛ =====================
// Полностью автоматическая игра: выдуманные команды, компьютер сам
// генерирует "силу" каждой команды и результат матча. Никакого участия
// администратора не требуется — цикл идёт сам по себе, бесконечно.

const HOUSE_MARGIN = 1.10; // ~9% маржа клуба, распределена по всем трём исходам

const TEAM_NAMES = [
  'Атлетико Свара', 'Динамо Тринка', 'Сека Юнайтед', 'Клуб Стар', 'Голд Юнайтед',
  'Фишка Атлетик', 'Реал Козырь', 'Спарта Дилер', 'Вегас Юнайтед', 'Джекпот СК',
  'Крупье Спорт', 'Ривер Флеш', 'Форс Мажор', 'Байер Ставка', 'Спарта Банк',
  'Олимпик Стар', 'Виктория Пик', 'Метеор Клуб', 'Титан Юнайтед', 'Пума Ривер'
];

function pickTwoTeams() {
  const shuffled = [...TEAM_NAMES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [shuffled[0], shuffled[1]];
}

function round2(n) { return Math.round(n * 100) / 100; }

// Генерирует новый матч: случайная "сила" обеих команд определяет честные
// вероятности исходов, из которых считаются коэффициенты с учётом маржи клуба.
function generateMatch() {
  const [home, away] = pickTwoTeams();
  const strengthHome = 20 + Math.random() * 60; // 20..80
  const strengthAway = 20 + Math.random() * 60;
  const total = strengthHome + strengthAway;

  // Базовые вероятности победы пропорциональны силе команд; оставляем
  // разумный шанс на ничью (чем ближе силы — тем выше шанс ничьей).
  const diff = Math.abs(strengthHome - strengthAway) / total; // 0..~0.6
  const pDrawBase = 0.30 - diff * 0.22; // от ~0.08 до ~0.30
  const pDraw = Math.max(0.08, Math.min(0.30, pDrawBase));
  const pHome = (strengthHome / total) * (1 - pDraw);
  const pAway = (strengthAway / total) * (1 - pDraw);

  const oddsHome = round2(1 / (pHome * HOUSE_MARGIN));
  const oddsDraw = round2(1 / (pDraw * HOUSE_MARGIN));
  const oddsAway = round2(1 / (pAway * HOUSE_MARGIN));

  return {
    home, away,
    probs: { home: pHome, draw: pDraw, away: pAway },
    odds: { home: oddsHome, draw: oddsDraw, away: oddsAway }
  };
}

// Честно разыгрывает результат СТРОГО по тем же вероятностям, что легли
// в основу коэффициентов — иначе отдача перестанет совпадать с показанным.
function drawResult(probs) {
  const r = Math.random();
  if (r < probs.home) return 'home';
  if (r < probs.home + probs.draw) return 'draw';
  return 'away';
}

module.exports = { HOUSE_MARGIN, TEAM_NAMES, generateMatch, drawResult };
