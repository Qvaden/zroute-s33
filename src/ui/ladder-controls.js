/*
  Поиск, фильтр и сортировка рейтинга.

  Файл намеренно без import и export и работает через делегирование событий
  на document. Две причины:

  1. Не нужно ловить момент отрисовки — обработчик висит на документе и
     подхватывает любую страницу рейтинга, когда бы она ни появилась.
  2. Скрипт можно дословно вставить в собранное одним файлом превью
     (scripts/build-preview.mjs так и делает), не дублируя логику.
*/
(function () {
  'use strict';

  var state = { q: '', filter: 'active', sort: 'points' };

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' ' + one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' ' + few;
    return n + ' ' + many;
  }

  var COMPARE = {
    // При равенстве всегда падаем на место в рейтинге — иначе строки
    // произвольно скачут между перерисовками и таблица «дышит».
    points: function (a, b) {
      return (+b.dataset.points - +a.dataset.points) || (+a.dataset.place - +b.dataset.place);
    },
    wins: function (a, b) {
      return (+b.dataset.wins - +a.dataset.wins) || (+a.dataset.place - +b.dataset.place);
    },
    form: function (a, b) {
      return (+b.dataset.form - +a.dataset.form) || (+a.dataset.place - +b.dataset.place);
    },
    name: function (a, b) {
      return a.dataset.name.localeCompare(b.dataset.name, 'ru');
    },
  };

  function apply() {
    var root = document.querySelector('[data-ladder-list]');
    if (!root) return;

    var rows = Array.prototype.slice.call(root.children);
    var q = state.q.trim().toLowerCase();
    var shown = 0;

    rows.forEach(function (row) {
      var byText = !q || row.dataset.name.indexOf(q) > -1 || row.dataset.tag.indexOf(q) > -1;
      var byState = state.filter === 'all' || row.dataset.active === '1';
      var ok = byText && byState;
      row.hidden = !ok;
      if (ok) shown++;
    });

    rows.sort(COMPARE[state.sort] || COMPARE.points);
    // appendChild переносит существующий узел — перерисовки не происходит.
    rows.forEach(function (row) { root.appendChild(row); });

    var empty = document.querySelector('[data-ladder-empty]');
    if (empty) empty.hidden = shown !== 0;

    var count = document.querySelector('[data-ladder-count]');
    if (count) {
      count.textContent = q || state.filter === 'all'
        ? 'Показано ' + shown + ' из ' + rows.length
        : plural(shown, 'активный альянс', 'активных альянса', 'активных альянсов') + ' из ' + rows.length;
    }
  }

  function setActive(group, pressed) {
    var buttons = document.querySelectorAll('[data-ladder-' + group + ']');
    Array.prototype.forEach.call(buttons, function (b) {
      b.classList.toggle('is-on', b === pressed);
    });
  }

  document.addEventListener('input', function (e) {
    var input = e.target.closest ? e.target.closest('[data-ladder-search]') : null;
    if (!input) return;
    state.q = input.value;
    apply();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var input = e.target.closest ? e.target.closest('[data-ladder-search]') : null;
    if (!input) return;
    input.value = '';
    state.q = '';
    apply();
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    var f = e.target.closest('[data-ladder-filter]');
    if (f) {
      state.filter = f.dataset.ladderFilter;
      setActive('filter', f);
      apply();
      return;
    }

    var s = e.target.closest('[data-ladder-sort]');
    if (s) {
      state.sort = s.dataset.ladderSort;
      setActive('sort', s);
      apply();
    }
  });

  /*
    Страница рисуется асинхронно, уже после того как этот файл выполнился,
    поэтому одного прогона на старте мало: без него строки неактивных
    альянсов остались бы видны, хотя кнопка «Активные» подсвечена.
    main.js дёргает эту функцию после каждой отрисовки.
  */
  window.__ladderApply = apply;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  window.addEventListener('hashchange', function () { setTimeout(apply, 0); });
})();
