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
  category: 'all',
  query: '',
  selected: null,
  composing: false,
  staleOpen: false,
  loading: true,
};

let host = null;
let wired = false;

function paint() {
  if (!host) return;
  /*
    Поиск не должен пропадать при перерисовке (выбор раздела и т.п.):
    иначе набранное стирается на каждом клике, и человеку кажется,
    что сайт не реагирует на ввод.
  */
  const prev = host.querySelector('[data-guide-search]')?.value ?? '';
  host.innerHTML = renderGuides(state);
  const input = host.querySelector('[data-guide-search]');
  if (input && prev) {
    input.value = prev;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  }
}

async function load() {
  try {
    state.me = await forum.currentUser();
  } catch { state.me = null; }
  try {
    state.guides = (await forum.listGuides?.()) ?? [];
  } catch { state.guides = []; }
  state.loading = false;
  paint();
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
  state.selected = null;
  state.composing = false;
  state.staleOpen = false;
  state.query = '';
}