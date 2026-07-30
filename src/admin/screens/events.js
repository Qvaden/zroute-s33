import { esc, fmtDateFull, plural, safeUrl } from '../../ui/helpers.js';
import { EVENT_TYPE, EVENT_TYPE_ORDER, eventsDiff, eventsFromRaw } from '../edit.js';

/**
 * ХРОНОЛОГИЯ — летопись сервера.
 *
 * Не путать с итогом недели. Итог — недельный счёт: взяли, не взяли, удержали,
 * потеряли; он живёт на экране «Неделя» и заполняется одним нажатием. Событие
 * здесь — веха с рассказом: дата, описание, длительность кампании, картинка.
 * Захват сервера может тянуться через несколько недель, поэтому у события своя
 * дата, а не привязка к неделе.
 *
 * Устройство экрана: одна форма сверху и список снизу. Форма служит и добавлению,
 * и правке — редактировать двенадцать записей прямо в списке значило бы держать
 * на экране сотню полей, из которых нужно одно.
 */
export function renderEvents(view) {
  const { raw, canPush } = view;

  // Рабочий список: черновик, если он есть, иначе то, что в данных.
  const list = view.events ?? eventsFromRaw(raw);
  const form = view.eventDraft ?? null;
  const diff = eventsDiff(raw, list);

  const captures = list.filter((e) => e.type === 'server_capture');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Летопись</span>
      <h1 class="adm-h1">Хронология</h1>
      <p class="adm-lead">
        ${plural(list.length, 'запись', 'записи', 'записей')}
        <span class="adm-dot">·</span>
        ${plural(captures.length, 'сервер взят', 'сервера взято', 'серверов взято')}
      </p>
    </section>

    ${renderForm(form, canPush)}

    <section class="panel" data-events-form>
      <header class="panel__head adm-head-row">
        <h2>Записи</h2>
        ${
          canPush
            ? '<button type="button" class="adm-btn" data-event-new>Добавить запись</button>'
            : ''
        }
      </header>

      ${
        canPush
          ? ''
          : `<p class="adm-warn">У токена нет права на запись — летопись можно только смотреть.
               Нужно право «Contents: Read and write».</p>`
      }

      ${list.length ? `<ul class="adm-evs">${list.map((e) => row(e, canPush)).join('')}</ul>` : empty()}

      <div class="adm-publish">
        <div class="adm-publish__state">${describeEvents(diff, view.eventsSaved)}</div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn" data-events-reset
                  ${diff.total ? '' : 'disabled'}>Сбросить</button>
          <button type="button" class="adm-btn adm-btn--primary" data-events-publish
                  ${diff.total && canPush ? '' : 'disabled'}>Опубликовать</button>
        </div>
      </div>

      <div class="adm-result" data-events-result hidden></div>
    </section>`;
}

function empty() {
  return `<p class="muted adm-note">
    Записей пока нет — поэтому вкладка «Хронология» на сайте показывает только
    итоги недель. Добавьте первую: войну, слияние альянсов или захват сервера
    с рассказом, как он прошёл.
  </p>`;
}

/** Строка списка. Правка и удаление — рядом, потому что ищут их вместе. */
function row(e, canPush) {
  return `<li class="adm-ev adm-ev--${esc(e.type)}" data-event-row="${esc(e.id)}">
    <div class="adm-ev__mark">${e.serverNumber != null ? esc(String(e.serverNumber)) : '•'}</div>
    <div class="adm-ev__body">
      <div class="adm-ev__meta">
        <span class="adm-ev__type">${esc(EVENT_TYPE[e.type] ?? EVENT_TYPE.other)}</span>
        <time>${esc(fmtDateFull(new Date(e.date)))}</time>
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
    ${
      canPush
        ? `<div class="adm-ev__acts">
             <button type="button" class="adm-btn" data-event-edit="${esc(e.id)}">Правка</button>
             <button type="button" class="adm-btn" data-event-delete="${esc(e.id)}">Удалить</button>
           </div>`
        : ''
    }
  </li>`;
}

/**
 * Форма добавления и правки.
 *
 * Появляется только когда что-то правят: пустая форма, висящая всё время,
 * заставляет искать список глазами под ней.
 */
function renderForm(form, canPush) {
  if (!form || !canPush) return '';

  const isNew = !form.id;
  const types = EVENT_TYPE_ORDER.map(
    (t) => `<button type="button" class="adm-chip ${form.type === t ? 'is-on' : ''}"
              data-event-type="${t}">${esc(EVENT_TYPE[t])}</button>`
  ).join('');

  return `
    <section class="panel adm-form" data-event-form>
      <header class="panel__head adm-head-row">
        <h2>${isNew ? 'Новая запись' : `Правка записи ${esc(form.id)}`}</h2>
        <button type="button" class="adm-btn" data-event-cancel>Отмена</button>
      </header>

      <label class="adm-field"><span>Тип</span></label>
      <div class="adm-weeks adm-types">${types}</div>

      <div class="adm-grid2">
        <label class="adm-field">
          <span>Дата</span>
          <input type="date" data-event-field="date" value="${esc(form.date)}">
        </label>
        <label class="adm-field">
          <span>Номер сервера</span>
          <input type="number" inputmode="numeric" min="1" max="9999"
                 data-event-field="serverNumber" value="${esc(form.serverNumber ?? '')}"
                 placeholder="например 74">
        </label>
      </div>

      <label class="adm-field">
        <span>Заголовок</span>
        <input type="text" data-event-field="title" value="${esc(form.title)}"
               placeholder="Захвачен сервер 74">
      </label>

      <label class="adm-field">
        <span>Описание</span>
        <textarea rows="3" data-event-field="body"
                  placeholder="Как всё прошло. Можно оставить пустым.">${esc(form.body)}</textarea>
      </label>

      <div class="adm-grid2">
        <label class="adm-field">
          <span>Сколько дней длилось</span>
          <input type="number" inputmode="numeric" min="1" max="999"
                 data-event-field="durationDays" value="${esc(form.durationDays ?? '')}"
                 placeholder="необязательно">
        </label>
        <label class="adm-field">
          <span>Ссылка на картинку</span>
          <input type="url" data-event-field="imageUrl" value="${esc(form.imageUrl)}"
                 placeholder="https://…">
        </label>
      </div>

      <p class="adm-form__hint muted">
        Захваты с номером сервера попадают на «стену трофеев», а длительность
        сама считает самый быстрый и самый долгий захват.
      </p>

      <div class="adm-result adm-result--bad" data-event-problems hidden></div>

      <div class="adm-publish">
        <div class="adm-publish__state muted">
          Запись добавится в список. На сайт она попадёт после «Опубликовать».
        </div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn adm-btn--primary" data-event-save>
            ${isNew ? 'Добавить в список' : 'Сохранить в списке'}
          </button>
        </div>
      </div>
    </section>`;
}

/** Что уйдёт в коммит, словами. Удаление — всегда вслух. */
export function describeEvents(diff, savedAt) {
  if (!diff.total) return '<span class="muted">Изменений нет — опубликовать нечего.</span>';

  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'новая запись', 'новые записи', 'новых записей'));
  if (diff.changed) parts.push(plural(diff.changed, 'правка', 'правки', 'правок'));
  if (diff.removed) {
    parts.push(`<b class="adm-danger">удалится ${plural(diff.removed, 'запись', 'записи', 'записей')}</b>`);
  }

  const when = savedAt
    ? ` <span class="muted">· черновик сохранён в браузере ${savedAt.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })}</span>`
    : '';

  return `К публикации: ${parts.join(', ')}${when}`;
}
