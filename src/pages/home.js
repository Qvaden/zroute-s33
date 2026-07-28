import { esc, fmtDate, deltaBadge, plural } from '../ui/helpers.js';
import { raceChart } from '../ui/chart.js';

/**
 * Главная — ответ на «зашёл и понял, у кого получается».
 * Всё главное должно читаться за пять секунд: номер недели, лидер сезона,
 * кто победил и кто проиграл. Остальное — ниже, для тех, кому интересно.
 */
export function renderHome({ summary, standings, movers, weeks }) {
  if (!summary) {
    return `<section class="panel"><p class="muted">Пока нет ни одной внесённой недели.</p></section>`;
  }

  const { week, winners, losers, recorded } = summary;
  const leader = standings[0];

  const tiles = (list) =>
    list.length
      ? list
          .map(
            (a) => `<span class="tile" style="--tag-color:${esc(a.color || '#7a8494')}">
                      <b>${esc(a.tag)}</b>${esc(a.name)}
                    </span>`
          )
          .join('')
      : '<span class="muted">никого</span>';

  const leaderStreak =
    leader?.streak && leader.streak.length > 1
      ? ` · серия ${plural(leader.streak.length, 'победа', 'победы', 'побед')}`
      : '';

  const moverRow = (r) =>
    `<li>
       <span class="tag" style="--tag-color:${esc(r.alliance.color || '#7a8494')}">${esc(r.alliance.tag)}</span>
       <span style="flex:1">${esc(r.alliance.name)}</span>
       ${deltaBadge(r.delta)}
       <span class="muted">${r.place} место</span>
     </li>`;

  const top5 = standings.filter((r) => r.alliance.active).slice(0, 5);

  return `
    <section class="hero">
      <div class="hero__top">
        <div>
          <span class="eyebrow">Итоги недели</span>
          <div class="hero__week">
            <span class="hero__word">Неделя</span>
            <span class="hero__num num">${week.number}</span>
          </div>
          <div class="hero__dates">
            ${fmtDate(week.startDate)} — ${fmtDate(week.endDate)}
            <span class="hero__sep">·</span>
            ${plural(recorded, 'результат внесён', 'результата внесено', 'результатов внесено')}
          </div>
        </div>
      </div>

      ${
        leader
          ? `<div class="leader">
               <span class="leader__crown">👑</span>
               <div class="leader__body">
                 <div class="leader__label">Лидер сезона</div>
                 <div class="leader__name">${esc(leader.alliance.name)}</div>
                 <div class="leader__meta">
                   ${plural(leader.wins, 'победа', 'победы', 'побед')} ·
                   ${plural(leader.losses, 'поражение', 'поражения', 'поражений')}${leaderStreak}
                 </div>
               </div>
               <div class="leader__pts num">${leader.points > 0 ? '+' : ''}${leader.points}</div>
             </div>`
          : ''
      }

      <div class="split">
        <div class="split__col split__col--win">
          <h3>Победили <span class="split__count num">${winners.length}</span><i class="split__bar"></i></h3>
          <div class="tiles">${tiles(winners)}</div>
        </div>
        <div class="split__col split__col--loss">
          <h3>Проиграли <span class="split__count num">${losers.length}</span><i class="split__bar"></i></h3>
          <div class="tiles">${tiles(losers)}</div>
        </div>
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Гонка сезона</span>
        <h2>Как менялись очки лидеров</h2>
        <p class="muted">Накопленные очки по неделям · показаны пятеро лучших</p>
      </header>
      ${raceChart(top5, weeks)}
    </section>

    <div class="grid-2">
      <section class="panel">
        <header class="panel__head"><h2>Вершина таблицы</h2></header>
        <ol class="podium">
          ${standings
            .slice(0, 5)
            .map(
              (r, i) => `<li class="podium__item podium__item--${i + 1}">
                <span class="podium__place num">${i + 1}</span>
                <span class="tag" style="--tag-color:${esc(r.alliance.color || '#7a8494')}">${esc(r.alliance.tag)}</span>
                <span class="podium__name">${esc(r.alliance.name)}</span>
                <span class="podium__points num">${r.points > 0 ? '+' : ''}${r.points}</span>
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
              movers.up.length ? movers.up.map(moverRow).join('') : '<li class="muted">без изменений</li>'
            }</ul>
          </div>
          <div>
            <h4 class="movers__title movers__title--down">Опустились</h4>
            <ul class="movers__list">${
              movers.down.length ? movers.down.map(moverRow).join('') : '<li class="muted">без изменений</li>'
            }</ul>
          </div>
        </div>
      </section>
    </div>`;
}
