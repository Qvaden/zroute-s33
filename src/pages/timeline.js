import { esc, fmtDateFull, plural } from '../ui/helpers.js';

const TYPE_LABEL = {
  server_capture: 'Захват сервера',
  war: 'Война',
  merge: 'Слияние',
  other: 'Событие',
};

/**
 * Хронология: «прикольно будет смотреть, когда какой сервер был побеждён».
 * Лента по датам, свежее сверху.
 */
export function renderTimeline({ events }) {
  if (!events.length) {
    return `<section class="panel"><p class="muted">Событий пока не внесено.</p></section>`;
  }

  const captured = events.filter((e) => e.type === 'server_capture').length;

  const items = events
    .map(
      (e) => `
      <li class="tl__item tl__item--${esc(e.type)}">
        <div class="tl__marker">${e.serverNumber != null ? esc(String(e.serverNumber)) : '•'}</div>
        <div class="tl__body">
          <div class="tl__meta">
            <span class="tl__type">${esc(TYPE_LABEL[e.type] ?? TYPE_LABEL.other)}</span>
            <time>${fmtDateFull(e.date)}</time>
          </div>
          <h3>${esc(e.title)}</h3>
          ${e.body ? `<p>${esc(e.body)}</p>` : ''}
          ${
            e.imageUrl
              ? `<img class="tl__img" src="${esc(e.imageUrl)}" alt="${esc(e.title)}" loading="lazy">`
              : ''
          }
        </div>
      </li>`
    )
    .join('');

  return `
    <section class="panel">
      <header class="panel__head">
        <h2>Хронология</h2>
        <p class="muted">${plural(captured, 'сервер захвачен', 'сервера захвачено', 'серверов захвачено')}</p>
      </header>
      <ul class="tl">${items}</ul>
    </section>`;
}
