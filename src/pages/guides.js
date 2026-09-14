/**
 * ГАЙДЫ (wiki) — список стратегий и советы сообщества.
 *
 * Чистый рендер от состояния. Поведение — в src/forum/guides.js.
 */
import { esc } from '../ui/helpers.js';
import { postBody } from '../forum/format.js';
import { renderMdBar } from './forum.js';
import { CONFIG } from '../../config.js';

const CATEGORIES = [
  { id: 'strategy', label: 'Стратегия' },
  { id: 'alliance', label: 'Альянсам' },
  { id: 'newbie', label: 'Новичкам' },
  { id: 'vs', label: 'VS и бои' },
];

const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || 'Гайд';

export function renderGuides(s) {
  if (s.selected) return renderDetail(s, s.selected);
  return renderList(s);
}

function renderList(s) {
  const all = Array.isArray(s.guides) ? s.guides : [];
  const guides = s.category === 'all' ? all : all.filter((g) => g.category === s.category);
  const cats = [{ id: 'all', label: 'Все' }, ...CATEGORIES];
  const canWrite = s.me && (s.me.isLeader || s.me.role === 'admin' || s.me.role === 'moderator');

  const chips = cats
    .map((c) => `<button type="button" class="guide-chip${s.category === c.id ? ' is-on' : ''}"
             data-guide-cat="${esc(c.id)}">${esc(c.label)}</button>`)
    .join('');

  const list = guides.length
    ? `<ul class="guide-list">${guides
        .map((g) => `
          <li class="guide-card">
            <a href="#/guides/${esc(g.slug)}">
              <span class="guide-card__cat">${esc(catLabel(g.category))}</span>
              <b class="guide-card__title">${esc(g.title)}</b>
              <span class="guide-card__by muted">Автор: ${esc(g.authorNick || '—')}</span>
            </a>
          </li>`)
        .join('')}</ul>`
    : '<p class="muted">Гайдов пока нет. Лидер альянса может добавить первый.</p>';

  return `
    <section class="panel guides-page">
      <header class="panel__head">
        <span class="eyebrow">Знания сообщества</span>
        <h1>Гайды</h1>
        <p class="muted">Стратегии, советы для новичков и разбор боёв — пишут участники.</p>
      </header>
      <div class="guide-cats" role="tablist">${chips}</div>
      ${canWrite && !s.composing
        ? '<button type="button" class="forum-btn forum-btn--primary" data-guide-new>Написать гайд</button>'
        : ''}
      ${canWrite && s.composing ? composeForm(s) : ''}
      <div class="guide-list-wrap">${list}</div>
    </section>`;
}

function composeForm(s) {
  const opts = CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  const bodyMax = CONFIG.forum.limits.bodyMax;
  return `
    <form class="guide-composer" data-guide-form>
      <label class="forum-field">
        <span>Заголовок</span>
        <input name="title" maxlength="120" required placeholder="О чём гайд" autocomplete="off">
      </label>
      <label class="forum-field">
        <span>Slug (адрес)</span>
        <input name="slug" maxlength="80" required placeholder="na-rusi-dopuskaetsya"
               pattern="[a-z0-9а-яё\\-]+" autocomplete="off">
        <small class="muted">Латиница/кириллица, цифры, дефис. По нему откроется страница.</small>
      </label>
      <label class="forum-field">
        <span>Категория</span>
        <select name="category">${opts}</select>
      </label>
      <label class="forum-field">
        <span>Текст гайда</span>
        <div class="forum-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
             name="body" data-editor data-limit="${bodyMax}"
             data-placeholder="Опишите стратегию шаг за шагом. Жирный, списки, цитаты и цвет — как в посте форума."></div>
      </label>
      ${renderMdBar()}
      <div class="forum-composer__actions">
        <button type="submit" class="forum-btn forum-btn--primary">Опубликовать</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-guide-cancel>Отмена</button>
      </div>
      <p class="forum-error" data-guide-error hidden></p>
    </form>`;
}

function renderDetail(s, g) {
  return `
    <section class="panel guide-detail">
      <a class="back" href="#/guides">← Все гайды</a>
      <span class="guide-card__cat">${esc(catLabel(g.category))}</span>
      <h1>${esc(g.title)}</h1>
      <p class="muted">Автор: ${esc(g.authorNick || '—')} · обновлён ${esc(new Date(g.updatedAt).toLocaleDateString('ru-RU'))}</p>
      <div class="guide-content">${postBody(g.body)}</div>
      ${s.me && (s.me.id === g.authorId || s.me.role === 'admin' || s.me.role === 'moderator')
        ? `<div class="guide-detail__acts"><button type="button" class="forum-btn forum-btn--ghost" data-guide-delete="${esc(g.id)}">Удалить гайд</button></div>`
        : ''}
    </section>`;
}
