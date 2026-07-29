import { esc, fmtDateFull, plural, safeUrl } from '../../ui/helpers.js';

const TYPE = {
  server_capture: 'Захват сервера',
  war: 'Война',
  merge: 'Слияние',
  other: 'Событие',
};

/**
 * Хронология.
 *
 * Тот же набор событий, что показывает вкладка «Хронология» на сайте,
 * но в служебном виде: видно тип, номер сервера и длительность — то есть
 * ровно те поля, которые во второй фазе станут полями формы.
 */
export function renderEvents(view) {
  const { data } = view;
  const events = [...data.events].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const captures = events.filter((e) => e.type === 'server_capture');

  if (!events.length) {
    return `
      <section class="adm-hero adm-hero--tight">
        <span class="eyebrow">Летопись</span>
        <h1 class="adm-h1">Хронология</h1>
      </section>
      <section class="panel">
        <p class="muted">
          Событий пока нет — поэтому вкладка «Хронология» на сайте сообщает,
          что летопись ещё не начата. Первая запись появится здесь же.
        </p>
      </section>`;
  }

  const list = events
    .map(
      (e) => `<li class="adm-ev adm-ev--${esc(e.type)}">
        <div class="adm-ev__mark">${e.serverNumber != null ? esc(String(e.serverNumber)) : '•'}</div>
        <div class="adm-ev__body">
          <div class="adm-ev__meta">
            <span class="adm-ev__type">${esc(TYPE[e.type] ?? TYPE.other)}</span>
            <time>${esc(fmtDateFull(e.date))}</time>
            ${e.durationDays ? `<span class="muted">${plural(e.durationDays, 'день', 'дня', 'дней')}</span>` : ''}
            <code class="adm-mono adm-ev__id">${esc(e.id)}</code>
          </div>
          <b>${esc(e.title)}</b>
          ${e.body ? `<p class="muted">${esc(e.body)}</p>` : ''}
          ${
            safeUrl(e.imageUrl)
              ? `<a class="adm-ev__img" href="${esc(safeUrl(e.imageUrl))}"
                    target="_blank" rel="noopener noreferrer">картинка</a>`
              : ''
          }
        </div>
      </li>`
    )
    .join('');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Летопись</span>
      <h1 class="adm-h1">Хронология</h1>
      <p class="adm-lead">
        ${plural(events.length, 'запись', 'записи', 'записей')}
        <span class="adm-dot">·</span>
        ${plural(captures.length, 'сервер взят', 'сервера взято', 'серверов взято')}
      </p>
    </section>

    <section class="panel">
      <ul class="adm-evs">${list}</ul>
    </section>`;
}
