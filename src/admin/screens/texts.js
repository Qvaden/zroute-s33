import { esc, plural, miniMarkdown } from '../../ui/helpers.js';
import { textsFromRaw, textsDiff, KNOWN_TEXT_KEYS } from '../edit.js';

/**
 * Тексты сайта.
 *
 * Здесь лежит всё, что человек читает на сайте словами: гайд для малых
 * альянсов, ритм недели, «о сайте». Именно эта вкладка делает утверждение
 * «сайтом управляют из панели» правдой, а не преувеличением: без неё
 * любая правка текста оставалась бы работой для разработчика.
 *
 * Устройство то же, что у альянсов: форма добавления и правки сверху,
 * черновик — весь список целиком, публикация одним коммитом после проверки
 * тем же валидатором, что и сайт.
 *
 * Единственное, что здесь физически защищено интерфейсом, — ключ.
 * Страница src/pages/guide.js ищет тексты по точному ключу
 * (`guide-intro`, `guide-principles`…); переименовать его вручную — не
 * переименовать раздел, а молча потерять его на сайте. Поэтому ключ вводится
 * только при создании, а при правке существующего текста — только показан.
 *
 * В отличие от альянсов, удаление здесь ничем не рискует: пропавший текст
 * — это просто раздел сайта, который тихо перестанет показываться, а не
 * сломанная ссылка на результат. Поэтому кнопка «Удалить» есть всегда.
 */
export function renderTexts(view) {
  const { raw, canPush } = view;

  const list = view.texts ?? textsFromRaw(raw);
  const form = view.textDraft ?? null;
  const diff = textsDiff(raw, list);

  const sorted = [...list].sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  const listHtml = sorted.map((t) => row(t, canPush)).join('');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Содержание сайта</span>
      <h1 class="adm-h1">Тексты</h1>
      <p class="adm-lead">${plural(list.length, 'блок', 'блока', 'блоков')} — всё, что на сайте написано словами</p>
    </section>

    ${renderForm(form, canPush)}

    <section class="panel" data-texts-form>
      <header class="panel__head adm-head-row">
        <h2>Список</h2>
        ${canPush ? '<button type="button" class="adm-btn" data-text-new>Добавить текст</button>' : ''}
      </header>

      ${
        canPush
          ? ''
          : `<p class="adm-warn">У токена нет права на запись — список можно только смотреть.
               Нужно право «Contents: Read and write».</p>`
      }

      ${
        sorted.length
          ? `<div class="adm-texts">${listHtml}</div>
             <p class="muted adm-note">
               Форматирование простое: <code class="adm-mono">## Заголовок</code> делает новую карточку,
               <code class="adm-mono">- пункт</code> — список, <code class="adm-mono">**жирный**</code> — выделение.
               Предпросмотр внутри карточки нарисован тем же кодом, что и сайт.
             </p>`
          : `<p class="muted adm-note">Текстов нет. Разделы сайта, которые берут текст из данных, откроются пустыми.</p>`
      }

      <div class="adm-publish">
        <div class="adm-publish__state">${describeTexts(diff, view.textsSaved)}</div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn" data-texts-reset
                  ${diff.total ? '' : 'disabled'}>Сбросить</button>
          <button type="button" class="adm-btn adm-btn--primary" data-texts-publish
                  ${diff.total && canPush ? '' : 'disabled'}>Опубликовать</button>
        </div>
      </div>

      <div class="adm-result" data-texts-result hidden></div>
    </section>`;
}

/** Карточка текста в списке — тот же предпросмотр, что рисовала read-only версия. */
function row(t, canPush) {
  return `<details class="adm-text" data-text-row="${esc(t.key)}">
    <summary>
      <code class="adm-mono">${esc(t.key)}</code>
      <b>${esc(t.title || 'без заголовка')}</b>
      <span class="muted">${plural(t.body.length, 'символ', 'символа', 'символов')}</span>
    </summary>
    <div class="adm-text__body prose">${miniMarkdown(t.body)}</div>
    ${
      canPush
        ? `<div class="adm-text__acts">
             <button type="button" class="adm-btn" data-text-edit="${esc(t.key)}">Правка</button>
             <button type="button" class="adm-btn" data-text-delete="${esc(t.key)}">Удалить</button>
           </div>`
        : ''
    }
  </details>`;
}

/**
 * Форма добавления и правки. Появляется только когда что-то правят —
 * как и везде в панели.
 */
function renderForm(form, canPush) {
  if (!form || !canPush) return '';

  const isNew = form.originalKey === null;

  return `
    <section class="panel adm-form" data-text-form>
      <header class="panel__head adm-head-row">
        <h2>${isNew ? 'Новый текст' : `Правка текста ${esc(form.originalKey)}`}</h2>
        <button type="button" class="adm-btn" data-text-cancel>Отмена</button>
      </header>

      ${
        isNew
          ? `<label class="adm-field">
               <span>Ключ</span>
               <input type="text" data-text-field="key" value="${esc(form.key)}"
                      list="adm-known-text-keys" placeholder="Например, guide-intro" autocomplete="off">
             </label>
             <datalist id="adm-known-text-keys">
               ${KNOWN_TEXT_KEYS.map((k) => `<option value="${esc(k)}"></option>`).join('')}
             </datalist>
             <p class="adm-form__hint muted">
               Сайт сейчас ищет: ${KNOWN_TEXT_KEYS.map((k) => `<code class="adm-mono">${esc(k)}</code>`).join(', ')}.
               Другой ключ не сломает публикацию, но и не появится ни на одной странице сайта.
             </p>`
          : `<p class="adm-form__hint muted">
               Ключ <code class="adm-mono">${esc(form.originalKey)}</code> не меняется никогда — это то,
               что ищет на странице код сайта. Переименовать вручную значит молча потерять раздел.
             </p>`
      }

      <label class="adm-field">
        <span>Заголовок</span>
        <input type="text" data-text-field="title" value="${esc(form.title)}" placeholder="Необязательно">
      </label>

      <label class="adm-field">
        <span>Текст</span>
        <textarea rows="10" data-text-field="body"
                  placeholder="## Заголовок карточки — списки через «- », жирный через **так**">${esc(form.body)}</textarea>
      </label>

      <div class="adm-result adm-result--bad" data-text-problems hidden></div>

      <div class="adm-publish">
        <div class="adm-publish__state muted">
          Текст добавится в список. На сайт он попадёт после «Опубликовать».
        </div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn adm-btn--primary" data-text-save>
            ${isNew ? 'Добавить в список' : 'Сохранить в списке'}
          </button>
        </div>
      </div>
    </section>`;
}

/** Что именно уйдёт в коммит, словами. Удаление — всегда вслух, даже когда оно безопасно. */
export function describeTexts(diff, savedAt) {
  if (!diff.total) return '<span class="muted">Изменений нет — опубликовать нечего.</span>';

  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'новый блок', 'новых блока', 'новых блоков'));
  if (diff.changed) parts.push(plural(diff.changed, 'правка', 'правки', 'правок'));
  if (diff.removed) {
    parts.push(`<b class="adm-danger">удалится ${plural(diff.removed, 'блок', 'блока', 'блоков')}</b>`);
  }

  const when = savedAt
    ? ` <span class="muted">· черновик сохранён в браузере ${savedAt.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })}</span>`
    : '';

  return `К публикации: ${parts.join(', ')}${when}`;
}
