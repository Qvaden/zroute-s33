/**
 * ПУЛЬС ОБНОВЛЕНИЙ ИГРЫ — поведение.
 *
 * Состояние в одном объекте, разметку возвращает строкой pages/updates.js.
 * Живое: читает список, показывает форму модерации, публикует и удаляет.
 *
 * Прав здесь этот файл не держит: публикацию и удаление разрешает база своей
 * функцией, и её отказ страница отдаёт как есть. Роль вошедшего смотрим только
 * затем, чтобы не показывать форму человеку, который её не нажмёт.
 */
import { forum } from './index.js';
import { esc } from '../ui/helpers.js';
import { renderUpdates } from '../pages/updates.js';
import { parseUpdateSource, updateParseNotice } from './rules.js';

const state = {
  ready: false,
  shared: false,
  me: null,
  /** Есть ли у вошедшего роль модерации — признак видимости формы. */
  canManage: false,
  /** Строки ForumUpdateNote: список, который база отдаёт целиком. */
  notes: [],
  loading: true,
  error: '',
  composing: false,
  /** Что подсказка сказала после последнего «Разобрать». */
  notice: '',
  /** Строки ForumStoreEvent: их принёс планировщик, а не человек. */
  storeEvents: [],
  /** Одна строка состояния обхода — «когда автомат приходил в последний раз». */
  storeStatus: null,
  /** Отказ списка событий; состояние обхода молчит отдельно и молча. */
  feedError: '',
};

let host = null;
let wired = false;
/** Поколение монтирования — тот же приём, что у форума: поздний ответ базы не
 *  должен нарисовать этот список поверх другой страницы. */
let mountToken = 0;

/*
  Поля формы одним списком, а не семью строками: разметка обязана называть
  ровно эти `name=`, и расхождение между двумя файлами не видно глазу, зато
  видно тесту.
*/
const DRAFT_FIELDS = ['kind', 'title', 'summary', 'sourceName', 'gameVersion', 'sourceUrl', 'sourceAt', 'paste'];

/*
  Поля, которые подсказка вправе заполнять: всё, кроме самого вставленного
  текста — он исходный материал, а не содержимое заметки.
*/
const PARSED_FIELDS = DRAFT_FIELDS.filter((name) => name !== 'paste');

/** Имена полей, к которым человек прикасался сам, — с них подсказка руки убирает. */
let touched = new Set();

function canManageAs(me) {
  return Boolean(me) && (me.role === 'admin' || me.role === 'moderator');
}

function paint() {
  if (!host) return;
  /*
    Форма переживает перерисовку целиком. Список обновляется после чужого
    нажатия «удалить», а человек в этот момент мог печатать заметку —
    потерять семь полей из-за одного клика значит больше, чем потерять саму
    страницу. Курсор возвращаем тому же полю.
  */
  const draft = state.composing ? readForm() : null;
  const focused = state.composing
    ? document.activeElement?.getAttribute?.('name') || ''
    : '';

  host.innerHTML = renderUpdates(state);

  if (draft) {
    const form = host.querySelector('[data-upd-form]');
    if (form) {
      for (const [name, value] of Object.entries(draft)) {
        if (form.elements[name] && value) form.elements[name].value = value;
      }
      if (focused && form.elements[focused]) form.elements[focused].focus({ preventScroll: true });
    }
  }
}

function readForm() {
  const form = host?.querySelector('[data-upd-form]');
  if (!form) return null;
  const out = {};
  for (const name of DRAFT_FIELDS) {
    const el = form.elements[name];
    if (el) out[name] = el.value;
  }
  return out;
}

