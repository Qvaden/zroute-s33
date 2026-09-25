/**
 * КАЛЕНДАРЬ ВСТРЕЧ — разметка.
 *
 * Чистые функции: получили состояние, вернули строку; поведение — в
 * src/forum/calendar.js. Тот же раздел, что у остальных страниц, и по той же
 * причине: строку можно прочитать и проверить без браузера.
 *
 * ПОЧЕМУ КАРТОЧКА СОБЫТИЯ ЖИВЁТ ЗДЕСЬ, А НЕ ТОЛЬКО В КАРТОЧКЕ ТЕМЫ.
 *
 * Ответ на приглашение и перенос срока нужны на двух страницах: в календаре,
 * где человек выбирает, куда пойти, и в открытой теме, где он читает анонс и
 * решает там же. Две копии разметки разошлись бы в первый же месяц — одна
 * начала бы называть момент «20:00», другая «в 20:00». Поэтому элементы
 * `eventBadge` и `eventActions` экспортируются, и карточка темы из
 * pages/forum.js зовёт их отсюда.
 *
 * ЧИСЛА УЧАСТНИКОВ ЕСТЬ ТОЛЬКО В КАЛЕНДАРЕ. Карточка темы знает лишь собственный
 * ответ человека (`myRsvp`): счётчики «кто идёт» в ленту не тянут, иначе каждый
 * пост стоил бы двух дополнительных подзапросов на экране, где их никто не
 * смотрит.
 */
import { esc, plural } from '../ui/helpers.js';
import { categoryLabel, EVENT_RSVP, EVENT_TAG_ID } from '../forum/rules.js';
import {
  eventWhen, eventWhenFull, eventCountdown, eventIsPast,
  remindChoices, remindLabel, icsHref, localInputValue,
} from '../forum/event-format.js';
import { CONFIG } from '../../config.js';

/**
 * Виды календаря. Ключи попадают в адрес (`#/calendar?view=mine`), поэтому,
 * как и у разделов форума, переименованию не подлежат: ссылка из чата обязана
 * открываться и через год.
 */
export const CALENDAR_VIEWS = [
  { id: 'next', label: 'Ближайшие' },
  { id: 'mine', label: 'Моё расписание' },
  { id: 'past', label: 'Прошедшие' },
];

/** Дефолтный вид не пишется в адрес: «Ближайшие» — это просто #/calendar. */
export const DEFAULT_CALENDAR_VIEW = 'next';

const DAY = new Intl.DateTimeFormat('ru-RU', { day: '2-digit' });
const MONTH = new Intl.DateTimeFormat('ru-RU', { month: 'short' });
const CLOCK = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });

