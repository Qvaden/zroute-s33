/**
 * КАЛЕНДАРЬ ВСТРЕЧ — поведение.
 *
 * Разметка — в pages/calendar.js, здесь состояние, адрес и нажатия. Живая
 * вкладка на тех же правах, что чаты и турниры: ждёт ответа базы, принимает
 * ответы на приглашения и переносит встречи.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ СТРАНИЦА, А НЕ РАЗДЕЛ ФОРУМА.
 *
 * Лента форума отвечает на вопрос «что обсуждают», календарь — на вопрос
 * «когда иду». Смешать их значило бы либо отдать ленте чужие поля (числа
 * участников, лимит мест), либо спрятать встречи за фильтром по метке, где
 * их никто не ищет. При этом сама встреча остаётся темой: адрес карточки —
 * обычный `#/forum/<id>`, и всё обсуждение живёт там.
 *
 * АДРЕС ХРАНИТ ТОЛЬКО ВИД (`#/calendar?view=mine`). Разделов и поиска у
 * календаря нет намеренно: список встреч на сервер за квартал — это тридцать
 * строк, а не лента, которую фильтруют.
 */
import { forum } from './index.js';
import { renderCalendar, CALENDAR_VIEWS, DEFAULT_CALENDAR_VIEW } from '../pages/calendar.js';
import { EVENT_RSVP_IDS } from './rules.js';

const state = {
  ready: false,
  shared: false,
  sourceName: '',
  me: null,
  /** Строки ForumEvent: тема-встреча плюс её момент, места и ответ вошедшего. */
  events: [],
  loading: true,
  error: '',
  view: DEFAULT_CALENDAR_VIEW,
};

let host = null;
let wired = false;
/** Поколение монтирования — тот же приём, что у форума: поздний ответ не должен
 *  нарисовать календарь поверх той страницы, что сейчас на экране. */
let mountToken = 0;
/** Таймер перерисовки обратного отсчёта («через 3 дня» само стареет). */
let tickTimer = 0;

/* ── Вид в адресе страницы ────────────────────────────────────────────────── */

/**
 * Адрес → вид. Чужое или отсутствующее значение — не ошибка, а обычный вход
 * на страницу: ссылка вида «#/calendar?view=» из старого чата обязана открыть
 * календарь, а не пустой экран.
 */
function readView(search) {
  const view = new URLSearchParams(String(search ?? '')).get('view');
  state.view = CALENDAR_VIEWS.some((v) => v.id === view) ? view : DEFAULT_CALENDAR_VIEW;
}

/**
 * Вид → адрес. Через replaceState, а не через location.hash: смена хэша
 * подняла бы hashchange, страница пересобралась бы заново и человек потерял
 * бы прокрутку списка, который только что смотрел.
 */
