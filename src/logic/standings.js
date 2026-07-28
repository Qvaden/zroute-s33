/**
 * ПОДСЧЁТ РЕЙТИНГА.
 *
 * Чистые функции над доменными объектами. Здесь нет ни одного упоминания
 * Google Таблиц или PocketBase — и это главное свойство: логика одинакова
 * для любого источника и тестируется вообще без сети.
 *
 * Правило простое, как в ТЗ: победа +1, поражение −1.
 * Пропуск недели даёт 0, а не −1, иначе неактивные альянсы улетают
 * в глубокий минус и таблица перестаёт что-либо показывать.
 */

/**
 * @typedef {Object} StandingRow
 * @property {import('../data/types.js').Alliance} alliance
 * @property {number} points
 * @property {number} wins
 * @property {number} losses
 * @property {number} draws
 * @property {number} played
 * @property {number} winRate         Доля побед среди сыгранных, 0..1
 * @property {number} place
 * @property {number|null} delta      Изменение места за последнюю неделю. + вверх, − вниз
 * @property {import('../data/types.js').Outcome[]} form  Последние N результатов, свежие в конце
 * @property {{type: 'win'|'loss', length: number}|null} streak
 * @property {number[]} series        Накопленные очки после каждой недели — для графика
 */

/**
 * Быстрый доступ: weekId+allianceId → outcome.
 * @param {import('../data/types.js').Result[]} results
 */
function indexResults(results) {
  const map = new Map();
  for (const r of results) map.set(`${r.weekId}|${r.allianceId}`, r.outcome);
  return map;
}

/**
 * Ранжирование. При равенстве очков выше тот, у кого больше побед,
 * затем у кого меньше поражений, затем по алфавиту — чтобы порядок
 * был стабильным и таблица не «прыгала» между перезагрузками.
 *
 * @param {{points:number,wins:number,losses:number,alliance:{name:string}}[]} rows
 */
function rank(rows) {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      a.losses - b.losses ||
      a.alliance.name.localeCompare(b.alliance.name, 'ru')
  );
  sorted.forEach((row, i) => {
    row.place = i + 1;
  });
  return sorted;
}

/**
 * Считает очки каждого альянса по состоянию на конец указанной недели.
 *
 * @param {import('../data/types.js').Alliance[]} alliances
 * @param {import('../data/types.js').Week[]} weeks   Отсортированы по возрастанию номера
 * @param {Map<string,string>} index
 * @param {{win:number,loss:number,draw:number,skip:number}} scoring
 * @param {number} upToIndex  Индекс последней учитываемой недели включительно
 */
function tallyUpTo(alliances, weeks, index, scoring, upToIndex) {
  return alliances.map((alliance) => {
    let points = 0,
      wins = 0,
      losses = 0,
      draws = 0;

    for (let i = 0; i <= upToIndex; i++) {
      const outcome = index.get(`${weeks[i].id}|${alliance.id}`);
      if (!outcome || outcome === 'skip') continue;
      if (outcome === 'win') {
        wins++;
        points += scoring.win;
      } else if (outcome === 'loss') {
        losses++;
        points += scoring.loss;
      } else if (outcome === 'draw') {
        draws++;
        points += scoring.draw;
      }
    }

    return { alliance, points, wins, losses, draws, place: 0 };
  });
}

/**
 * Главная функция: полная таблица рейтинга.
 *
 * @param {import('../data/types.js').Alliance[]} alliances
 * @param {import('../data/types.js').Week[]} weeks
 * @param {import('../data/types.js').Result[]} results
 * @param {{win:number,loss:number,draw:number,skip:number}} scoring
 * @param {number} formLength
 * @returns {StandingRow[]}
 */
export function computeStandings(alliances, weeks, results, scoring, formLength = 5) {
  const index = indexResults(results);
  const ordered = [...weeks].sort((a, b) => a.number - b.number);
  const last = ordered.length - 1;

  if (last < 0) {
    return alliances.map((alliance, i) => ({
      alliance,
      points: 0, wins: 0, losses: 0, draws: 0, played: 0, winRate: 0,
      place: i + 1, delta: null, form: [], streak: null, series: [],
    }));
  }

  const current = rank(tallyUpTo(alliances, ordered, index, scoring, last));

  // Места неделей ранее — чтобы показать стрелки движения.
  const prevPlaces = new Map();
  if (last >= 1) {
    for (const row of rank(tallyUpTo(alliances, ordered, index, scoring, last - 1))) {
      prevPlaces.set(row.alliance.id, row.place);
    }
  }

  return current.map((row) => {
    const id = row.alliance.id;

    // Накопленные очки по неделям — исходник для графика динамики.
    const series = [];
    let running = 0;
    /** @type {import('../data/types.js').Outcome[]} */
    const allOutcomes = [];

    for (const week of ordered) {
      const outcome = index.get(`${week.id}|${id}`) ?? 'skip';
      allOutcomes.push(outcome);
      running += scoring[outcome] ?? 0;
      series.push(running);
    }

    // Текущая серия: сколько подряд побед или поражений с конца.
    // Пропуски не обрывают серию и в неё не входят.
    let streak = null;
    const played = allOutcomes.filter((o) => o === 'win' || o === 'loss');
    if (played.length) {
      const type = played[played.length - 1];
      let length = 0;
      for (let i = played.length - 1; i >= 0 && played[i] === type; i--) length++;
      streak = { type, length };
    }

    const prev = prevPlaces.get(id);
    const playedCount = row.wins + row.losses + row.draws;

    return {
      ...row,
      played: playedCount,
      winRate: playedCount ? row.wins / playedCount : 0,
      delta: prev == null ? null : prev - row.place,
      form: allOutcomes.slice(-formLength),
      streak,
      series,
    };
  });
}

