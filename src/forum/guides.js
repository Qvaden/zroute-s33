/**
 * ГАЙДЫ (wiki) — поведение.
 *
 * Состояние в одном объекте, разметку возвращает строкой pages/guides.js.
 * Живое поведение: фильтр по категориям, создание, удаление.
 */
import { forum } from './index.js';
import { renderGuides } from '../pages/guides.js';

const state = {
  me: null,
  guides: [],
  category: 'all',
  selected: null,
  composing: false,
  loading: true,
};

let host = null;
let wired = false;

function paint() {
  if (!host) return;
  host.innerHTML = renderGuides(state);
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
  try {
    state.selected = (await forum.getGuide?.(slug)) ?? null;
  } catch {
    state.selected = null;
  }
  paint();
}

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;

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
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const created = await forum.createGuide({
        slug,
        title,
        category: String(form.elements.category?.value ?? 'strategy'),
        body: form.elements.body.value,
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
}