function writeView() {
  const search = state.view === DEFAULT_CALENDAR_VIEW ? '' : `?view=${state.view}`;
  const hash = `#/calendar${search}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function paint() {
  if (!host) return;
  host.innerHTML = renderCalendar(state);
}

/**
 * Отсчёт живёт на глазах: строка «через 40 мин» стареет, пока человек читает
 * анонсы. Перерисовываем список раз в минуту — чаще не нужно, а чаще значило
 * бы заметное подмигивание кнопок, по которым человек уже целится.
 */
function scheduleTick() {
  window.clearTimeout(tickTimer);
  if (!host) return;
  tickTimer = window.setTimeout(() => {
    paint();
    scheduleTick();
  }, 60000);
}

/* ── Загрузка ─────────────────────────────────────────────────────────────── */

async function load() {
  const token = mountToken;
  try {
    state.ready = await forum.isReady();
  } catch (err) {
    state.ready = false;
    state.error = String(err?.message ?? err);
    state.loading = false;
    paint();
    return;
  }
  state.shared = forum.capabilities.isShared;
  state.sourceName = forum.name;

  if (!state.ready) {
    state.loading = false;
    paint();
    return;
  }

  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }

  try {
    /*
      Ошибку не глушим: представление forum_event_list появилось последней
      миграцией, и по её тексту страница называет файл, которого не хватает
      (см. migrationHint в pages/calendar.js). Пустой список вместо ошибки
      выглядел бы как «встреч нет», и человек ждал бы чуда.
    */
    state.events = (await forum.listEvents()) || [];
    state.error = '';
  } catch (err) {
    state.events = [];
    state.error = String(err?.message ?? err);
  }

  if (token !== mountToken) return;
  state.loading = false;
  paint();
  scheduleTick();
}

/** Ответ ушёл в базу — берём свежие числа, а не додумываем их на глаз. */
async function reload() {
  try {
    state.events = (await forum.listEvents()) || [];
    state.error = '';
  } catch (err) {
    state.error = String(err?.message ?? err);
  }
  paint();
}

/* ── Нажатия ──────────────────────────────────────────────────────────────── */

/** Из строки `data-evt-answer="<id>:<статус>"`. */
function splitAnswer(value) {
  const [id, status] = String(value ?? '').split(':');
  return { id, status: EVENT_RSVP_IDS.includes(status) ? status : null };
}

/** Активная карточка для элемента внутри неё. */
function cardOf(el) {
  return el?.closest('[data-evt-card]') || null;
}

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;

    const tab = t.closest('[data-cal-view]');
    if (tab) {
      const view = tab.dataset.calView;
      if (!CALENDAR_VIEWS.some((v) => v.id === view) || view === state.view) return;
      state.view = view;
      writeView();
      paint();
      /*
        Прокрутку не сбрасываем: человек перешёл между видами одного списка,
        а не ушёл на другую страницу — начинать сверху каждый раз значило бы
        потерять то место, где он смотрел.
      */
      return;
    }

    const answer = t.closest('[data-evt-answer]');
    if (answer) {
      const { id, status } = splitAnswer(answer.dataset.evtAnswer);
      if (!id || !status) return;
      const card = cardOf(answer);
      const remind = card?.querySelector('[data-evt-remind]')?.value;
      answer.disabled = true;
      try {
        await forum.answerEvent(id, status, remind ? Number(remind) : null);
        await reload();
      } catch (err) {
        /*
          Отказ базы показываем в самой карточке: «мест больше нет» относится
          к одной встрече, и вешать это сообщение на весь календарь нельзя —
          человек решит, что сломалась страница.
        */
        answer.disabled = false;
        showError(card, String(err?.message ?? err));
      }
      return;
    }
  });

  /*
    Напоминание — <select>, и он живёт своей кнопкой: менять ответ человек
    не собирается, он выбирает только срок. Отдельный слушатель на 'change',
    а не на 'click', потому что с клавиатуры значение меняют стрелками.
  */
  document.addEventListener('change', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const select = e.target.closest('[data-evt-remind]');
    if (!select) return;
    const [id] = String(select.dataset.evtRemind).split(':');
    const card = cardOf(select);
    const mine = state.events.find((x) => x.id === id)?.myStatus;
    if (!mine) return;
    select.disabled = true;
    try {
      await forum.answerEvent(id, mine, select.value ? Number(select.value) : null);
      await reload();
    } catch (err) {
      select.disabled = false;
      showError(card, String(err?.message ?? err));
    }
  });

  document.addEventListener('submit', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const form = e.target.closest('[data-evt-move]');
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.evtMove;
    const card = cardOf(form);
    const when = form.elements.when?.value;
    const seats = form.elements.seats?.value;
    if (!when) return;
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await forum.setEventAt(id, new Date(when).toISOString(), seats ? Number(seats) : null);
      await reload();
    } catch (err) {
      if (btn) btn.disabled = false;
      showError(card, String(err?.message ?? err));
    }
  });
}

function showError(card, message) {
  if (!card) return;
  const box = card.querySelector('[data-evt-error]');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

/* ── Вход и выход ─────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} container
 * @param {string} search Хвост адреса после «?» — вид списка.
 */
export async function mountCalendar(container, search = '') {
  host = container;
  mountToken++;
  readView(search);
  state.loading = true;
  paint();
  wire();
  await load();
}

export function unmountCalendar() {
  window.clearTimeout(tickTimer);
  host = null;
  state.events = [];
  state.error = '';
  state.view = DEFAULT_CALENDAR_VIEW;
  mountToken++;
}
