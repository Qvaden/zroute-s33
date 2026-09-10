/**
 * ВЫБОР ИЗ НЕСКОЛЬКИХ ВАРИАНТОВ — СВОЙ, А НЕ СИСТЕМНЫЙ.
 *
 * ЧЕГО НЕ ХВАТАЛО СИСТЕМНОМУ `<select>`. Закрытый вид ему подкрасили
 * (controls.css: тёмное поле и своя стрелка), но открытый список остаётся
 * чужим: на компьютере это белый прямоугольник Windows поверх тёмной панели,
 * а на телефоне — системная шторка снизу, которая выглядит и ведёт себя
 * по-разному в каждом браузере. Для анкеты «Название · Вид · Тег» вид
 * открытого списка — половина впечатления от страницы.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ ВМЕСТО ЭТОГО. Свой список с ролями ARIA, полной клавиатурой
 * (стрелки, Home/End, Enter, Escape, ввод буквы — переход к варианту)
 * и режимом «шторка снизу» на узком экране. То есть на телефоне остаётся
 * привычное поведение системного выбора, но нарисованное в стиле сайта.
 *
 * ГДЕ ОН УМЕСТЕН, А ГДЕ НЕТ. Здесь выбор из НЕСКОЛЬКИХ вариантов, каждый
 * из которых хочется объяснить подписью («Альянсовый — штаб одного альянса»).
 * Длинные списки (разделы форума, недели в панели) остаются настоящим
 * `<select>`: там системный список честно удобнее, а подписывать двадцать
 * строк нечем. Правило простое: вариантов пять и меньше и есть что сказать
 * про каждый — свой список, иначе родной.
 *
 * ГДЕ ЖИВЁТ ПОВЕДЕНИЕ. Разметка — чистая функция от состояния (её зовут
 * страницы), поведение — слушатели на документе, которые ставятся один раз
 * (initSelects). Тот же приём, что у чата и форума: страница перерисовывается
 * строкой целиком, а обработчики переживают перерисовку.
 */
import { esc } from './helpers.js';

let wired = false;

/**
 * Разметка списка.
 *
 * @param {Object} cfg
 * @param {string} cfg.name            Имя поля: значение уходит в скрытый input с этим именем.
 * @param {string} cfg.value           Выбранное значение.
 * @param {{value: string, label: string, hint?: string, mark?: string}[]} cfg.options
 * @param {string} [cfg.ariaLabel]     Что именно выбирают — для экранного диктора.
 * @param {'sm'|'md'} [cfg.size]
 * @param {string} [cfg.emptyText]     Что показать, если вариантов нет.
 * @param {string} [cfg.attrs]         Дополнительные атрибуты на корне (например data-*).
 * @returns {string}
 */
export function renderSelect({ name, value, options = [], ariaLabel = '', size = 'md', emptyText = '', attrs = '' }) {
  const list = Array.isArray(options) ? options.filter((o) => o && o.value != null) : [];
  const current = list.find((o) => String(o.value) === String(value)) ?? list[0] ?? null;
  const uid = `sel-${name}`;

  if (!list.length) {
    return `<div class="sel sel--${esc(size)} sel--empty" data-sel data-sel-name="${esc(name)}" ${attrs}>
      <span class="sel__none muted">${esc(emptyText || 'Выбирать не из чего')}</span>
    </div>`;
  }

  return `
    <div class="sel sel--${esc(size)}" data-sel data-sel-name="${esc(name)}" ${attrs}>
      <input type="hidden" name="${esc(name)}" value="${esc(current.value)}" data-sel-input>
      <button type="button" class="sel__btn" data-sel-toggle aria-haspopup="listbox"
              aria-expanded="false" ${ariaLabel ? `aria-label="${esc(ariaLabel)}"` : ''}
              aria-controls="${esc(uid)}">
        ${current.mark ? `<span class="sel__mark" aria-hidden="true">${esc(current.mark)}</span>` : ''}
        <span class="sel__text">
          <b class="sel__label">${esc(current.label)}</b>
          ${current.hint ? `<small class="sel__hint">${esc(current.hint)}</small>` : ''}
        </span>
        <svg class="sel__caret" viewBox="0 0 24 24" width="16" height="16" fill="none"
             stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="sel__pop" id="${esc(uid)}" role="listbox" ${ariaLabel ? `aria-label="${esc(ariaLabel)}"` : ''} hidden>
        ${list
          .map((o, i) => {
            const on = String(o.value) === String(current.value);
            return `<button type="button" class="sel__opt${on ? ' is-on' : ''}" role="option"
                    id="${esc(uid)}-${i}" data-sel-option data-sel-value="${esc(o.value)}"
                    aria-selected="${on ? 'true' : 'false'}" tabindex="-1">
              ${o.mark ? `<span class="sel__mark" aria-hidden="true">${esc(o.mark)}</span>` : ''}
              <span class="sel__text">
                <b>${esc(o.label)}</b>
                ${o.hint ? `<small>${esc(o.hint)}</small>` : ''}
              </span>
              <svg class="sel__check" viewBox="0 0 24 24" width="16" height="16" fill="none"
                   stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
                   aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            </button>`;
          })
          .join('')}
      </div>
      <div class="sel__veil" data-sel-veil hidden></div>
    </div>`;
}

