/**
 * ГАЙДЫ (wiki) — поведение.
 *
 * Состояние в одном объекте, разметку возвращает строкой pages/guides.js.
 * Живое поведение: фильтр по категориям, создание, удаление.
 */
import { forum } from './index.js';
import { renderGuides } from '../pages/guides.js';
import { sanitizeHtml, textOf } from './format.js';
import { editorFor, applyFormat, wireRichEditor } from './editor.js';

const state = {
  me: null,
  guides: [],
  requests: [],
  /** null — заявки доступны; строка — почему мы их не показываем. */
  requestsNote: null,
  category: 'all',
  query: '',
  selected: null,
  composing: false,
  staleOpen: false,
  loading: true,
};

let host = null;
let wired = false;

/*
  Перерисовка по клику на раздел или по букве в поиске пересоздаёт весь блок.
  Поля, в которых человек печатает, поэтому снимаются с живого узла и
  возвращаются ему же: иначе набранная заявка стирается от случайной опечатки
  в строке поиска, а это тот случай, когда сайт сам отпугивает от формы.
  Курсор возвращаем только поиску — там печатают прямо сейчас.
*/
const KEPT_FIELDS = [
  '[data-guide-search]',
  '[data-grq-form] [name="title"]',
  '[data-grq-form] [name="details"]',
  '[data-grq-answer]',
];

/*
  Заявка на модерируемого игрока ищется по значению data-атрибута, а не
  вписывается в селектор: id приходят из базы, и собирать из них строку
  запроса — значит ловить исключение на первом же странном символе.
*/
function findKept(root, sel, id) {
  if (!root) return null;
  for (const el of root.querySelectorAll(sel)) {
    if (id === null || el.dataset.grqAnswer === id) return el;
  }
  return null;
}

function keptKey(el) {
  const sel = KEPT_FIELDS.find((s) => el.matches(s));
  return sel ? `${sel}\u0000${el.dataset.grqAnswer ?? ''}` : null;
}

function paint() {
  if (!host) return;
  const prev = [];
  for (const sel of KEPT_FIELDS) {
    for (const el of host.querySelectorAll(sel)) {
      if (el.value) prev.push({ key: keptKey(el), value: el.value });
    }
  }
  const active = document.activeElement;
  const activeKey = active && host.contains(active) ? keptKey(active) : null;

  host.innerHTML = renderGuides(state);

  for (const { key, value } of prev) {
    const [sel, id] = key.split('\u0000');
    const el = findKept(host, sel, id || null);
    if (el && !el.value) el.value = value;
  }
  if (activeKey) {
    const [sel, id] = activeKey.split('\u0000');
    const el = findKept(host, sel, id || null);
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
    }
  }
}

async function load() {
  try {
    state.me = await forum.currentUser();
  } catch { state.me = null; }
  try {
    state.guides = (await forum.listGuides?.()) ?? [];
  } catch { state.guides = []; }
  await loadRequests();
  state.loading = false;
  paint();
}

/*
  Заявки — новейшая часть страницы: если миграция в базе ещё не прогнана,
  список падает сетевой ошибкой. Гайды при этом исправны, поэтому молча
  прятать блок нельзя — человек решит, что функции нет, и не пойдёт её включать.
*/
async function loadRequests() {
  if (typeof forum.listGuideRequests !== 'function') {
    state.requests = [];
    state.requestsNote = null;
    return;
  }
  try {
    state.requests = await forum.listGuideRequests();
    state.requestsNote = null;
  } catch {
    state.requests = [];
    state.requestsNote = 'Список заявок сейчас недоступен: в базе ещё не прогнана '
      + 'миграция supabase/20260926-guide-requests.sql.';
  }
}

function filtered() {
  if (state.category === 'all') return state.guides;
  return state.guides.filter((g) => g.category === state.category);
}

async function openBySlug(slug) {
  state.staleOpen = false;
  try {
    state.selected = (await forum.getGuide?.(slug)) ?? null;
  } catch {
    state.selected = null;
  }
  paint();
}

