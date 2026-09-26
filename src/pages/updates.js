/**
 * ПУЛЬС ОБНОВЛЕНИЙ ИГРЫ — разметка.
 *
 * Чистые функции: получили состояние, вернули строку; поведение — в
 * src/forum/updates.js. Тот же раздел, что у остальных страниц: строку можно
 * прочитать и проверить без браузера.
 *
 * ПОЧЕМУ ЗДЕСЬ ЕСТЬ ФОРМА, А В ПАНЕЛИ ЕЁ НЕТ.
 *
 * Форму пишет модерация, а модератор — это игрок с тем же входом, что у
 * форума: права ему выдаёт база, и вход через панель ничего к ним не добавляет.
 * Разницы между «заметку положил модератор» и «заметку положил кто-то из
 * панели» для читателя нет вовсе, а для нас она есть: экран панели в черновом
 * режиме не проверяется вообще (её вход уходит в боевую базу), и правило,
 * которое нельзя посмотреть вживую, неизбежно разъезжается с базой. Поэтому
 * форма живёт здесь, где её видит и человек, и проверка.
 *
 * ПОЧЕМУ У ЗАМЕТКИ НЕТ ПРАВКИ.
 *
 * Кнопки «изменить» на этой странице нет, и это не экономия: заметка —
 * датированное свидетельство о чужом тексте, а текст, который можно переписать
 * молча, перестаёт им быть. Ошибка — это «в архив» и новая заметка.
 */
import { esc } from '../ui/helpers.js';
import { UPDATE_KINDS, updateKindLabel } from '../forum/rules.js';
import { localInputValue } from '../forum/event-format.js';
import { CONFIG } from '../../config.js';

const LONG_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** Дата первоисточника: полностью и с годом — возраст изменения и есть ответ. */
export function updateDate(at) {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? '' : LONG_DATE.format(d);
}

/**
 * Ссылка на первоисточник.
 *
 * Отдельно от общего safeUrl, и намеренно строже: тот пропускает http, а здесь
 * http быть не может — база такой адрес просто не примет. Раз страница печатает
 * href как есть, второй рубеж обязан стоять в разметке: одна строка в базе,
 * пропущенная мимо формы, не должна оборачиваться чужим кодом в браузере
 * читателя.
 */
function sourceHref(url) {
  const s = String(url ?? '').trim();
  return /^https:\/\//i.test(s) ? s : '';
}

/**
 * Каталог заметок отсутствует: база без миграции отвечает текстом про
 * `forum_update_note_list`. Имя файла полезнее абстрактного «не загрузилось»
 * — человек, который сам прогоняет SQL, поймёт, что делать.
 */
function migrationHint(error) {
  const text = String(error ?? '');
  return /forum_update_note|relation .* does not exist|does not exist$/i.test(text)
    ? 'Похоже, заметок ещё нет в базе: прогоните supabase/20260926-update-pulse.sql в SQL-редакторе.'
    : '';
}

/**
 * Форма модерации. Развёрнута только когда её позвали: семь полей над списком
 * съедали бы половину экрана телефона, а список человек открывает именно за
 * ним.
 */
function renderForm(s) {
  const L = CONFIG.forum.limits;
  const now = s.now ?? Date.now();
  const kinds = UPDATE_KINDS.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('');
  const hints = UPDATE_KINDS.map((k) => `${k.label} — ${k.hint}`).join(' · ');
  const maxDay = localInputValue(new Date(now + L.updateFutureGraceMinutes * 60 * 1000));
  const minDay = `${L.updateSourceYearFloor}-01-01T00:00`;

  return `
    <form class="upd-form" data-upd-form novalidate>
      <p class="upd-form__lead">
        Заметку видит весь форум сразу после публикации, и поменять её нельзя:
        ошиблись — уберите в архив и напишите новую.
      </p>

      <label class="upd-field">
        <span>Что это</span>
        <select name="kind">${kinds}</select>
        <small class="muted">${esc(hints)}</small>
      </label>

      <label class="upd-field">
        <span>Заголовок</span>
        <input name="title" type="text" maxlength="${L.updateTitleMax}"
               placeholder="Перечисление карт вышло из ротации" autocomplete="off" required>
      </label>

      <label class="upd-field">
        <span>Что изменилось</span>
        <textarea name="summary" rows="4" maxlength="${L.updateSummaryMax}"
                  placeholder="Своими словами и на несколько строк: что именно и кого это касается."></textarea>
        <small class="muted">
          От ${L.updateSummaryMin} символов: «обновили игру» — это заголовок, а не заметка.
        </small>
      </label>

      <div class="upd-field-row">
        <label class="upd-field">
          <span>Источник</span>
          <input name="sourceName" type="text" maxlength="${L.updateSourceNameMax}"
                 placeholder="Официальный сайт" autocomplete="off" required>
        </label>
        <label class="upd-field">
          <span>Версия игры</span>
          <input name="gameVersion" type="text" maxlength="${L.updateVersionMax}"
                 placeholder="если названа" autocomplete="off">
        </label>
      </div>

      <label class="upd-field">
        <span>Ссылка на первоисточник</span>
        <input name="sourceUrl" type="url" maxlength="${L.updateUrlMax}"
               placeholder="https://…" autocomplete="off" required>
      </label>

      <label class="upd-field">
        <span>Когда это вышло у источника</span>
        <input name="sourceAt" type="datetime-local" max="${maxDay}" min="${minDay}" required>
        <small class="muted">Дата у первоисточника, а не сегодня: список отвечает на вопрос «давно ли».</small>
      </label>

      <p class="upd-form__actions">
        <button type="submit" class="forum-btn forum-btn--primary">Опубликовать заметку</button>
        <button type="button" class="forum-btn" data-upd-cancel>Отменить</button>
      </p>
      <p class="upd-error" data-upd-error hidden></p>
    </form>`;
}

