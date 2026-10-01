/*
  ПОИСК ПО СПРАВОЧНИКУ — поведение поля.

  Смысл один: набрал слово — список поделся, убрал слово — список вернулся.
  Остальное — последствия.

  ПОЧЕМУ ПЕРЕРИСОВЫВАЕТСЯ ТОЛЬКО КОНТЕЙНЕР РЕЗУЛЬТАТОВ.
  Поле ищёт по 54 тысячам знаков, то есть человек печатает и каждый знак даёт
  новый список. Если перерисовывать страницу целиком, курсор прыгает из поля,
  а вместе с курсором улетает и набранное. Поэтому контейнер `data-hb-results`
  остаётся единственный, кто меняется, — поле, шапка и меню не трогаются.
  Тот же приём держит форму заметок на странице обновлений.

  ПОЧЕМУ ЗАПРОС УХОДИТ В АДРЕС.
  «Вот это место в правиле про засаду» пересылают в чат ссылкой. Ссылка
  обязана открываться уже с результатами, а не с пустым полем: иначе человек
  кинет адрес, а тот покажет ему список разделов. replaceState — потому что
  на каждый нажатый знак назад не ходят, и история из двадцати состояний
  одного слова была бы вредна.
*/
import { renderResults, renderSections } from '../pages/handbook.js?v=77';

/**
 * Адрес с текущим запросом — ровно то, что кинут в чат.
 *
 * Путь берётся из теперешнего адреса, а не пишется заново: поиск по
 * справочнику живёт теперь внутри вкладки «Гайды», и жёсткий «#/handbook»
 * уводил бы человека на другую страницу прямо во время набора буквы.
 */
function writeQuery(query) {
  const path = location.hash.split('?')[0] || '#/guides';
  const q = query.trim();
  const hash = q ? `${path}?q=${encodeURIComponent(q)}` : path;
  try {
    history.replaceState(null, '', hash);
  } catch (_) {
    /* Файл, открытый двойным кликом (file://), replaceState не умеет: адрес
       не записан, и это единственный минус — поиск работает как работал. */
  }
}

/** Перерисовка только контейнера: с результатами или с разделами. */
function refresh(input) {
  const box = input.closest('[data-hb-wrap]')?.querySelector('[data-hb-results]')
    || document.querySelector('[data-hb-results]');
  if (!box) return;
  const query = input.value;
  box.innerHTML = query.trim() ? renderResults(query) : renderSections();
}

document.addEventListener('input', (e) => {
  const input = e.target.closest?.('[data-hb-query]');
  if (!input) return;
  refresh(input);
  writeQuery(input.value);
});

document.addEventListener('keydown', (e) => {
  const input = e.target.closest?.('[data-hb-query]');
  if (!input) return;

  if (e.key === 'Escape') {
    if (!input.value) return;
    input.value = '';
    refresh(input);
    writeQuery('');
    return;
  }

  /* Enter ведёт в первый результат: искать глазами по ссылке человек будет
     сам, а одно нажатие сразу открывает нужный гайд. */
  if (e.key === 'Enter') {
    const first = document.querySelector('[data-hb-results] .hb-hit > a');
    if (first?.getAttribute('href')) {
      e.preventDefault();
      location.hash = first.getAttribute('href').replace(/^#/, '');
    }
  }
});