/*
  Подсказка модерации: разложить вставленный текст обновления по полям формы.

  НИЧЕГО НЕ ПЕРЕЗАПИСЫВАЕТ. Поле, в которое человек уже что-то поставил или
  которое он трогал, остаётся его: иначе одна лишняя кнопка превращалась бы в
  «форма стёрла то, что я писал». Поэтому пустое — заполняем, написанное —
  бережём, а нехватки называем вслух в строке под кнопкой.

  Публикации здесь нет: разбор меняет только содержимое полей. Решение
  «публиковать» по-прежнему принимает человек одной кнопкой формы.
*/
function fillFromPaste() {
  const form = host?.querySelector('[data-upd-form]');
  if (!form) return;
  const paste = form.elements.paste?.value || '';
  const link = form.elements.sourceUrl?.value || '';
  const parsed = parseUpdateSource(paste, link);

  for (const name of PARSED_FIELDS) {
    const el = form.elements[name];
    const value = parsed[name];
    if (!el || !value || touched.has(name)) continue;
    /* Пустое значение поля — единственное, куда подсказка имеет право. */
    if (String(el.value).trim() && name !== 'kind') continue;
    el.value = value;
  }

  state.notice = updateParseNotice(parsed);
}

/**
 * События магазина и строка состояния — два отдельных запроса и два разных
 * отношения к отказу.
 *
 * Список без миграции страница обязана назвать: пустые «событий нет» звучали бы
 * как правда про игру, а не про наш прогон SQL. Состояние обхода — украшение
 * одной строки, и его отказ не имеет права превращать живой блок в ошибку,
 * поэтому он глушится намеренно и ничему не противоречит: просто строки не
 * будет.
 */
async function loadFeed() {
  try {
    state.storeEvents = (await forum.listStoreEvents()) || [];
    state.feedError = '';
  } catch (err) {
    state.storeEvents = [];
    state.feedError = String(err?.message ?? err);
  }
  try {
    state.storeStatus = (await forum.getStoreStatus()) || null;
  } catch {
    state.storeStatus = null;
  }
}

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

  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }
  state.canManage = canManageAs(state.me);

  if (!state.ready) {
    state.loading = false;
    paint();
    return;
  }

  try {
    /*
      Ошибку не глушим: представление forum_update_note_list появилось последней
      миграцией, и по его тексту страница называет файл, которого не хватает.
      Пустой список вместо ошибки выглядел бы как «обновлений нет», и человек
      ждал бы чуда.
    */
    state.notes = (await forum.listUpdateNotes()) || [];
    state.error = '';
  } catch (err) {
    state.notes = [];
    state.error = String(err?.message ?? err);
  }

  await loadFeed();

  if (token !== mountToken) return;
  state.loading = false;
  paint();
}

/** После своего действия берём свежий список, а не додумываем строку на глаз. */
async function reload() {
  try {
    state.notes = (await forum.listUpdateNotes()) || [];
    state.error = '';
  } catch (err) {
    state.notes = [];
    state.error = String(err?.message ?? err);
  }
  await loadFeed();
  paint();
}

function showFormError(message) {
  const box = host?.querySelector('[data-upd-error]');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
}

function hideFormError() {
  const box = host?.querySelector('[data-upd-error]');
  if (box) {
    box.textContent = '';
    box.hidden = true;
  }
}

/**
 * Одно действие над одной заметкой. Отказ показываем в карточке, а не над
 * всем списком: «заметка не найдена» относится ровно к одной строке, и вешать
 * его на страницу значило бы намекать, что сломался весь пульс.
 */
async function runNoteAction(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    await reload();
  } catch (err) {
    const card = btn?.closest('.upd-card');
    if (card) {
      card.insertAdjacentHTML('beforeend', `<p class="upd-card__error">${esc(String(err?.message ?? err))}</p>`);
    }
    if (btn) btn.disabled = false;
  }
}

/*
  Одно действие над одним событием. Отказ, как и у заметки, показываем в
  карточке: «событие не найдено» относится ровно к одной строке, а блок событий
  при этом живой и никуда не денется.
*/
async function runFeedAction(btn) {
  if (!forum.deleteStoreEvent) return;
  btn.disabled = true;
  try {
    await forum.deleteStoreEvent(btn.dataset.feedDelete);
    await reload();
  } catch (err) {
    const card = btn.closest('.feed-card');
    if (card) {
      card.insertAdjacentHTML('beforeend', `<p class="feed-card__error">${esc(String(err?.message ?? err))}</p>`);
    }
    btn.disabled = false;
  }
}