/**
 * @param {{id: string, kind: string, title: string, summary: string,
 *          sourceName: string, sourceUrl: string, sourceAt: Date,
 *          gameVersion: string, authorNick?: string, archivedByNick?: string,
 *          archivedAt?: Date|null}} note
 */
function renderCard(note, s) {
  const href = sourceHref(note.sourceUrl);
  const archived = note.status === 'archived';
  const action = archived
    ? { attr: 'upd-restore', label: 'вернуть в список' }
    : { attr: 'upd-archive', label: 'убрать в архив' };

  return `
    <article class="upd-card${archived ? ' upd-card--archived' : ''}">
      <header class="upd-card__head">
        <span class="upd-kind upd-kind--${esc(note.kind)}">${esc(updateKindLabel(note.kind))}</span>
        <time class="upd-card__date" datetime="${esc(new Date(note.sourceAt).toISOString())}">${esc(updateDate(note.sourceAt))}</time>
        ${note.gameVersion ? `<span class="upd-card__version">${esc(note.gameVersion)}</span>` : ''}
      </header>
      <h2 class="upd-card__title">${esc(note.title)}</h2>
      <p class="upd-card__text">${esc(note.summary)}</p>
      <footer class="upd-card__foot">
        ${href
          ? `<a class="upd-card__source" href="${esc(href)}" target="_blank" rel="noreferrer noopener nofollow">${esc(note.sourceName)} ↗</a>`
          : `<span class="upd-card__source upd-card__source--broken" title="Ссылка не на https-адрес, поэтому она не открылась">${esc(note.sourceName)}</span>`}
        <span class="upd-card__by">от ${esc(note.authorNick || 'модерации')}</span>
        ${s.canManage
          ? `<button type="button" class="upd-card__action" data-${action.attr}="${esc(note.id)}">${esc(action.label)}</button>`
          : ''}
      </footer>
      ${archived && note.archivedAt
        ? `<p class="upd-card__was">Убрана ${esc(updateDate(note.archivedAt))}${note.archivedByNick ? ` — ${esc(note.archivedByNick)}` : ''}</p>`
        : ''}
    </article>`;
}

/**
 * @param {{ready: boolean, shared: boolean, sourceName: string, me: any,
 *          canManage: boolean, notes: any[], loading: boolean, error: string,
 *          composing: boolean, now?: number}} s
 */
export function renderUpdates(s) {
  const notes = Array.isArray(s.notes) ? s.notes : [];
  const published = notes.filter((n) => n.status === 'published');
  const archived = notes.filter((n) => n.status === 'archived');
  const lim = CONFIG.forum.limits;

  const body = !s.ready
    ? '<p class="upd-none">Форум ещё не подключён — список появится вместе с ним.</p>'
    : s.loading
      ? '<p class="upd-none">Загружаем заметки…</p>'
      : s.error
        ? `<p class="upd-none">Список не открылся: ${esc(s.error)}</p>
           ${migrationHint(s.error) ? `<p class="upd-none">${esc(migrationHint(s.error))}</p>` : ''}`
        : `${published.length
          ? published.map((n) => renderCard(n, s)).join('')
          : `<p class="upd-none">
              Заметок пока нет. Здесь не будет «горячих» пересказов и выдуманных
              изменений: форум не читает чужие страницы сам, каждую заметку
              руками кладёт модерация и оставляет ссылку на первоисточник.
            </p>`}${
          s.canManage && archived.length
            ? `<section class="upd-archived">
                 <h2 class="upd-archived__head">Убрано из списка · ${archived.length}</h2>
                 <p class="muted">Архив видите только вы: устаревшая заметка читателю
                   врёт, а тому, кто ведёт список, объясняет решение.</p>
                 ${archived.map((n) => renderCard(n, s)).join('')}
               </section>`
            : ''
        }`;

  return `
    <section class="panel upd-page">
      <header class="panel__head">
        <span class="eyebrow">Пульс обновлений</span>
        <h1>Что изменилось в игре</h1>
        <p class="muted">
          Короткие заметки о патчах, объявлениях и признанных проблемах. У каждой —
          дата первоисточника и ссылка на него: пересказ можно проверить.
        </p>
      </header>

      ${s.canManage && !s.composing
        ? `<p class="upd-new"><button type="button" class="forum-btn forum-btn--primary" data-upd-new>Добавить заметку</button></p>`
        : ''}
      ${s.canManage && s.composing ? renderForm(s) : ''}

      ${body}

      <footer class="upd-page__foot">
        <p class="muted">
          Ни одна заметка не появляется сама: форум не подгружает чужие
          страницы, не переводит их без живой редакции и не выдумывает
          изменений. В списке не больше ${lim.updateListMax} последних заметок,
          а разговор о любой перемене — <a href="#/forum">на форуме</a>.
        </p>
        ${!s.shared && s.ready
          ? `<p class="upd-note">Черновой режим: заметки лежат в этом браузере и никуда не уходят.</p>`
          : ''}
      </footer>
    </section>`;
}
