/*
  ФИЛЬТРЫ ХРОНОЛОГИИ.

  Две независимые оси: тип события (захваты, войны, слияния) и календарь
  (год → месяц). Календарь заодно выбирает, чей вердикт показан крупно:
  тыкнул неделю — увидел её итог.

  Почему вердикты не перерисовываются, а переключаются видимостью: страница
  собирается и в один самодостаточный файл превью, где данных для перерисовки
  нет. Один и тот же код обязан работать в обоих местах.

  Как и скрипт рейтинга, файл без import и export и работает через
  делегирование на document — чтобы его можно было и подключить модулем
  в настоящем сайте, и дословно вставить в собранное одним файлом превью.
*/
(function () {
  'use strict';

  var currentType = 'all';
  var currentYear = 'all';
  var currentMonth = null;
  /* Выбранная вручную неделя. null — показываем самую свежую из видимых. */
  var currentWeek = null;

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  /** Попадает ли месяц вида «2026-09» в выбранный год и месяц. */
  function inRange(ym) {
    if (!ym) return currentYear === 'all';
    if (currentMonth) return ym === currentMonth;
    if (currentYear === 'all') return true;
    return ym.slice(0, 4) === currentYear;
  }

  /* ── Лента событий ──────────────────────────────────────────────────────── */
  function applyFeed() {
    var list = document.querySelector('[data-tl-list]');
    if (!list) return;

    var shown = 0;
    each(list.querySelectorAll('[data-tl-type]'), function (li) {
      var okType = currentType === 'all' || li.dataset.tlType === currentType;
      var okDate = inRange(li.dataset.tlYm);
      li.hidden = !(okType && okDate);
      if (!li.hidden) shown++;
    });

    /*
      Разделители годов не должны висеть над пустотой: если после фильтра
      в году не осталось ни одного события, заголовок года тоже прячем.
    */
    each(list.querySelectorAll('[data-tl-year]'), function (divider) {
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

  /* ── Недели и вердикт ───────────────────────────────────────────────────── */
  function applyWeeks() {
    var pills = document.querySelectorAll('[data-tl-week]');
    if (!pills.length) return;

    var visible = [];
    each(pills, function (btn) {
      var ok = inRange(btn.dataset.tlYm);
      var li = btn.parentElement;
      if (li) li.hidden = !ok;
      if (ok) visible.push(btn);
    });

    /*
      Если выбранная неделя выпала из диапазона, выбор сбрасываем: показывать
      вердикт сентября, стоя в фильтре «октябрь», — худший вид неправды,
      потому что выглядит правдой.
    */
    if (currentWeek && !visible.some(function (b) { return b.dataset.tlWeek === currentWeek; })) {
      currentWeek = null;
    }

    // Недели идут от свежих к старым, поэтому первая видимая — самая свежая.
    var target = currentWeek || (visible.length ? visible[0].dataset.tlWeek : null);

    each(pills, function (btn) {
      btn.classList.toggle('is-sel', btn.dataset.tlWeek === target);
    });

    each(document.querySelectorAll('[data-tl-verdict]'), function (card) {
      card.hidden = card.dataset.tlVerdict !== target;
    });

    var none = document.querySelector('[data-tl-noweeks]');
    if (none) none.hidden = visible.length !== 0;
  }

  /** Месяцы показываем только для выбранного года — иначе их будет двенадцать на год. */
  function applyMonths() {
    each(document.querySelectorAll('[data-tl-mo]'), function (btn) {
      var year = btn.dataset.tlMo.slice(0, 4);
      btn.hidden = currentYear === 'all' || year !== currentYear;
      btn.classList.toggle('is-on', btn.dataset.tlMo === currentMonth);
    });

    var row = document.querySelector('[data-tl-months]');
    if (row) row.hidden = currentYear === 'all';

    each(document.querySelectorAll('[data-tl-yr]'), function (btn) {
      btn.classList.toggle('is-on', btn.dataset.tlYr === currentYear);
    });
  }

  function apply() {
    applyMonths();
    applyWeeks();
    applyFeed();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    var typeBtn = e.target.closest('[data-tl-filter]');
    if (typeBtn) {
      currentType = typeBtn.dataset.tlFilter;
      each(document.querySelectorAll('[data-tl-filter]'), function (b) {
        b.classList.toggle('is-on', b === typeBtn);
      });
      applyFeed();
      return;
    }

    var yearBtn = e.target.closest('[data-tl-yr]');
    if (yearBtn) {
      currentYear = yearBtn.dataset.tlYr;
      // Смена года сбрасывает месяц: «сентябрь» прошлого года к новому не относится.
      currentMonth = null;
      currentWeek = null;
      apply();
      return;
    }

    var monthBtn = e.target.closest('[data-tl-mo]');
    if (monthBtn) {
      // Повторное нажатие снимает месяц и возвращает весь год.
      currentMonth = currentMonth === monthBtn.dataset.tlMo ? null : monthBtn.dataset.tlMo;
      currentWeek = null;
      apply();
      return;
    }

    var weekBtn = e.target.closest('[data-tl-week]');
    if (weekBtn) {
      currentWeek = weekBtn.dataset.tlWeek;
      applyWeeks();
    }
  });

  // main.js дёргает после каждой отрисовки — страница появляется асинхронно.
  window.__timelineApply = function () {
    /*
      Состояние сбрасываем: страница перерисована заново, и старый выбор
      относился к предыдущей отрисовке. Кнопки в свежей разметке стоят
      в начальном положении — состояние скрипта обязано с ними совпадать.
    */
    currentType = 'all';
    currentYear = 'all';
    currentMonth = null;
    currentWeek = null;
    apply();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