/*
  Название в вопросе о подтверждении. Удаление — единственное действие на этой
  странице, у которого нет возврата, поэтому спрашивать обязан клик, а не база:
  отказ «строки нет» приходит слишком поздно, когда человек уже согласился.
  Заголовок берём из самой карточки: он там есть, и второй копии в атрибуте
  кнопки не нужно.
*/
function cardTitle(btn, selector) {
  return btn?.closest(selector)?.querySelector('.upd-card__title, .feed-card__title')?.textContent?.trim() || '';
}

function confirmRemoval(title, what) {
  const name = title ? ` «${title}»` : '';
  return confirm(
    `${what}${name} удалить навсегда? Архива больше нет: строка уходит из базы,`
    + ' и автомат не приносит её обратно.'
  );
}

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;

    if (t.closest('[data-upd-new]')) {
      state.composing = true;
      state.notice = '';
      touched = new Set();
      paint();
      host.querySelector('[data-upd-form] [name="title"]')?.focus({ preventScroll: true });
      return;
    }

    if (t.closest('[data-upd-cancel]')) {
      state.composing = false;
      state.notice = '';
      touched = new Set();
      paint();
      return;
    }

    if (t.closest('[data-upd-parse]')) {
      fillFromPaste();
      paint();
      return;
    }

    const drop = t.closest('[data-upd-delete]');
    if (drop && forum.deleteUpdateNote) {
      if (!confirmRemoval(cardTitle(drop, '.upd-card'), 'Заметку')) return;
      await runNoteAction(drop, () => forum.deleteUpdateNote(drop.dataset.updDelete));
      return;
    }

    const feedOff = t.closest('[data-feed-delete]');
    if (feedOff && forum.deleteStoreEvent) {
      if (!confirmRemoval(cardTitle(feedOff, '.feed-card'), 'Событие')) return;
      await runFeedAction(feedOff);
    }
  });

  /*
    Что человек трогал сам. Подсказка заполняет пустое, но поле, в которое
    модератор уже что-то поставил или которое выбрал из списка, — его, и
    перерисовка формы не имеет права на это претендовать.
  */
  const markTouched = (e) => {
    if (!host || !state.composing) return;
    const el = e.target;
    const form = host.querySelector('[data-upd-form]');
    if (form && el && el.name && form.contains(el)) touched.add(el.name);
  };
  document.addEventListener('input', markTouched);
  document.addEventListener('change', markTouched);

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-upd-form]');
    if (!form || !host?.contains(form)) return;
    e.preventDefault();
    hideFormError();

    const values = readForm();
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await forum.publishUpdateNote({
        kind: values.kind || '',
        title: values.title || '',
        summary: values.summary || '',
        sourceName: values.sourceName || '',
        sourceUrl: values.sourceUrl || '',
        /*
          Поле datetime-local отдаёт строку без часового пояса, и new Date
          трактует её локальными часами — ровно так же, как это делает база для
          timestamptz. Уходит ISO-строка с смещением, чтобы ни у кого по пути
          час не потерялся.
        */
        sourceAt: values.sourceAt ? new Date(values.sourceAt).toISOString() : '',
        gameVersion: values.gameVersion || '',
      });
      state.composing = false;
      state.notice = '';
      touched = new Set();
      await reload();
    } catch (err) {
      showFormError(String(err?.message ?? err));
      if (btn) btn.disabled = false;
    }
  });
}

export async function mountUpdates(container) {
  host = container;
  mountToken++;
  state.loading = true;
  state.composing = false;
  /*
    «Сейчас» для стадии события берётся в момент входа на страницу: событие,
    которое кончилось, пока человек листал форум, обязан показаться кончившимся,
    а не вчерашним.
  */
  state.now = Date.now();
  paint();
  wire();
  await load();
}

export function unmountUpdates() {
  host = null;
  mountToken++;
  state.notes = [];
  state.error = '';
  state.composing = false;
  state.canManage = false;
  state.me = null;
  state.storeEvents = [];
  state.storeStatus = null;
  state.feedError = '';
}