/* ── Поведение ─────────────────────────────────────────────────────────────── */

const OPEN = 'is-open';

/*
  ШИРИНА ПРИ ОТКРЫТИИ.

  Список рисуется обычным блоком ВНУТРИ поля (`position: absolute`), но поле
  живёт в колонке чата, у которой `overflow: hidden`: список обрезался бы
  краем колонки — на коротком окне пункты просто исчезали бы. Поэтому при
  открытии список измеряется и переносится в координаты окна (`position:
  fixed`, класс sel--fixed): тогда его не режет ни прокрутка, ни граница
  панели, а если снизу места нет — он раскрывается вверх.

  На телефоне (< 760px) этого не нужно: там список и так шторка снизу на
  весь экран, и она сама знает, где ей быть.
*/

/** Все корни списков, которые сейчас открыты. Открыт всегда максимум один. */
const openRoots = new Set();

function rootOf(el) {
  return el?.closest?.('[data-sel]') ?? null;
}

function popOf(root) {
  return root?.querySelector('.sel__pop') ?? null;
}

function toggleOf(root) {
  return root?.querySelector('[data-sel-toggle]') ?? null;
}

function optionsOf(root) {
  return [...(popOf(root)?.querySelectorAll('[data-sel-option]') ?? [])];
}

function isOpen(root) {
  return root?.classList.contains(OPEN) ?? false;
}

function close(root) {
  if (!root) return;
  root.classList.remove(OPEN, 'sel--fixed', 'sel--up');
  toggleOf(root)?.setAttribute('aria-expanded', 'false');
  const pop = popOf(root);
  if (pop) pop.hidden = true;
  const veil = root.querySelector('[data-sel-veil]');
  if (veil) veil.hidden = true;
  openRoots.delete(root);
}

function closeAll(except = null) {
  for (const root of [...openRoots]) {
    if (root !== except) close(root);
  }
}

/** Шторка снизу вместо меню: тот же порог, что в controls.css. */
const SHEET_QUERY = '(max-width: 759px)';

function sheetMode() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(SHEET_QUERY).matches;
}

/**
 * Ставит список в координаты окна — или возвращает его в обычное положение
 * (шторка снизу, широкий экран без тесноты).
 */
