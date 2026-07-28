import { esc, fmtDate, deltaBadge, plural } from '../ui/helpers.js';

/**
 * Главная страница — ответ на «зашёл и понял, у кого получается».
 * Всё самое важное должно читаться за пять секунд, без прокрутки.
 */
export function renderHome({ summary, standings, movers }) {
  if (!summary) {
    return `<section class="panel"><p class="muted">Пока нет ни одной внесённой недели.</p></section>`;
  }

  const { week, winners, losers, participated } = summary;

  const chips = (list, kind) =>
    list.length
      ? list
          .map(
            (a) =>
              `<span class="chip chip--${kind}" style="--tag-color:${esc(a.color || '#888')}">
                 <b>${esc(a.tag)}</b> ${esc(a.name)}
               </span>`
          )
          .join('')
      : '<span class="muted">никого</span>';

  const moverRow = (r, kind) =>
    `<li><span class="tag" style="--tag-color:${esc(r.alliance.color || '#888')}">${esc(
      r.alliance.tag
    )}</span> ${esc(r.alliance.name)} ${deltaBadge(r.delta)} <span class="muted">→ ${r.place} место</span></li>`;

  const top3 = standings.slice(0, 3);

  return `
    <section class="hero">
      <div class="hero__week">
        <span class="hero__label">Итоги недели</span>
        <h2>Неделя ${week.number}</h2>
        <p class="muted">${fmtDate(week.startDate)} — ${fmtDate(week.endDate)} ·
           ${plural(participated, 'альянс участвовал', 'альянса участвовало', 'альянсов участвовало')}</p>
      </div>

      <div class="hero__split">
        <div class="hero__col hero__col--win">
          <h3>Победили <span class="count">${winners.length}</span></h3>
          <div class="chips">${chips(winners, 'win')}</div>
        </div>
        <div class="hero__col hero__col--loss">
          <h3>Проиграли <span class="count">${losers.length}</span></h3>
          <div class="chips">${chips(losers, 'loss')}</div>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="panel">
        <header class="panel__head"><h2>Вершина таблицы</h2></header>
        <ol class="podium">
          ${top3
            .map(
              (r, i) => `<li class="podium__item podium__item--${i + 1}">
                <span class="podium__place">${i + 1}</span>
                <span class="tag" style="--tag-color:${esc(r.alliance.color || '#888')}">${esc(
                r.alliance.tag
              )}</span>
                <span class="podium__name">${esc(r.alliance.name)}</span>
                <span class="podium__points">${r.points > 0 ? '+' : ''}${r.points}</span>
              </li>`
            )
            .join('')}
        </ol>
      </section>

      <section class="panel">
        <header class="panel__head"><h2>Движение за неделю</h2></header>
        <div class="movers">
          <div>
            <h4 class="movers__title movers__title--up">Поднялись</h4>
            <ul class="movers__list">${
              movers.up.length ? movers.up.map((r) => moverRow(r, 'up')).join('') : '<li class="muted">без изменений</li>'
            }</ul>
          </div>
          <div>
            <h4 class="movers__title movers__title--down">Опустились</h4>
            <ul class="movers__list">${
              movers.down.length ? movers.down.map((r) => moverRow(r, 'down')).join('') : '<li class="muted">без изменений</li>'
            }</ul>
          </div>
        </div>
      </section>
    </div>`;
}
