import { esc, deltaBadge, formDots, sparkline, plural } from '../ui/helpers.js';

/**
 * Общий рейтинг: главная ценность сайта.
 * Именно тут со временем и проступает та самая «интересная картина».
 */
export function renderLadder({ standings }) {
  const rows = standings
    .map((r) => {
      const a = r.alliance;
      const streak =
        r.streak && r.streak.length > 1
          ? `<span class="streak streak--${r.streak.type}">${
              r.streak.type === 'win' ? '🔥' : '💀'
            }${r.streak.length}</span>`
          : '';

      return `<tr class="${a.active ? '' : 'row--inactive'}" data-alliance="${esc(a.id)}">
        <td class="c-place">
          <span class="place">${r.place}</span>
          ${deltaBadge(r.delta)}
        </td>
        <td class="c-name">
          <span class="tag" style="--tag-color:${esc(a.color || '#888')}">${esc(a.tag)}</span>
          <span class="name">${esc(a.name)}${a.active ? '' : ' <em class="muted">(распался)</em>'}</span>
          ${streak}
        </td>
        <td class="c-form">${formDots(r.form)}</td>
        <td class="c-num c-win">${r.wins}</td>
        <td class="c-num c-loss">${r.losses}</td>
        <td class="c-num c-points ${r.points > 0 ? 'pos' : r.points < 0 ? 'neg' : ''}">
          ${r.points > 0 ? '+' : ''}${r.points}
        </td>
        <td class="c-spark">${sparkline(r.series, a.color)}</td>
      </tr>`;
    })
    .join('');

  const active = standings.filter((r) => r.alliance.active).length;

  return `
    <section class="panel">
      <header class="panel__head">
        <h2>Рейтинг альянсов</h2>
        <p class="muted">
          ${plural(active, 'активный альянс', 'активных альянса', 'активных альянсов')} ·
          победа +1, поражение −1, пропуск 0
        </p>
      </header>

      <div class="table-wrap">
        <table class="ladder">
          <thead>
            <tr>
              <th class="c-place">#</th>
              <th class="c-name">Альянс</th>
              <th class="c-form">Форма</th>
              <th class="c-num" title="Победы">П</th>
              <th class="c-num" title="Поражения">Пр</th>
              <th class="c-num">Очки</th>
              <th class="c-spark">Динамика</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}