function place(root) {
  const btn = toggleOf(root);
  const pop = popOf(root);
  if (!btn || !pop) return;

  if (sheetMode()) {
    root.classList.remove('sel--fixed', 'sel--up');
    pop.style.removeProperty('--sel-top');
    pop.style.removeProperty('--sel-left');
    pop.style.removeProperty('--sel-width');
    return;
  }

  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const gap = 6;

  const width = Math.max(232, Math.round(r.width));
  const left = Math.max(margin, Math.min(Math.round(r.left), vw - width - margin));

  // Высоту списка видно только когда он показан; до показа считаем её пределом.
  const height = pop.offsetHeight || 0;
  const below = vh - r.bottom - gap - margin;
  const above = r.top - gap - margin;
  const up = height > below && above > below;
  const top = up
    ? Math.max(margin, Math.round(r.top - gap - height))
    : Math.min(Math.round(r.bottom + gap), Math.max(margin, vh - margin - height));

  root.classList.add('sel--fixed');
  root.classList.toggle('sel--up', up);
  pop.style.setProperty('--sel-top', `${top}px`);
  pop.style.setProperty('--sel-left', `${left}px`);
  pop.style.setProperty('--sel-width', `${width}px`);
}

/**
 * Пересчёт при прокрутке и повороте экрана.
 *
 * Список привязан к кнопке: если страница уехала, а список остался висеть
 * в воздухе, это выглядит поломкой. Считаем не на каждое событие, а раз
 * в кадр — прокрутка их шлёт десятками.
 */
let placeFrame = 0;
function replant() {
  if (placeFrame) return;
  const run = () => {
    placeFrame = 0;
    for (const root of [...openRoots]) {
      const btn = toggleOf(root);
      if (!btn || !btn.isConnected) { close(root); continue; }
      place(root);
    }
  };
  placeFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(run)
    : setTimeout(run, 16);
}

function open(root, { focusOption = null } = {}) {
  if (!root) return;
  closeAll(root);
  root.classList.add(OPEN);
  toggleOf(root)?.setAttribute('aria-expanded', 'true');
  const pop = popOf(root);
  if (pop) pop.hidden = false;
  const veil = root.querySelector('[data-sel-veil]');
  if (veil) veil.hidden = false;
  openRoots.add(root);

  place(root);

  if (focusOption) {
    const list = optionsOf(root);
    const at = Math.max(0, list.findIndex((o) => o.dataset.selValue === focusOption));
    // preventScroll: список не должен тянуть за собой страницу при открытии.
    list[at]?.focus({ preventScroll: true });
  }
}

/**
 * Выбор варианта: обновляем закрытый вид, скрытое поле и сообщаем об этом
 * странице. Событие `change` вешаем на корень и пускаем вверх — страница
 * слушает его как обычное изменение поля и перерисовывается.
 */