/*
  Отметка и сигналы живут в той же строке, что и открытый гайд, поэтому после
  решения перечитываем и список (знак у строки), и страницу (дата, очередь).
  Один общий перезаезд вместо пяти правок состояния: так труднее забыть,
  какая из полок устарела.
*/
async function refreshGuides() {
  try {
    state.guides = (await forum.listGuides?.()) ?? [];
  } catch { /* прежний список лучше пустого */ }
  if (state.selected?.slug) await openBySlug(state.selected.slug);
  else paint();
}

async function runGuideAction(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    await refreshGuides();
  } catch (err) {
    showError('[data-guide-error]', String(err?.message ?? err));
    if (btn) btn.disabled = false;
  }
}

/* ── Заявки на гайды: чтение строк очереди и общий отказ блока ───────────── */

function rowValue(root, sel, id) {
  for (const el of root.querySelectorAll(sel)) {
    if (el.dataset.grqAnswer === id || el.dataset.grqGuide === id) return el.value;
  }
  return '';
}

function showRequestError(message) {
  const box = host?.querySelector('[data-grq-error]');
  if (box) { box.textContent = message; box.hidden = false; }
}

function hideRequestError() {
  const box = host?.querySelector('[data-grq-error]');
  if (box) { box.textContent = ''; box.hidden = true; }
}

/*
  После решения по заявке перечитываем и заявки, и гайды: исход ссылается на
  конкретный гайд, а его строка могла измениться, пока модератор читал очередь.
*/
async function runRequestAction(btn, fn) {
  if (btn) btn.disabled = true;
  hideRequestError();
  try {
    await fn();
    await loadRequests();
    paint();
  } catch (err) {
    showRequestError(String(err?.message ?? err));
    if (btn) btn.disabled = false;
  }
}

