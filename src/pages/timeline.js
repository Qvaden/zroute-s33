import { esc, fmtDate, fmtDateFull, plural, pluralWord, safeUrl } from '../ui/helpers.js';
import { EVENT_TYPE, EVENT_TYPE_ORDER, serverEvents, verdictText, pillText } from '../logic/event-types.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Хронология: «прикольно будет смотреть, когда какой Капитолий был взят».
 *
 * Сверху крупно — что делал сервер последним: брал чужой Капитолий или отбивал
 * свой. Ниже стена трофеев с номерами взятых серверов, а за ней лента событий
 * для тех, кому нужны детали.
 */
export function renderTimeline({ events }) {
  /*
    Серверные события — захваты и защиты — это то, за чем на эту вкладку
    и заходят. Они живут среди обычных событий, а не у недели: кампания может
    тянуться через несколько недель, и один и тот же захват не должен
    записываться в двух местах.
  */
  const server = serverEvents(events ?? []);

  if (!events.length) {
    return `
      <section class="hero hero--tl">
        <span class="eyebrow">Хроника завоеваний</span>
        <h2 class="tl__title">Ещё ни одной записи</h2>
        <p class="guide__sub">
          Здесь будет летопись сервера: чьи Капитолии забрали и как отбивали свой,
          взятые Капитолии крупными плитками и события по датам — войны, слияния
          альянсов, всё, что стоит запомнить. Первая запись появится, как только
          её внесут.
        </p>
      </section>`;
  }

  const sorted = [...events].sort((a, b) => b.date - a.date);
  const captures = sorted.filter((e) => e.type === 'server_capture');

  return `
    ${renderServerSection(server)}
    ${captures.length || sorted.length ? renderTrophies(captures, sorted) : ''}
    ${sorted.length ? renderFilters(sorted) : ''}
    ${sorted.length ? renderFeed(sorted) : ''}
    <p class="tl__empty" data-tl-empty hidden>Событий такого типа пока нет.</p>`;
}

/** «2026-09» — ключ месяца, по которому фильтрует скрипт. */
const ymKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const MONTH_NAME = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * ЧТО ДЕЛАЛ СЕРВЕР — крупный вердикт и летопись под ним.
 *
 * Вердикт показывает не обязательно последнее событие: по нажатию на любую
 * плашку он переключается на неё. Календарь (год → месяц) фильтрует и плашки,
 * и ленту событий ниже — «сентябрь» означает сентябрь везде.
 *
 * Все вердикты отрисованы сразу и спрятаны, а скрипт только переключает
 * видимость. Причина не в лени: так страница работает и в собранном одним
 * файлом превью, где данных для перерисовки нет вовсе.
 */
function renderServerSection(list) {
  if (!list.length) return '';

  const cards = list
    .map((e, i) => {
      const m = EVENT_TYPE[e.type];
      return `
        <div class="verdict verdict--${m.kind}" data-tl-verdict="${esc(e.id)}" ${i === 0 ? '' : 'hidden'}>
          <div class="verdict__week">
            <span>${esc(MONTH_SHORT[e.date.getUTCMonth()])}</span>
            <b class="num">${e.date.getUTCDate()}</b>
          </div>
          <div class="verdict__body">
            <h2 class="verdict__text">${esc(verdictText(e.type, e.serverNumber))}</h2>
            <p class="verdict__dates">
              ${esc(fmtDateFull(e.date))}
              ${e.durationDays ? `<span class="hero__sep">·</span> ${plural(e.durationDays, 'день', 'дня', 'дней')}` : ''}
            </p>
          </div>
        </div>`;
    })
    .join('');

  const years = [...new Set(list.map((e) => e.date.getUTCFullYear()))].sort((a, b) => b - a);
  const months = [...new Set(list.map((e) => ymKey(e.date)))].sort().reverse();

  const yearChips = years
    .map((y) => `<button type="button" class="cal__btn" data-tl-yr="${y}">${y}</button>`)
    .join('');

  const monthChips = months
    .map((ym) => {
      const label = MONTH_NAME[Number(ym.slice(5, 7)) - 1];
      return `<button type="button" class="cal__btn" data-tl-mo="${ym}" hidden>${esc(label)}</button>`;
    })
    .join('');

  /*
    Подпись плашки собирает словарь: у атаки и у защиты номер значит разное,
    и «отбились от 51» нельзя склеить теми же кусками, что «взяли 74».
  */
  const pills = list
    .map((e) => {
      const m = EVENT_TYPE[e.type];
      return `<li>
        <button type="button" class="wk wk--${m.kind} wk--${m.action}"
                data-tl-week="${esc(e.id)}" data-tl-ym="${ymKey(e.date)}"
                title="${esc(fmtDateFull(e.date))}">
          <span class="wk__num num">${esc(fmtDate(e.date))}</span>
          <span class="wk__what">${esc(pillText(e.type, e.serverNumber))}</span>
        </button>
      </li>`;
    })
    .join('');

  return `
    <section class="hero hero--tl">
      <span class="eyebrow">Что делал сервер</span>

      ${cards}

      <div class="cal">
        <span class="cal__label">Найти запись</span>
        <div class="cal__row">
          <button type="button" class="cal__btn is-on" data-tl-yr="all">За всё время</button>
          ${yearChips}
        </div>
        <!-- Скрыт до выбора года: иначе до первого запуска скрипта здесь
             висела бы пустая строка с отступом. -->
        <div class="cal__row cal__row--mo" data-tl-months hidden>${monthChips}</div>
      </div>

      <ul class="wks">${pills}</ul>
      <p class="wks__empty" data-tl-noweeks hidden>В этом месяце записей нет.</p>
    </section>`;
}