function choose(root, value) {
  const opt = optionsOf(root).find((o) => o.dataset.selValue === String(value));
  if (!opt) return;

  const input = root.querySelector('[data-sel-input]');
  if (input && input.value !== opt.dataset.selValue) input.value = opt.dataset.selValue;

  const btn = toggleOf(root);
  const mark = btn?.querySelector('.sel__mark');
  const optMark = opt.querySelector('.sel__mark');
  const label = btn?.querySelector('.sel__label');
  const hint = btn?.querySelector('.sel__hint');
  const optText = opt.querySelector('.sel__text');
  const optLabel = optText?.querySelector('b')?.textContent ?? '';
  const optHint = optText?.querySelector('small')?.textContent ?? '';

  if (label) label.textContent = optLabel;
  if (hint) hint.textContent = optHint;
  if (hint && !optHint) hint.remove();
  if (!hint && optHint) {
    const el = document.createElement('small');
    el.className = 'sel__hint';
    el.textContent = optHint;
    btn?.querySelector('.sel__text')?.appendChild(el);
  }
  if (mark && optMark) mark.textContent = optMark.textContent;
  else if (!mark && optMark) {
    const el = document.createElement('span');
    el.className = 'sel__mark';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = optMark.textContent;
    btn?.prepend(el);
  } else if (mark && !optMark) mark.remove();

  for (const o of optionsOf(root)) {
    const on = o === opt;
    o.classList.toggle('is-on', on);
    o.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  if (btn) btn.setAttribute('aria-activedescendant', opt.id);

  close(root);
  toggleOf(root)?.focus({ preventScroll: true });
  input?.dispatchEvent(new Event('change', { bubbles: true }));
  input?.dispatchEvent(new Event('input', { bubbles: true }));
  // Отдельное событие: странице бывает нужно знать, что изменил именно список,
  // а не текстовое поле с тем же именем.
  root.dispatchEvent(new CustomEvent('sel:change', {
    bubbles: true,
    detail: { name: root.dataset.selName, value: opt.dataset.selValue },
  }));
}

/** Перемещение по вариантам стрелками и вводом буквы. */
function move(root, from, delta) {
  const list = optionsOf(root);
  if (!list.length) return;
  const at = list.indexOf(from);
  const next = at === -1
    ? (delta > 0 ? 0 : list.length - 1)
    : (at + delta + list.length) % list.length;
  list[next]?.focus();
}

function firstByChar(root, char) {
  const list = optionsOf(root);
  const needle = char.toLowerCase();
  return list.find((o) => (o.querySelector('b')?.textContent ?? '').trim().toLowerCase().startsWith(needle)) ?? null;
}

/**
 * Ставит обработчики один раз на документ. Вызывается со страницы, где списки
 * есть (чаты) — не из index.html, чтобы не тащить компонент на те страницы,
 * где его нет.
 */
export function initSelects() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t?.closest) return;

    if (t.closest('[data-sel-veil]')) {
      closeAll();
      return;
    }

    const toggle = t.closest('[data-sel-toggle]');
    if (toggle) {
      const root = rootOf(toggle);
      if (isOpen(root)) close(root);
      else open(root, { focusOption: root?.querySelector('[data-sel-input]')?.value ?? null });
      return;
    }

    const opt = t.closest('[data-sel-option]');
    if (opt) {
      // preventDefault: кнопка внутри <form> без этого отправила бы форму.
      e.preventDefault();
      choose(rootOf(opt), opt.dataset.selValue);
      return;
    }

    if (openRoots.size && !t.closest('[data-sel]')) closeAll();
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t?.closest) return;

    const root = rootOf(t);
    if (!root) {
      if (e.key === 'Escape') closeAll();
      return;
    }

    if (e.key === 'Escape') {
      e.stopPropagation();
      close(root);
      toggleOf(root)?.focus({ preventScroll: true });
      return;
    }

    if (t.matches('[data-sel-toggle]')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        // Enter и пробел на кнопке и так открывают список кликом, но не всегда:
        // на кнопке внутри формы пробел листает страницу.
        e.preventDefault();
        const input = root.querySelector('[data-sel-input]');
        open(root, { focusOption: e.key === 'ArrowUp' ? lastValue(root, input) : input?.value ?? null });
      }
      return;
    }

    if (!t.matches('[data-sel-option]')) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault(); move(root, t, 1); break;
      case 'ArrowUp':
        e.preventDefault(); move(root, t, -1); break;
      case 'Home': {
        e.preventDefault();
        optionsOf(root)[0]?.focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        const list = optionsOf(root);
        list[list.length - 1]?.focus();
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        choose(root, t.dataset.selValue);
        break;
      }
      case 'Tab':
        close(root);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const hit = firstByChar(root, e.key);
          if (hit) { e.preventDefault(); hit.focus(); }
        }
    }
  });

  /*
    Потеря фокуса всей страницы (переключились на другую вкладку) закрывает
    список: вернувшись, человек не должен увидеть меню, которое он не открывал.
  */
  window.addEventListener('blur', () => closeAll());

  // Прокрутка (в том числе внутри колонки чата) и поворот экрана: список
  // следует за кнопкой, а не остаётся висеть на прежнем месте.
  window.addEventListener('scroll', replant, { passive: true, capture: true });
  window.addEventListener('resize', replant);
  window.addEventListener('orientationchange', replant);
}

function lastValue(root, input) {
  const list = optionsOf(root);
  return list[list.length - 1]?.dataset.selValue ?? input?.value ?? null;
}

/* Скриптовая правка: значение можно выставить и не открывая список. */
export function setSelectValue(root, value) {
  if (root) choose(rootOf(root) ?? root, value);
}
