import { esc, fmtDateFull, plural, pluralWord } from '../ui/helpers.js';

const TYPE = {
  server_capture: { label: 'Захват сервера', short: 'Захваты' },
  war:            { label: 'Война',          short: 'Войны' },
  merge:          { label: 'Слияние',        short: 'Слияния' },
  other:          { label: 'Событие',        short: 'Прочее' },
};

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Хронология: «прикольно будет смотреть, когда какой сервер был побеждён».
 *
 * Поэтому главный элемент страницы — не лента, а стена трофеев: крупные
 * номера захваченных серверов. Лента идёт следом, для тех, кому нужны детали.
 */
export function renderTimeline({ events }) {
  if (!events.length) {
    return `<section class="panel"><p class="muted">Событий пока не внесено.</p></section>`;
  }

  const sorted = [...events].sort((a, b) => b.date - a.date);
  const captures = sorted.filter((e) => e.type === 'server_capture');

  return `
    ${renderTrophies(captures, sorted)}
    ${renderFilters(sorted)}
    ${renderFeed(sorted)}
    <p class="tl__empty" data-tl-empty hidden>Событий такого типа пока нет.</p>`;
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
      label: pluralWord(captures.length, 'сервер взят', 'сервера взято', 'серверов взято'),
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
      <h2 class="tl__title">Кого мы забрали</h2>

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
  const order = ['server_capture', 'war', 'merge', 'other'];
  const buttons = order
    .filter((t) => present.includes(t))
    .map(
      (t) => `<button type="button" class="seg__btn" data-tl-filter="${t}">${TYPE[t].short}</button>`
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

      const t = TYPE[e.type] ?? TYPE.other;

      return `${divider}
      <li class="tl__item tl__item--${esc(e.type)}" data-tl-type="${esc(e.type)}">
        <div class="tl__marker">${e.serverNumber != null ? esc(String(e.serverNumber)) : '•'}</div>
        <div class="tl__body">
          <div class="tl__meta">
            <span class="tl__type">${esc(t.label)}</span>
            <time>${fmtDateFull(e.date)}</time>
            ${e.durationDays ? `<span class="tl__dur">${plural(e.durationDays, 'день', 'дня', 'дней')}</span>` : ''}
          </div>
          <h3>${esc(e.title)}</h3>
          ${e.body ? `<p>${esc(e.body)}</p>` : ''}
          ${e.imageUrl ? `<img class="tl__img" src="${esc(e.imageUrl)}" alt="${esc(e.title)}" loading="lazy">` : ''}
        </div>
      </li>`;
    })
    .join('');

  return `<section class="panel">
    <ul class="tl" data-tl-list>${items}</ul>
  </section>`;
}
