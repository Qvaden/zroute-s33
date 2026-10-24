/**
 * ЭКРАН «ПРОМОКОДЫ» — РУЧНЫЕ ЗАПИСИ.
 *
 * Здесь видно только то, что добавлено руками. Автоматический список живёт в
 * promocodes.json и приезжает сам; править его в панели нельзя, потому что
 * ночной обход всё равно вернул бы своё. Ручная запись при совпадении кода
 * перекрывает автоматическую — так владелец может сказать «этот больше не
 * работает», даже если чужой сайт ещё держит его в рабочих.
 */
import { esc } from '../../ui/helpers.js';

const ACTIVE = 'active';

function formatDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : '';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function blankPromoCode() {
  return { id: '', code: '', status: ACTIVE, rewards: '', added_on: today() };
}

export function renderPromocodesAdmin(view) {
  const state = view.promo ?? {};

  if (state.loading) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Сайт · бонусы</span>
          <h1 class="adm-h1">Промокоды</h1>
        </header>
        <div class="loading">Читаем ручные коды…</div>
      </section>`;
  }

  if (state.error) {
    return `
      <section class="panel error">
        <header class="panel__head">
          <span class="eyebrow">Сайт · бонусы</span>
          <h1 class="adm-h1">Промокоды</h1>
        </header>
        <p class="adm-lead">${esc(state.error)}</p>
        <p class="muted">
          Публичная страница продолжает работать по автоматическому списку.
          Ручные коды появятся после прогона <code>supabase/20261024-promo-codes.sql</code>.
        </p>
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-promo-reload>Попробовать снова</button>
        </div>
      </section>`;
  }

  const items = state.items ?? [];
  const form = state.form ?? blankPromoCode();
  const editing = Boolean(form.id);
  const active = items.filter((item) => item.status === ACTIVE).length;

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Сайт · бонусы</span>
        <h1 class="adm-h1">Промокоды</h1>
        <p class="adm-lead">
          Автоматический список обновляется раз в сутки и показан на сайте без
          вашего участия. Здесь — коды, которые вы добавили сами: они важнее
          автоматических, и ночной обход их не трогает.
        </p>
        <p class="muted">Всего ручных: ${esc(String(items.length))}, из них рабочих: ${esc(String(active))}.</p>
      </header>

      <div class="adm-result" data-promo-result ${state.result ? '' : 'hidden'} role="status">${state.result ?? ''}</div>

      <form class="panel adm-form promo-admin__form" data-promo-form>
        <h2 class="adm-h2">${editing ? 'Правка кода' : 'Новый код'}</h2>
        ${editing ? `<input type="hidden" name="id" value="${esc(form.id)}">` : ''}
        <div class="promo-admin__grid">
          <label class="adm-field">
            <span>Код</span>
            <input name="code" value="${esc(form.code)}" required maxlength="32"
              autocomplete="off" spellcheck="false" placeholder="Например, ZRR2026">
          </label>
          <label class="adm-field">
            <span>Статус</span>
            <select name="status">
              <option value="active"${form.status === ACTIVE ? ' selected' : ''}>Работает</option>
              <option value="inactive"${form.status === ACTIVE ? '' : ' selected'}>Не работает</option>
            </select>
          </label>
          <label class="adm-field">
            <span>Дата появления</span>
            <input type="date" name="added_on" value="${esc(form.added_on)}">
          </label>
          <label class="adm-field promo-admin__wide">
            <span>Что даёт код</span>
            <input name="rewards" value="${esc(form.rewards)}" maxlength="200"
              placeholder="300 алмазов, 10 сундуков, 15 ускорений">
          </label>
        </div>
        <div class="adm-actions">
          <button type="submit" class="adm-btn adm-btn--primary">${editing ? 'Сохранить правку' : 'Добавить код'}</button>
          ${editing ? '<button type="button" class="adm-btn" data-promo-cancel>Отмена</button>' : ''}
        </div>
      </form>

      <h2 class="adm-h2">Добавленные вручную</h2>
      ${items.length
        ? `<div class="promo-admin__list">${items.map(renderRow).join('')}</div>`
        : '<p class="muted">Пока пусто. Добавьте код формой выше — он сразу появится на сайте.</p>'}
    </section>`;
}

function renderRow(item) {
  const active = item.status === ACTIVE;
  return `
    <div class="promo-admin__row">
      <div class="promo-admin__code">${esc(item.code)}</div>
      <span class="adm-badge ${active ? 'promo-admin__state--on' : 'adm-badge--stop'}">${active ? 'работает' : 'не работает'}</span>
      <div class="promo-admin__rewards">${item.rewards ? esc(item.rewards) : '<span class="muted">награды не указаны</span>'}</div>
      <time class="promo-admin__date" datetime="${esc(String(item.added_on ?? '').slice(0, 10))}">
        ${esc(formatDate(item.added_on) || 'дата неизвестна')}
      </time>
      <div class="promo-admin__acts">
        <button type="button" class="adm-btn" data-promo-edit="${esc(item.id)}">Правка</button>
        <button type="button" class="adm-btn adm-btn--danger" data-promo-delete="${esc(item.id)}" data-promo-code="${esc(item.code)}">Удалить</button>
      </div>
    </div>`;
}
