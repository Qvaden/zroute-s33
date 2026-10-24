import { esc } from '../ui/helpers.js';
import { isConfigured, rest } from '../db/client.js';

const SOURCE_FILE = './promocodes.json';
const MANUAL_TABLE = '/site_promo_codes';
const ACTIVE = 'active';

export function readPromocodes(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.codes) ? data.codes : [];
  const seen = new Set();
  const codes = [];
  for (const item of list) {
    const code = String(item?.code ?? '').trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push({
      code,
      status: String(item?.status ?? '').toLowerCase() === ACTIVE ? ACTIVE : 'inactive',
      date: String(item?.date ?? '').trim().slice(0, 10),
      rewards: String(item?.rewards ?? '').trim(),
    });
  }
  codes.sort((a, b) => (a.status === b.status
    ? a.code.localeCompare(b.code)
    : a.status === ACTIVE ? -1 : 1));
  return codes;
}

/**
 * Ручные коды из панели.
 *
 * Они важнее автоматических: человек, который ввёл код сам, знает про него
 * больше, чем чужой сайт. Поэтому при совпадении кода запись из базы заменяет
 * найденную, включая отметку «не работает».
 */
export function mergePromocodes(auto = [], manual = []) {
  const byCode = new Map();
  for (const item of auto) byCode.set(item.code, item);
  for (const item of manual) byCode.set(item.code, item);
  const codes = [...byCode.values()];
  codes.sort((a, b) => (a.status === b.status
    ? a.code.localeCompare(b.code)
    : a.status === ACTIVE ? -1 : 1));
  return codes;
}

function manualCode(row) {
  const code = String(row?.code ?? '').trim().toUpperCase();
  if (!code) return null;
  const status = String(row?.status ?? '').toLowerCase() === ACTIVE ? ACTIVE : 'inactive';
  return {
    code,
    status,
    date: String(row?.added_on ?? row?.created_at ?? '').trim().slice(0, 10),
    rewards: String(row?.rewards ?? '').trim(),
  };
}

async function loadManual() {
  if (!isConfigured()) return [];
  const rows = await rest(
    `${MANUAL_TABLE}?select=code,status,rewards,added_on,created_at&order=created_at.desc`,
    { retryOnAbort: true }
  );
  return Array.isArray(rows) ? rows.map(manualCode).filter(Boolean) : [];
}

function formatDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : '';
}

export function renderPromocodes() {
  return `
    <section class="panel promo-intro">
      <span class="eyebrow">Справка // бонусы</span>
      <h1>Промокоды</h1>
      <p>Актуальные коды для Z Route: Redemption на 33 сервере. Список обновляется автоматически: рабочие коды сверху, выбывшие — ниже.</p>
      <div class="promo-summary">
        <div class="promo-stat"><b data-promo-total>—</b><span>всего кодов</span></div>
        <div class="promo-stat"><b data-promo-active>—</b><span>работают</span></div>
        <div class="promo-stat"><b data-promo-updated>—</b><span>проверено</span></div>
      </div>
    </section>
    <section class="panel promo-panel">
      <header class="panel__head">
        <h2>Актуальные промокоды</h2>
        <p class="muted">Введите код в игре. Если код не сработал, он мог закончиться — начинайте с верхних.</p>
      </header>
      <div class="promocodes-list" id="promocodes-list" aria-live="polite">
        <p class="muted">Загружаем список…</p>
      </div>
    </section>`;
}

function renderCard(item) {
  const active = item.status === ACTIVE;
  const statusClass = active ? 'active' : 'inactive';
  const statusText = active ? 'Активен' : 'Не работает';
  return `
    <article class="promocode-card promocode-card--${statusClass}">
      <div class="promocode-card__top">
        <span class="promocode-code">${esc(item.code)}</span>
        <span class="promocode-status promocode-status--${statusClass}">
          <span class="promocode-dot" aria-hidden="true"></span>${statusText}
        </span>
      </div>
      ${item.rewards ? `<p class="promocode-rewards">${esc(item.rewards)}</p>` : ''}
      <div class="promocode-meta">
        <time class="promocode-date" datetime="${esc(item.date)}">${esc(formatDate(item.date))}</time>
      </div>
    </article>`;
}

function fillSummary(app, data, codes) {
  const set = (selector, value) => {
    const node = app.querySelector(selector);
    if (node) node.textContent = value;
  };
  set('[data-promo-total]', String(codes.length));
  set('[data-promo-active]', String(codes.filter((item) => item.status === ACTIVE).length));
  set('[data-promo-updated]', formatDate(data?.updated) || '—');
}

export async function mountPromocodes(app) {
  const list = app?.querySelector?.('#promocodes-list');
  if (!list) return;

  const [fileResult, manualResult] = await Promise.allSettled([
    fetch(SOURCE_FILE, { cache: 'no-cache' }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }),
    loadManual(),
  ]);

  const data = fileResult.status === 'fulfilled' ? fileResult.value : null;
  const manual = manualResult.status === 'fulfilled' ? manualResult.value : [];
  if (manualResult.status === 'rejected') {
    // Ручных кодов может не быть: база ещё не знает таблицы или лежит. Это не
    // повод прятать автоматический список — он и остаётся главным ответом.
    console.warn('Ручные промокоды не загрузились:', manualResult.reason?.message ?? manualResult.reason);
  }

  const codes = mergePromocodes(readPromocodes(data), manual);
  if (!codes.length) {
    list.innerHTML = data
      ? '<p class="muted">Список промокодов пока пуст.</p>'
      : '<p class="muted">Не удалось загрузить список. Проверьте связь и обновите страницу.</p>';
    return;
  }

  list.innerHTML = codes.map(renderCard).join('');
  fillSummary(app, data, codes);
}
