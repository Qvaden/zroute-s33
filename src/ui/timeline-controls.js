/*
  Фильтр хронологии по типу события.

  Как и скрипт рейтинга, файл без import и export и работает через
  делегирование на document — чтобы его можно было и подключить модулем
  в настоящем сайте, и дословно вставить в собранное одним файлом превью.
*/
(function () {
  'use strict';

  var current = 'all';

  function apply() {
    var list = document.querySelector('[data-tl-list]');
    if (!list) return;

    var items = list.querySelectorAll('[data-tl-type]');
    var shown = 0;

    Array.prototype.forEach.call(items, function (li) {
      var ok = current === 'all' || li.dataset.tlType === current;
      li.hidden = !ok;
      if (ok) shown++;
    });

    /*
      Разделители годов не должны висеть над пустотой: если после фильтра
      в году не осталось ни одного события, заголовок года тоже прячем.
    */
    Array.prototype.forEach.call(list.querySelectorAll('[data-tl-year]'), function (divider) {
      var hasVisible = false;
      var node = divider.nextElementSibling;
      while (node && !node.hasAttribute('data-tl-year')) {
        if (!node.hidden) { hasVisible = true; break; }
        node = node.nextElementSibling;
      }
      divider.hidden = !hasVisible;
    });

    var empty = document.querySelector('[data-tl-empty]');
    if (empty) empty.hidden = shown !== 0;
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var btn = e.target.closest('[data-tl-filter]');
    if (!btn) return;

    current = btn.dataset.tlFilter;
    Array.prototype.forEach.call(document.querySelectorAll('[data-tl-filter]'), function (b) {
      b.classList.toggle('is-on', b === btn);
    });
    apply();
  });

  // main.js дёргает после каждой отрисовки — страница появляется асинхронно.
  window.__timelineApply = apply;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
