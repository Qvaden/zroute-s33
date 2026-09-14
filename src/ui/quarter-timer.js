/**
 * ТАЙМЕР КВАРТА.
 *
 * Одна функция на сайт: и на странице Кварта, и в боковой колонке форума
 * счётчик живёт по одному механизму. Ведёт интервал, пока на странице есть
 * элемент [data-quarter-end]; при его исчезновении останавливается сам —
 * так форумная перерисовка не плодит вечные интервалы на ушедших вкладках.
 */

let quarterTimer = null;

/** Сколько осталось до конца Кварта в формате «Xд Yч Zм». */
export function formatQuarterLeft(endMs) {
  const ms = Math.max(0, Number(endMs) - Date.now());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${days}д ${hours}ч ${mins}м`;
}

export function startQuarterTimer() {
  stopQuarterTimer();
  const el = document.querySelector('[data-quarter-end]');
  if (!el) return;
  const num = el.querySelector('.quart-countdown-num');
  if (!num) return;
  const endMs = Number(el.dataset.quarterEnd);
  if (!endMs || isNaN(endMs)) return;
  update();
  quarterTimer = setInterval(update, 30000);
}

function update() {
  /*
    Элемент берём заново на каждый тик: форум перерисовывается при смене
    ленты или открытии темы, и старый элемент уже выброшен из DOM. Хвататься
    за него — обновлять невидимый текст. Если элемента нет вовсе — это не
    страница Кварта, интервал можно гасить.
  */
  const el = document.querySelector('[data-quarter-end]');
  const num = el?.querySelector('.quart-countdown-num');
  if (!el || !num) {
    stopQuarterTimer();
    return;
  }
  num.textContent = formatQuarterLeft(el.dataset.quarterEnd);
}

export function stopQuarterTimer() {
  if (quarterTimer) {
    clearInterval(quarterTimer);
    quarterTimer = null;
  }
}