function wire() {
  if (wired) return;
  wired = true;

  wireRichEditor(() => host);

  document.addEventListener('input', (e) => {
    const input = e.target.closest?.('[data-guide-search]');
    if (!input || !host?.contains(input)) return;
    state.query = input.value;
    paint();
  });

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;

    /* Панель форматирования гайда — тот же механизм, что у форума. */
    const cmdBtn = t.closest('[data-editor-cmd]');
    if (cmdBtn) {
      const editor = editorFor(cmdBtn);
      if (editor) applyFormat(editor, cmdBtn.dataset.editorCmd, cmdBtn.dataset.editorValue);
      return;
    }
    const colorBtn = t.closest('[data-editor-color]');
    if (colorBtn) {
      const editor = editorFor(colorBtn);
      if (editor) applyFormat(editor, 'color', colorBtn.dataset.editorColor || 'inherit');
      return;
    }

    const chip = t.closest('[data-guide-cat]');
    if (chip) {
      state.category = chip.dataset.guideCat;
      paint();
      return;
    }

    if (t.closest('[data-guide-new]')) {
      state.composing = true;
      paint();
      return;
    }

    if (t.closest('[data-guide-cancel]')) {
      state.composing = false;
      paint();
      return;
    }

    const del = t.closest('[data-guide-delete]');
    if (del && forum.deleteGuide) {
      if (!confirm('Удалить гайд безвозвратно?')) return;
      try {
        await forum.deleteGuide(del.dataset.guideDelete);
        state.selected = null;
        state.guides = await forum.listGuides();
        paint();
      } catch (err) {
        showError(`[data-guide-error]`, String(err?.message ?? err));
      }
      return;
    }

    /* Отметка модерации: три кнопки делят одно поле комментария. */
    const review = t.closest('[data-guide-review]');
    if (review && forum.reviewGuide && state.selected) {
      const note = host.querySelector('[data-guide-review-note]')?.value ?? '';
      await runGuideAction(review, () => forum.reviewGuide(state.selected.id, review.dataset.guideReview, note));
      return;
    }

    if (t.closest('[data-guide-stale-open]')) {
      state.staleOpen = true;
      paint();
      return;
    }

    if (t.closest('[data-guide-stale-cancel]')) {
      state.staleOpen = false;
      paint();
      return;
    }

    const send = t.closest('[data-guide-stale-send]');
    if (send && forum.reportGuideStale && state.selected) {
      const note = host.querySelector('[data-guide-stale-note]')?.value ?? '';
      await runGuideAction(send, () => forum.reportGuideStale(state.selected.id, note));
      return;
    }

    /* ── Заявки на гайды ── */

    const cancel = t.closest('[data-grq-cancel]');
    if (cancel && forum.cancelGuideRequest) {
      if (!confirm('Отозвать заявку? Её больше не будет видно модерации.')) return;
      await runRequestAction(cancel, () => forum.cancelGuideRequest(cancel.dataset.grqCancel));
      return;
    }

    const resolve = t.closest('[data-grq-resolve]');
    if (resolve && forum.resolveGuideRequest) {
      const id = resolve.dataset.grqId;
      const status = resolve.dataset.grqResolve;
      /*
        Объяснение и гайд читаются по строке, а не из формы: в очереди таких
        строк несколько, и решение относится ровно к той, где человек печатал.
        Ссылка нужна только на «есть гайд» — закрывать заявку гайдом, который
        модератор случайно не выбрал, хуже молчаливого отказа.
      */
      const answer = rowValue(host, '[data-grq-answer]', id);
      const guideId = status === 'linked' ? rowValue(host, '[data-grq-guide]', id) : null;
      await runRequestAction(resolve, () => forum.resolveGuideRequest(id, status, answer, guideId));
      return;
    }
  });

  document.addEventListener('submit', async (e) => {
    const reqForm = e.target.closest('[data-grq-form]');
    if (!reqForm || !host?.contains(reqForm)) return;
    e.preventDefault();
    hideRequestError();
    if (!forum.createGuideRequest) {
      showRequestError('Заявки сейчас не принимаются.');
      return;
    }
    const btn = reqForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await forum.createGuideRequest({
        title: String(reqForm.elements.title.value ?? ''),
        details: String(reqForm.elements.details.value ?? ''),
      });
      reqForm.reset();
      await loadRequests();
      paint();
    } catch (ex) {
      showRequestError(String(ex?.message ?? ex));
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-guide-form]');
    if (!form || !host?.contains(form)) return;
    e.preventDefault();
    const err = form.querySelector('[data-guide-error]');
    if (err) err.hidden = true;
    const slug = String(form.elements.slug.value || '').toLowerCase().trim();
    const title = String(form.elements.title.value || '').trim();
    if (slug && !/^[a-z0-9а-яё-]{2,80}$/.test(slug)) {
      if (err) { err.textContent = 'Slug: только буквы, цифры и дефис'; err.hidden = false; }
      return;
    }
    if (title.length < 2) {
      if (err) { err.textContent = 'Заголовок слишком короткий'; err.hidden = false; }
      return;
    }
    /*
      Тело — HTML из редактора, как в форуме: на хранение уходит разметка,
      а показывает её postBody через тот же белый список. Пустой редактор
      браузер оставляет с служебными тегами, поэтому проверяем видимый текст.
    */
    const editor = form.querySelector('[data-editor]');
    const body = sanitizeHtml(editor?.innerHTML ?? '');
    if (textOf(body).length < 10) {
      if (err) { err.textContent = 'Текст гайда слишком короткий'; err.hidden = false; }
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const created = await forum.createGuide({
        slug,
        title,
        category: String(form.elements.category?.value ?? 'strategy'),
        body,
      });
      state.composing = false;
      state.guides = await forum.listGuides();
      state.selected = created;
      paint();
    } catch (ex) {
      if (err) { err.textContent = String(ex?.message ?? ex); err.hidden = false; }
      if (btn) btn.disabled = false;
    }
  });
}

function showError(selector, message) {
  const box = host?.querySelector(selector);
  if (box) { box.textContent = message; box.hidden = false; }
}

export async function mountGuides(container, initialSlug = null) {
  host = container;
  state.loading = true;
  state.selected = null;
  paint();
  wire();
  await load();
  if (initialSlug) await openBySlug(initialSlug);
}

export function unmountGuides() {
  host = null;
  state.guides = [];
  state.requests = [];
  state.requestsNote = null;
  state.selected = null;
  state.composing = false;
  state.staleOpen = false;
  state.query = '';
}