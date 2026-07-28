import { esc, fmtDate, plural, deltaBadge } from '../ui/helpers.js';
import { areaChart, placeChart } from '../ui/chart.js';
import { computeAllianceHistory, computeBestStreaks } from '../logic/standings.js';

/*
  Исходов два. Третья строка — не исход, а отсутствие записи: результат
  за эту неделю ещё не внесли либо альянса тогда не существовало.
*/
const OUTCOME = {
  win:  { label: 'Победа',    cls: 'win',  sign: '+1' },
  loss: { label: 'Поражение', cls: 'loss', sign: '−1' },
};
const NO_DATA = { label: 'Нет данных', cls: 'none', sign: '—' };

/**
 * Карточка одного альянса: весь его сезон на одном экране.
 */
export function renderAlliance(view, allianceId) {
  const { standings, weeks, results, placeHistory } = view;
  const row = standings.find((r) => r.alliance.id === allianceId);

  if (!row) {
    return `<section class="panel">
      <h2>Альянс не найден</h2>
      <p class="muted">Возможно, ссылка устарела.</p>
      <p><a class="back" href="#/ladder">← Вернуться к рейтингу</a></p>
    </section>`;
  }

  const a = row.alliance;
  const color = a.color || '#7a8494';
  const ordered = [...weeks].sort((x, y) => x.number - y.number);
  const history = computeAllianceHistory(a.id, ordered, results);
  const { bestWin, bestLoss } = computeBestStreaks(history.map((h) => h.outcome));

  // Эталон: средние накопленные очки по активным альянсам. Без него
  // одинокая кривая не отвечает на главный вопрос — это много или мало.
  const active = standings.filter((r) => r.alliance.active && r.series.length === ordered.length);
  const average = ordered.map((_, i) =>
    Math.round((active.reduce((s, r) => s + r.series[i], 0) / (active.length || 1)) * 10) / 10
  );

  const places = placeHistory.get(a.id) ?? [];
  const bestPlace = places.length ? Math.min(...places) : row.place;

  const stats = [
    { label: 'Место', value: row.place, extra: deltaBadge(row.delta) },
    { label: 'Очки', value: `${row.points > 0 ? '+' : ''}${row.points}`, cls: row.points > 0 ? 'pos' : row.points < 0 ? 'neg' : '' },
    { label: 'Победы', value: row.wins, cls: 'pos' },
    { label: 'Поражения', value: row.losses, cls: 'neg' },
    { label: 'Доля побед', value: `${Math.round(row.winRate * 100)}%` },
    { label: 'Лучшее место', value: bestPlace },
  ];

  return `
    <a class="back" href="#/ladder">← Рейтинг</a>

    <section class="ally" style="--tag-color:${esc(color)}">
      <div class="ally__head">
        <span class="ally__tag">${esc(a.tag)}</span>
        <div>
          <h1 class="ally__name">${esc(a.name)}</h1>
          <p class="ally__sub">
            ${a.active ? 'Активен' : 'Распался'} ·
            ${plural(row.played, 'сыгранный VS', 'сыгранных VS', 'сыгранных VS')}
            ${bestWin > 1 ? ` · лучшая серия ${plural(bestWin, 'победа', 'победы', 'побед')} подряд` : ''}
            ${bestLoss > 1 ? ` · худшая ${plural(bestLoss, 'поражение', 'поражения', 'поражений')} подряд` : ''}
          </p>
        </div>
      </div>

      <div class="ally__stats">
        ${stats
          .map(
            (s) => `<div class="stat">
              <span class="stat__label">${s.label}</span>
              <span class="stat__value ${s.cls ?? ''}">${s.value}${s.extra ?? ''}</span>
            </div>`
          )
          .join('')}
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Динамика</span>
        <h2>Накопленные очки за сезон</h2>
      </header>
      ${areaChart(row.series, ordered, color, { reference: average })}
    </section>

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Положение</span>
        <h2>Место в таблице по неделям</h2>
        <p class="muted">Чем выше линия, тем выше место</p>
      </header>
      ${placeChart(places, ordered, standings.length, color)}
    </section>

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Хроника</span>
        <h2>Все VS сезона</h2>
      </header>
      <ol class="vs">
        ${history
          .map((h, i) => {
            const o = OUTCOME[h.outcome] ?? NO_DATA;
            const running = row.series[i];
            return `<li class="vs__row vs__row--${o.cls}">
              <span class="vs__week">Н${h.week.number}</span>
              <span class="vs__dates">${fmtDate(h.week.startDate)} — ${fmtDate(h.week.endDate)}</span>
              <span class="vs__badge vs__badge--${o.cls}">${o.label}</span>
              <span class="vs__sign">${o.sign}</span>
              <span class="vs__total num">${running > 0 ? '+' : ''}${running}</span>
            </li>`;
          })
          .join('')}
      </ol>
    </section>`;
}
