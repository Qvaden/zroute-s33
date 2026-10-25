import { esc } from '../ui/helpers.js';
import { toast } from '../ui/toast.js';
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

/*
  Копирование — главное действие на этой странице: код вставляют в игру.
  Clipboard API молча отказывает без защищённого адреса, поэтому запасной
  путь через скрытое поле остаётся: без него кнопка в старом браузере просто
  ничего не делает и человек считает, что код неверный.
*/
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Ниже пробуем старый способ: он не спрашивает разрешения.
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

async function copyCode(button) {
  const code = button.dataset.copy ?? '';
  if (!code) return;
  if (!await copyText(code)) {
    toast('Не удалось скопировать. Выделите код вручную.', 'error');
    return;
  }
  /*
    Подтверждение живёт дольше мгновения: человек смотрит на кнопку, а не на
    нижний край экрана, и должен увидеть, что нажатие сработало.
  */
  button.classList.add('is-copied');
  button.setAttribute('aria-label', `Код ${code} скопирован`);
  clearTimeout(button.copyTimer);
  button.copyTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    button.setAttribute('aria-label', `Скопировать код ${code}`);
  }, 1600);
  toast(`Код ${code} скопирован`, 'ok');
}

function formatDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : '';
}

/*
  Подсказка отвечает на вопрос, который возникает раньше списка: куда этот код
  вводить. Путь в игре — единственное, чего не хватало человеку, впервые
  открывшему вкладку: без него код копируют и не знают, что с ним делать.
  Кнопки-раскрывашки нет нарочно: ответ помещается в одну строку и должен быть
  виден сразу, а лишнее нажатие только прячет его от того, кто пришёл впервые.
*/
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
        <p class="muted">Если код не сработал, он мог закончиться — начинайте с верхних.</p>
      </header>
      <div class="promo-how">
        <p class="promo-how__title">Как использовать</p>
        <ol class="promo-how__steps">
          <li><span>Аватар</span></li>
          <li><span>Настройки</span></li>
          <li><span>Подарочный код</span></li>
        </ol>
        <p class="promo-how__note">Скопируйте код нажатием на него и вставьте в открывшееся поле — останется подтвердить.</p>
      </div>
      <div class="promocodes-list" id="promocodes-list" aria-live="polite">
        <p class="muted">Загружаем список…</p>
      </div>
    </section>`;
}

function renderCard(item) {
  const active = item.status === ACTIVE;
  const statusClass = active ? 'active' : 'inactive';
  const statusText = active ? 'Активен' : 'Не работает';
  const code = esc(item.code);
  return `
    <article class="promocode-card promocode-card--${statusClass}">
      <div class="promocode-card__top">
        <button class="promocode-copy" type="button" data-copy="${code}" aria-label="Скопировать код ${code}" title="Скопировать код">
          <span class="promocode-code">${code}</span>
          <span class="promocode-copy__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>
            <svg class="promocode-copy__done" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
          </span>
        </button>
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
  list.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-copy]');
    if (button && list.contains(button)) copyCode(button);
  });
  fillSummary(app, data, codes);
}
