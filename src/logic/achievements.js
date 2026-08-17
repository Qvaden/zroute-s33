import { computeAllianceHistory } from './standings.js';

/**
 * Значки считаются автоматически из истории VS. Ручных полей в data/live.json
 * нет: достижение нельзя случайно выдать или потерять при редактировании.
 *
 * Правила:
 *  - «Тройная серия»: минимум 3 победы подряд за сезон.
 *  - «Доминирование»: минимум 5 побед подряд за сезон.
 *  - «Камбэк»: в одном Кварте счёт уходил ниже нуля, а затем снова становился
 *    положительным.
 *  - «Идеальный Кварт»: 4 победы из 4 в одном завершённом Кварте.
 */
const BADGES = {
  streak3: { id: 'streak3', icon: '🔥', title: 'Тройная серия', text: '3 победы подряд', tone: 'fire' },
  streak5: { id: 'streak5', icon: '⚡', title: 'Доминирование', text: '5 побед подряд', tone: 'gold' },
  streak7: { id: 'streak7', icon: '👑', title: 'Непробиваемые', text: '7 побед подряд', tone: 'crown' },
  veteran: { id: 'veteran', icon: '🏅', title: 'Ветеран', text: '10 побед за сезон', tone: 'veteran' },
  comeback: { id: 'comeback', icon: '↗', title: 'Камбэк', text: 'из минуса обратно в ноль или плюс', tone: 'comeback' },
  perfectQuarter: { id: 'perfect-quarter', icon: '✦', title: 'Идеальный Кварт', text: '4 победы из 4', tone: 'perfect' },
  undefeatedQuarter: { id: 'undefeated-quarter', icon: '🛡', title: 'Без поражений', text: 'Кварт без единого проигрыша', tone: 'shield' },
  doublePerfect: { id: 'double-perfect', icon: '✦✦', title: 'Двойная корона', text: '2 идеальных Кварта', tone: 'double' },
  lastStand: { id: 'last-stand', icon: '🩸', title: 'Последний рывок', text: 'победа после 3 поражений подряд', tone: 'comeback' },
};

function bestRun(outcomes, type) {
  let best = 0;
  let run = 0;
  for (const outcome of outcomes) {
    if (outcome === type) {
      run += 1;
      best = Math.max(best, run);
    } else if (outcome === 'win' || outcome === 'loss') {
      run = 0;
    }
  }
  return best;
}

function quarterGroups(weeks) {
  const groups = new Map();
  for (const week of [...weeks].sort((a, b) => a.number - b.number)) {
    const number = Math.floor((week.number - 1) / 4) + 1;
    if (!groups.has(number)) groups.set(number, []);
    groups.get(number).push(week);
  }
  return groups;
}

/** @param {string} allianceId @param {import('../data/types.js').Week[]} weeks @param {import('../data/types.js').Result[]} results */
export function getAllianceAchievements(allianceId, weeks, results) {
  const ordered = [...weeks].sort((a, b) => a.number - b.number);
  const history = computeAllianceHistory(allianceId, ordered, results);
  const outcomes = history.map((item) => item.outcome);
  const badges = [];
  const maxWins = bestRun(outcomes, 'win');

  if (maxWins >= 3) badges.push({ ...BADGES.streak3, value: maxWins });
  if (maxWins >= 5) badges.push({ ...BADGES.streak5, value: maxWins });
  if (maxWins >= 7) badges.push({ ...BADGES.streak7, value: maxWins });
  if (outcomes.filter((outcome) => outcome === 'win').length >= 10) badges.push({ ...BADGES.veteran });

  let hasComeback = false;
  let hasLastStand = false;
  let hasPerfectQuarter = false;
  let hasUndefeatedQuarter = false;
  let perfectQuarterCount = 0;
  for (const group of quarterGroups(ordered).values()) {
    const byId = new Map(history.map((item) => [item.week.id, item.outcome]));
    const period = group.map((week) => byId.get(week.id) ?? null);
    const played = period.filter((outcome) => outcome === 'win' || outcome === 'loss');
    const perfect = period.length === 4 && period.every((outcome) => outcome === 'win');
    if (perfect) {
      hasPerfectQuarter = true;
      perfectQuarterCount += 1;
    }
    if (played.length >= 3 && played.every((outcome) => outcome === 'win')) hasUndefeatedQuarter = true;

    let score = 0;
    let wentNegative = false;
    for (let i = 0; i < period.length; i++) {
      const outcome = period[i];
      if (outcome === 'win') score += 1;
      if (outcome === 'loss') score -= 1;
      if (score < 0) wentNegative = true;
      if (wentNegative && score >= 0) hasComeback = true;
      if (outcome === 'win' && i >= 3 && period.slice(i - 3, i).every((item) => item === 'loss')) hasLastStand = true;
    }
    // Не считаем незавершённый Кварт идеальным или камбэком на пустых данных.
    if (!played.length) continue;
  }

  if (hasComeback) badges.push({ ...BADGES.comeback });
  if (hasLastStand) badges.push({ ...BADGES.lastStand });
  if (hasPerfectQuarter) badges.push({ ...BADGES.perfectQuarter });
  if (hasUndefeatedQuarter) badges.push({ ...BADGES.undefeatedQuarter });
  if (perfectQuarterCount >= 2) badges.push({ ...BADGES.doublePerfect, value: perfectQuarterCount });

  return badges;
}

/** @param {import('../data/types.js').Alliance[]} alliances @param {import('../data/types.js').Week[]} weeks @param {import('../data/types.js').Result[]} results */
export function computeAchievements(alliances, weeks, results) {
  return new Map(alliances.map((alliance) => [alliance.id, getAllianceAchievements(alliance.id, weeks, results)]));
}
