import { esc, fmtDate, plural } from '../../ui/helpers.js';
import { computeQuarterWindow, computeStandings } from '../../logic/standings.js';
import { CONFIG } from '../../../config.js';

/**
 * Админский экран Кварта не редактирует очки вручную: они всегда считаются
 * из результатов недель. Поэтому кнопка «Редактировать» ведёт в правильный
 * недельный редактор — это сохраняет один источник правды и не создаёт
 * расхождения между сайтом и панелью.
 */
export function renderQuarter(view) {
  const { data } = view;
  const quarter = computeQuarterWindow(data.weeks, data.results);
  const periodResults = data.results.filter((r) => quarter.weeks.some((w) => w.id === r.weekId));
  const standings = quarter.weeks.length
    ? computeStandings(data.alliances, quarter.weeks, periodResults, CONFIG.scoring, 4)
    : [];
  const top = standings.slice(0, 3);
  const active = data.alliances.filter((a) => a.active).length;

  return `
    <section class="adm-hero">
      <span class="eyebrow">Отдельный шанс</span>
      <h1 class="adm-h1">Кварт</h1>
      <p class="adm-lead">Здесь очки не редактируются отдельно: Кварт автоматически собирается из результатов четырёх недель. Чтобы изменить его, откройте нужную неделю и исправьте результат.</p>
    </section>

    <div class="adm-grid">
      <section class="panel">
        <header class="panel__head"><h2>Текущий период</h2></header>
        ${quarter.number
          ? `<div class="adm-kv">
               <div><span>Период</span><b>№ ${quarter.number}</b></div>
               <div><span>Недели</span><b>${quarter.startNumber}–${quarter.endNumber}</b></div>
               <div><span>Альянсов в базе</span><b>${active}</b></div>
             </div>`
          : '<p class="muted">Результатов ещё нет — Кварт начнётся после первой внесённой недели.</p>'}
      </section>
      <section class="panel">
        <header class="panel__head"><h2>Топ-3 сейчас</h2></header>
        ${top.length
          ? `<ol class="adm-quarter-top">${top.map((r) => `<li><b>${r.place}. ${esc(r.alliance.tag)}</b><span>${r.points > 0 ? '+' : ''}${r.points} очк. · ${r.wins}–${r.losses}</span></li>`).join('')}</ol>`
          : '<p class="muted">Топ появится после внесения результатов.</p>'}
      </section>
    </div>

    <section class="panel adm-quarter-weeks">
      <header class="panel__head">
        <div><h2>Недели Кварта</h2><p class="muted">Редактирование результата выполняется внутри недели.</p></div>
      </header>
      ${quarter.weeks.length
        ? `<div class="adm-quarter-week-grid">${quarter.weeks.map((week) => {
            const count = data.results.filter((r) => r.weekId === week.id).length;
            return `<article class="adm-quarter-week">
              <div><span class="adm-quarter-week__num">W${week.number}</span><b>${esc(fmtDate(week.startDate))} — ${esc(fmtDate(week.endDate))}</b></div>
              <span class="muted">${count ? plural(count, 'результат', 'результата', 'результатов') : 'пока пусто'}</span>
              <a class="adm-btn adm-btn--primary" href="#/week/${encodeURIComponent(week.id)}">Редактировать</a>
            </article>`;
          }).join('')}</div>`
        : '<p class="muted">Недели появятся после начала периода.</p>'}
    </section>`;
}