/** Полдень того же дня — по нему склеиваем строки в группы «Сегодня», «Завтра». */
const startOfDay = (v) => {
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Заголовок дня: «Сегодня», «Завтра», дальше — день недели и число.
 *
 * Относительные слова держим первыми двумя: человек смотрит на календарь
 * вопросом «когда мне идти», а «3 октября» на этой неделе ответ даёт хуже,
 * чем «завтра».
 */
function dayTitle(at, now = Date.now()) {
  const diff = Math.round((startOfDay(at) - startOfDay(now)) / 86400000);
  if (diff <= 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff < 7) return `${WEEKDAY.format(new Date(at))[0].toUpperCase()}${WEEKDAY.format(new Date(at)).slice(1)}, ${DATE.format(new Date(at))}`;
  return DATE.format(new Date(at));
}

/** Собственный ответ: тема знает его как `myRsvp`, строка календаря — как `myStatus`. */
function myAnswer(item) {
  return item.myStatus ?? item.myRsvp ?? null;
}

/**
 * Строка «кто идёт».
 *
 * Имена не показываем нигде: список участников читается как карта составов
 * альянса, и наружу представление отдаёт только количества.
 */
function seatsLine(e) {
  if (e.eventCapacity == null) {
    return `<span class="evt-seats">${plural(Number(e.goingCount || 0), 'человек', 'человека', 'человек')} собирается</span>`;
  }
  const left = Number(e.spotsLeft ?? 0);
  return `
    <span class="evt-seats">
      <b>${e.goingCount}/${e.eventCapacity}</b> мест занято${e.maybeCount ? ` · ещё ${plural(e.maybeCount, 'человек', 'человека', 'человек')} думает` : ''}
      ${left > 0
        ? ` · ${plural(left, 'место', 'места', 'мест')} свободно`
        : '<em class="evt-seats--full">свободных нет</em>'}
    </span>`;
}

/**
 * Кнопки ответа, срок напоминания и перенос.
 *
 * Один элемент на страницу и в карточку темы — см. шапку файла.
 *
 * @param {{id: string, eventAt: Date|string|null, eventCapacity?: number|null, myStatus?: string|null, myRsvp?: string|null, goingCount?: number}} item
 * @param {{me: any, canModerate?: boolean}} s
 */
export function eventActions(item, s) {
  const mine = myAnswer(item);
  /*
    Тема с меткой «Событие» без момента уже существует: метка старше правила,
    и такие темы на форуме заведены. Это не прошедшая встреча, а не названная,
    и смешать их значило бы соврать человеку про тему, на которую он подписался.
  */
  const hasWhen = Boolean(item.eventAt);
  const past = hasWhen && eventIsPast(item.eventAt);
  const isMine = Boolean(s.me) && (s.me.id === item.authorId);
  const canMove = Boolean(s.me) && (isMine || s.me.role === 'admin' || s.me.role === 'moderator');

  if (!s.me) {
    return `
      <div class="evt-actions">
        <p class="evt-login muted">Ответить можно вошедшим: зайдите на <a href="#/forum">форуме</a> и вернитесь сюда.</p>
      </div>`;
  }

  const buttons = EVENT_RSVP.map((r) => `
    <button type="button"
            class="forum-act evt-btn${mine === r.id ? ' is-on' : ''}${r.seats ? ' evt-btn--seat' : ''}"
            data-evt-answer="${esc(item.id)}:${esc(r.id)}"
            aria-pressed="${mine === r.id ? 'true' : 'false'}"
            title="${r.seats ? 'Занимает место в списке' : 'Место не занимает'}">${esc(r.label)}</button>`).join('');

  /*
    Срок напоминания показываем только там, где напоминание имеет смысл: у
    «не приду» будильник звонит в пустоту, а у гостя без ответа его ставить
    некому.
  */
  const remind = mine && mine !== 'declined' && !past
    ? `
      <label class="evt-remind">
        <span>Напомнить</span>
        <select data-evt-remind="${esc(item.id)}">
          <option value="">не напоминать</option>
          ${remindChoices().map((m) => `<option value="${m}"${Number(item.myRemindMinutes) === m ? ' selected' : ''}>${remindLabel(m)}</option>`).join('')}
        </select>
      </label>`
    : '';

  /*
    Перенос живёт под <details>: поле с датой в каждом открытом треде — это
    второй редактор на странице, где человек пришёл читать анонс.
  */
  const move = canMove
    ? `
      <details class="evt-move">
        <summary class="forum-act">Перенести встречу</summary>
        <form class="evt-move__form" data-evt-move="${esc(item.id)}">
          <label class="forum-field">
            <span>Дата и время</span>
            <input type="datetime-local" name="when" required
                   value="${esc(localInputValue(item.eventAt))}"
                   min="${esc(localInputValue(Date.now() + CONFIG.forum.limits.eventMinLeadMinutes * 60000))}"
                   max="${esc(localInputValue(Date.now() + CONFIG.forum.limits.eventHorizonDays * 86400000))}">
          </label>
          <label class="forum-field">
            <span>Мест</span>
            <input type="number" name="seats" min="${CONFIG.forum.limits.eventSeatsMin}" max="${CONFIG.forum.limits.eventSeatsMax}"
                   value="${item.eventCapacity ?? ''}" placeholder="без лимита">
          </label>
          <button type="submit" class="forum-btn forum-btn--sm">Сохранить</button>
        </form>
      </details>`
    : '';

  const answer = !hasWhen
    /*
      Без момента отвечать нельзя: база отвергнет «буду» на встречу, которой
      нет во времени, и человек получит отказ вместо дела. Поэтому здесь
      только подсказка — и форма, где момент можно назвать.
    */
    ? '<p class="muted">Момент встречи ещё не назван: без него она в календарь не попадёт.</p>'
    : past
      ? `<p class="muted">Встреча ${eventCountdown(item.eventAt)} — ответить нельзя, но обсуждение и фото остаются здесь же.</p>`
      : `<span class="evt-actions__btns" role="group" aria-label="Ответ на приглашение">${buttons}</span>${remind}`;

  return `
    <div class="evt-actions${past || !hasWhen ? ' evt-actions--closed' : ''}" data-evt-actions="${esc(item.id)}">
      ${answer}
      ${move}
      <p class="forum-error" data-evt-error hidden></p>
    </div>`;
}

/**
 * Значок встречи в шапке карточки темы — рядом со знаком срока действия.
 *
 * Лента не знает чисел участников, поэтому здесь только момент: по нему видно,
 * что тема из «Разбора» превратилась в приглашение, и когда идти.
 */
export function eventBadge(item) {
  if (!item.eventAt || !Array.isArray(item.tags) || !item.tags.includes(EVENT_TAG_ID)) return '';
  const past = eventIsPast(item.eventAt);
  return `<span class="forum-post__event${past ? ' forum-post__event--past' : ''}"
                title="Встреча ${esc(eventWhenFull(item.eventAt))} — смотрите в календаре">📅 ${esc(past ? 'прошла' : eventCountdown(item.eventAt))}</span>`;
}

/** Одна строка списка. */
function eventCard(e, s, now) {
  const past = eventIsPast(e.eventAt, now);
  const mine = myAnswer(e);
  return `
    <article class="evt-card${past ? ' is-past' : ''}${mine === 'going' ? ' is-going' : ''}" data-evt-card="${esc(e.id)}">
      <div class="evt-card__when" title="${esc(eventWhenFull(e.eventAt))}">
        <b>${esc(DAY.format(new Date(e.eventAt)))}</b>
        <span>${esc(MONTH.format(new Date(e.eventAt)))}</span>
        <i>${esc(CLOCK.format(new Date(e.eventAt)))}</i>
      </div>
      <div class="evt-card__body">
        <h3 class="evt-card__title"><a href="#/forum/${esc(e.id)}">${esc(e.title)}</a></h3>
        <p class="evt-card__meta">
          <span>${esc(eventWhen(e.eventAt))} · ${esc(eventCountdown(e.eventAt, now))}</span>
          <span class="evt-card__cat">${esc(categoryLabel(e.category))}</span>
          <span>ведёт @${esc(e.authorNick || '?')}</span>
        </p>
        ${past ? '' : seatsLine(e)}
        ${eventActions(e, s)}
      </div>
      <div class="evt-card__side">
        <a class="evt-link" href="${esc(icsHref(e))}" download="${esc(e.id)}.ics"
           title="Файл откроется в календаре телефона, почты или планаера">В мой календарь</a>
        <a class="evt-link" href="#/forum/${esc(e.id)}">Обсуждение</a>
      </div>
    </article>`;
}

/**
 * Каталог встреч отсутствует: база без миграции отвечает текстом про
 * `forum_event_list`. Название файла владельцу сайта полезнее, чем абстрактное
 * «не загрузилось», и человек, который сам прогоняет SQL, поймёт, что делать.
 */
function migrationHint(error) {
  const text = String(error ?? '');
  return /forum_event_list|relation .* does not exist|does not exist$/i.test(text)
    ? 'Похоже, календарь ещё не создан: прогоните supabase/20260925-event-rsvp.sql в SQL-редакторе.'
    : '';
}

/**
 * @param {{ready: boolean, shared: boolean, sourceName: string, me: any,
 *          events: any[], loading: boolean, error: string, view: string, now?: number}} s
 */
export function renderCalendar(s) {
  const now = s.now ?? Date.now();
  const events = Array.isArray(s.events) ? s.events : [];
  const view = CALENDAR_VIEWS.some((v) => v.id === s.view) ? s.view : DEFAULT_CALENDAR_VIEW;

  const tabs = CALENDAR_VIEWS.map((v) => `
    <button type="button" class="cal-tab${v.id === view ? ' is-active' : ''}"
            data-cal-view="${esc(v.id)}" aria-pressed="${v.id === view ? 'true' : 'false'}">${esc(v.label)}</button>`).join('');

  const upcoming = events.filter((e) => !eventIsPast(e.eventAt, now));
  const past = events.filter((e) => eventIsPast(e.eventAt, now)).reverse();
  const mine = upcoming.filter((e) => ['going', 'maybe'].includes(myAnswer(e)));
  const minePast = past.filter((e) => ['going', 'maybe', 'declined'].includes(myAnswer(e))).slice(0, 5);

  /*
    Липкая подпись дня: без неё список из восьми встреч на девять вечеров
    читается как каша чисел, а вопрос «когда» остаётся без ответа.
  */
  const groups = (list) => {
    const byDay = new Map();
    for (const e of list) {
      const key = startOfDay(e.eventAt);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }
    return [...byDay.entries()].map(([day, rows]) => `
      <section class="cal-day">
        <h2 class="cal-day__head">${esc(dayTitle(day, now))}</h2>
        ${rows.map((e) => eventCard(e, s, now)).join('')}
      </section>`).join('');
  };

  const empty = {
    next: upcoming.length
      ? ''
      : `<p class="cal-none">Ближайших встреч нет. ${s.me ? 'Заведите первую — это тема с меткой «Событие».' : 'Заходите позже: их заводят игроки форума.'}</p>`,
    mine: mine.length
      ? ''
      : `<p class="cal-none">${s.me
          ? 'Вы пока ни на что не отвечали. Выберите встречу во вкладке «Ближайшие» — и она появится здесь.'
          : 'Войдите на форум, и ваши ответы соберутся в расписание.'}</p>`,
    past: past.length ? '' : '<p class="cal-none">Прошедших встреч нет — календарь ведут с этого месяца.</p>',
  }[view];

  const body = view === 'next'
    ? groups(upcoming)
    : view === 'mine'
      ? groups(mine) + (minePast.length
        ? `<section class="cal-day cal-day--was"><h2 class="cal-day__head">Уже прошло</h2>${minePast.map((e) => eventCard(e, s, now)).join('')}</section>`
        : '')
      : groups(past.slice(0, 30));

  return `
    <section class="panel cal-page">
      <header class="panel__head">
        <span class="eyebrow">Календарь встреч</span>
        <h1>Когда собираемся</h1>
        <p class="muted">
          Встреча — это тема с меткой «Событие»: обсуждение, реакции и ответы
          остаются в ней, а здесь видно только время, места и ваш ответ.
        </p>
      </header>

      ${s.me && !s.me.banned
        ? `<p class="cal-new"><a class="forum-btn forum-btn--primary" href="#/forum?new=event">Создать встречу</a>
             <small class="muted">Откроется обычный редактор темы, только с отмеченной меткой «Событие».</small></p>`
        : ''}

      <nav class="cal-tabs" aria-label="Виды календаря">${tabs}</nav>

      ${!s.ready
        ? '<p class="cal-none">Форум ещё не подключён — календарь появится вместе с ним.</p>'
        : s.loading
          ? '<p class="cal-none">Загружаем встречи…</p>'
          : s.error
            ? `<p class="cal-none">Календарь не открылся: ${esc(s.error)}</p>
               ${migrationHint(s.error) ? `<p class="cal-none cal-none--sql">${esc(migrationHint(s.error))}</p>` : ''}`
            : `${body}${empty}`}
    </section>`;
}