/** Стена трофеев: захваченные серверы крупными плитками. */
function renderTrophies(captures, all) {
  const durations = all.map((e) => e.durationDays).filter((d) => typeof d === 'number');
  const capDurations = captures.map((e) => e.durationDays).filter((d) => typeof d === 'number');

  const first = all[all.length - 1].date;
  const last = all[0].date;
  const months = Math.max(1, Math.round((last - first) / (1000 * 60 * 60 * 24 * 30.4)));

  // Число выводится отдельно и крупно, поэтому в подписи его быть не должно —
  // иначе получается «10 · 10 месяцев истории».
  const fastest = capDurations.length ? Math.min(...capDurations) : null;
  const longest = capDurations.length ? Math.max(...capDurations) : null;

  const stats = [
    {
      value: captures.length,
      label: pluralWord(captures.length, 'Капитолий взят', 'Капитолия взято', 'Капитолиев взято'),
    },
    {
      value: months,
      label: pluralWord(months, 'месяц истории', 'месяца истории', 'месяцев истории'),
    },
    fastest !== null
      ? { value: fastest, label: `${pluralWord(fastest, 'день', 'дня', 'дней')} — самый быстрый` }
      : null,
    longest !== null && longest !== fastest
      ? { value: longest, label: `${pluralWord(longest, 'день', 'дня', 'дней')} — самый долгий` }
      : null,
  ].filter(Boolean);

  // Трофеи в хронологическом порядке: приятнее читать как летопись.
  const tiles = [...captures]
    .sort((a, b) => a.date - b.date)
    .map(
      (e, i) => `<div class="trophy" style="--i:${i}">
        <span class="trophy__num num">${e.serverNumber ?? '?'}</span>
        <span class="trophy__date">${MONTH_SHORT[e.date.getUTCMonth()]} ${String(e.date.getUTCFullYear()).slice(2)}</span>
        ${e.durationDays ? `<span class="trophy__days">${plural(e.durationDays, 'день', 'дня', 'дней')}</span>` : ''}
      </div>`
    )
    .join('');

  return `
    <section class="hero hero--tl">
      <span class="eyebrow">Хроника завоеваний</span>
      <h2 class="tl__title">Чьи Капитолии забрали</h2>

      <div class="tl__stats">
        ${stats
          .map(
            (s) => `<div class="tl__stat">
              <b class="num">${s.value}</b><span>${s.label}</span>
            </div>`
          )
          .join('')}
      </div>

      ${tiles ? `<div class="trophies">${tiles}</div>` : ''}
    </section>`;
}

function renderFilters(events) {
  const present = [...new Set(events.map((e) => e.type))];
  const buttons = EVENT_TYPE_ORDER
    .filter((t) => present.includes(t))
    .map(
      (t) => `<button type="button" class="seg__btn" data-tl-filter="${t}">${esc(EVENT_TYPE[t].filter)}</button>`
    )
    .join('');

  return `<div class="ctl ctl--tl">
    <div class="seg" role="group" aria-label="Тип события">
      <button type="button" class="seg__btn is-on" data-tl-filter="all">Все</button>
      ${buttons}
    </div>
  </div>`;
}

function renderFeed(events) {
  let lastYear = null;
  const items = events
    .map((e) => {
      const year = e.date.getUTCFullYear();
      const divider =
        year !== lastYear ? `<li class="tl__year" data-tl-year="${year}"><span>${year}</span></li>` : '';
      lastYear = year;

      const t = EVENT_TYPE[e.type] ?? EVENT_TYPE.other;

      return `${divider}
      <li class="tl__item tl__item--${esc(e.type)}" data-tl-type="${esc(e.type)}"
          data-tl-ym="${ymKey(e.date)}">
        <div class="tl__marker">${e.serverNumber != null ? esc(String(e.serverNumber)) : '•'}</div>
        <div class="tl__body">
          <div class="tl__meta">
            <span class="tl__type">${esc(t.label)}</span>
            <time>${fmtDateFull(e.date)}</time>
            ${e.durationDays ? `<span class="tl__dur">${plural(e.durationDays, 'день', 'дня', 'дней')}</span>` : ''}
          </div>
          <h3>${esc(e.title)}</h3>
          ${e.body ? `<p>${esc(e.body)}</p>` : ''}
          ${
            safeUrl(e.imageUrl)
              ? `<img class="tl__img" src="${esc(safeUrl(e.imageUrl))}" alt="${esc(e.title)}" loading="lazy">`
              : ''
          }
        </div>
      </li>`;
    })
    .join('');

  return `<section class="panel">
    <ul class="tl" data-tl-list>${items}</ul>
  </section>`;
}