/**
 * Итоги одной недели — для главной страницы.
 * Если weekId не передан, берётся последняя неделя.
 *
 * @param {import('../data/types.js').Alliance[]} alliances
 * @param {import('../data/types.js').Week[]} weeks
 * @param {import('../data/types.js').Result[]} results
 * @param {string} [weekId]
 */
export function computeWeekSummary(alliances, weeks, results, weekId) {
  const ordered = [...weeks].sort((a, b) => a.number - b.number);
  const week = weekId ? ordered.find((w) => w.id === weekId) : ordered[ordered.length - 1];
  if (!week) return null;

  const byId = new Map(alliances.map((a) => [a.id, a]));
  const winners = [];
  const losers = [];
  const draws = [];

  for (const r of results) {
    if (r.weekId !== week.id) continue;
    const alliance = byId.get(r.allianceId);
    if (!alliance) continue;
    if (r.outcome === 'win') winners.push(alliance);
    else if (r.outcome === 'loss') losers.push(alliance);
    else if (r.outcome === 'draw') draws.push(alliance);
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  return {
    week,
    winners: winners.sort(byName),
    losers: losers.sort(byName),
    draws: draws.sort(byName),
    participated: winners.length + losers.length + draws.length,
  };
}

/**
 * История мест: какое место занимал каждый альянс после каждой недели.
 *
 * Для карточки альянса это интереснее очков. Очки говорят «сколько набрал»,
 * а место — «кого обошёл». Альянс может набирать очки и при этом падать
 * в таблице, если соседи набирают быстрее, и вот это как раз видно.
 *
 * @param {import('../data/types.js').Alliance[]} alliances
 * @param {import('../data/types.js').Week[]} weeks
 * @param {import('../data/types.js').Result[]} results
 * @param {{win:number,loss:number,draw:number,skip:number}} scoring
 * @returns {Map<string, number[]>} id альянса → места по неделям
 */
export function computePlaceHistory(alliances, weeks, results, scoring) {
  const index = indexResults(results);
  const ordered = [...weeks].sort((a, b) => a.number - b.number);
  const history = new Map(alliances.map((a) => [a.id, []]));

  for (let i = 0; i < ordered.length; i++) {
    for (const row of rank(tallyUpTo(alliances, ordered, index, scoring, i))) {
      history.get(row.alliance.id).push(row.place);
    }
  }
  return history;
}

/**
 * Все результаты одного альянса по неделям, включая пропуски.
 *
 * @param {string} allianceId
 * @param {import('../data/types.js').Week[]} weeks
 * @param {import('../data/types.js').Result[]} results
 * @returns {{week: import('../data/types.js').Week, outcome: import('../data/types.js').Outcome}[]}
 */
export function computeAllianceHistory(allianceId, weeks, results) {
  const index = indexResults(results);
  return [...weeks]
    .sort((a, b) => a.number - b.number)
    .map((week) => ({ week, outcome: index.get(`${week.id}|${allianceId}`) ?? 'skip' }));
}

/**
 * Самая длинная серия побед и самая длинная серия поражений за сезон.
 * Пропуски серию не обрывают и в неё не входят — как и в текущей серии.
 *
 * @param {import('../data/types.js').Outcome[]} outcomes
 */
export function computeBestStreaks(outcomes) {
  const played = outcomes.filter((o) => o === 'win' || o === 'loss');
  let bestWin = 0;
  let bestLoss = 0;
  let run = 0;

  for (let i = 0; i < played.length; i++) {
    run = i > 0 && played[i] === played[i - 1] ? run + 1 : 1;
    if (played[i] === 'win') bestWin = Math.max(bestWin, run);
    else bestLoss = Math.max(bestLoss, run);
  }
  return { bestWin, bestLoss };
}

/**
 * Кто сильнее всех поднялся и упал за последнюю неделю.
 * @param {StandingRow[]} standings
 * @param {number} limit
 */
export function computeMovers(standings, limit = 3) {
  const withDelta = standings.filter((r) => r.delta !== null && r.delta !== 0);
  return {
    up: withDelta.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit),
    down: withDelta.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit),
  };
}
