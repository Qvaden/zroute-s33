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
import { forum } from '../forum/index.js';

(function () {
  'use strict';

  /*
    ЭКРАНИРОВАНИЕ — СВОЁ, А НЕ ИЗ helpers.js.

    Файл намеренно живёт без import (кроме форума) и вставляется в собранное
    превью как есть, поэтому свои помощники у него свои. Без них текст
    комментария, ник автора и адрес картинки попадали в разметку сырыми:
    ник из базы — это строка, которую вводит человек.
  */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* То же для значения атрибута: кавычка внутри значения закрыла бы его. */
  function escAttr(s) {
    return esc(s);
  }

  var currentType = 'all';
  var currentYear = 'all';
  var currentMonth = null;
  /* Выбранная вручную неделя. null — показываем самую свежую из видимых. */
  var currentWeek = null;

  /*
    Сколько свежих плашек видно сразу, остальные — за кнопкой «Показать все».
    expandedWeeks — нажал человек кнопку и смотрит весь список целиком.
  */
  var WEEKS_SHOWN = 4;
  var expandedWeeks = false;

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  /*
    Переключатель — это два способа сказать одно и то же: класс `is-on` видит
    глаз, `aria-pressed` слышит программа экрана. Расхождение их — самая
    противная поломка доступности: кнопка подсвечена, а читатель докладывает
    «не нажато». Поэтому состояние ставится только здесь, одним вызовом, и ни
    один ряд (типы, годы, месяцы) не имеет права подсветить без объявления.
  */
  function setPressed(btn, on) {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /**
   * Рендер комментариев под событием.
   *
   * ИД СОБЫТИЯ БЕРЁТСЯ ИЗ САМОГО БЛОКА, а не из аргумента: блок помечен
   * `data-tl-comments-box="<id>"`, и раньше код читал несуществующее
   * `dataset.tlCommentsFor` — получался `undefined` в атрибуте формы, и
   * отправка комментария уходила в никуда. Аргумент `eventId` оставлен
   * только как запасной путь: блок — единственный, кто знает свой id.
   */
  function eventIdOf(box) {
    return (box && box.dataset.tlCommentsBox) || '';
  }

  function commentForm(eventId) {
    return '<form class="tl__comment-form" data-tl-comment-form="' + escAttr(eventId) + '">' +
      '<input name="body" placeholder="Напишите комментарий…" maxlength="2000" required>' +
      '<button type="submit">Отправить</button>' +
    '</form>';
  }

  function renderEventComments(box, eventId, list) {
    if (!box) return;
    var id = eventId || eventIdOf(box);
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<p class="tl__comment-note">Комментариев нет. Будь первым!</p>' +
        commentForm(id);
      return;
    }
    box.innerHTML =
      '<ol class="tl__comments-list">' +
        list.map(function (c) {
          var time = c.createdAt ? new Date(c.createdAt).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
          return '<li class="tl__comment">' +
            '<span class="tl__comment-avatar">' +
              (c.authorAvatar
                ? '<img src="' + escAttr(c.authorAvatar) + '" alt="">'
                : esc(c.authorNick ? c.authorNick.charAt(0).toUpperCase() : '?')) +
            '</span>' +
            '<div class="tl__comment-body">' +
              '<div class="tl__comment-head">' +
                '<a class="tl__comment-nick" href="#/user/' + encodeURIComponent(c.authorNick || '') + '">' + esc(c.authorNick || '—') + '</a>' +
                '<span class="tl__comment-time">' + esc(time) + '</span>' +
                '<button type="button" class="tl__comment-del" data-tl-comment-del="' + escAttr(c.id) + '" title="Удалить">✕</button>' +
              '</div>' +
              '<p class="tl__comment-text">' + (c.deleted ? '<em>Комментарий удалён</em>' : esc(c.body)) + '</p>' +
            '</div>' +
          '</li>';
        }).join('') +
      '</ol>' +
      commentForm(id);
  }

  /**
   * Состояния блока комментариев.
   *
   * Раньше их было два: «Загружаем…» и результат. Отказа запроса человек не
   * видел вовсе — смена вкладки или обрыв связи оставляли «Загружаем…»
   * навсегда, и блок выглядел поломанным.
   *
   * Теперь состояний три, и каждое говорит, что делать дальше:
   *   загрузка — идёт запрос (индикатор);
   *   ошибка    — запрос не прошёл, есть кнопка «Попробовать снова»;
   *   успех    — комментарии на месте.
   */
  function renderCommentsLoading(box) {
    box.innerHTML = '<p class="tl__comment-note tl__comment-note--wait">Загружаем…</p>';
    box.setAttribute('aria-busy', 'true');
  }

  function renderCommentsError(box, message) {
    box.removeAttribute('aria-busy');
    box.innerHTML =
      '<p class="tl__comment-note tl__comment-note--err">' +
        esc(message || 'Не удалось загрузить комментарии.') +
      '</p>' +
      '<button type="button" class="tl__comment-retry" data-tl-comments-retry="' +
        escAttr(eventIdOf(box)) + '">Попробовать снова</button>';
  }

  /**
   * Загрузка комментариев записи.
   *
   * Четыре состояния, и ни одно не оставляет человека перед надписью
   * «Загружаем…» навсегда:
   *   идёт запрос — индикатор и aria-busy;
   *   успех       — комментарии;
   *   отказ       — понятное сообщение и кнопка «Попробовать снова»;
   *   повтор      — тот же запрос ещё раз.
   *
   * Гонка учтена: человек может нажать «Комментарии» дважды или уйти со
   * страницы, пока идёт запрос. Ответ приходит в тот же блок, поэтому
   * блок сверяет, что он всё ещё тот же и всё ещё открыт, — иначе поздний
   * ответ переписал бы уже свёрнутый блок.
   */
  function loadEventComments(box, eventId) {
    box.classList.add('is-loaded');
    box.classList.remove('is-error');
    renderCommentsLoading(box);

    forum.listEventComments(eventId).then(function (list) {
      // Блок могли свернуть или открыть другой, пока шёл запрос.
      if (!box.isConnected || box.dataset.tlCommentsBox !== eventId) return;
      box.removeAttribute('aria-busy');
      box.classList.remove('is-error');
      renderEventComments(box, eventId, list);
    }).catch(function (err) {
      if (!box.isConnected || box.dataset.tlCommentsBox !== eventId) return;
      box.removeAttribute('aria-busy');
      box.classList.add('is-error');
      var message = String(err && err.message ? err.message : '');
      renderCommentsError(
        box,
        message && message !== 'Failed to fetch'
          ? message
          : 'Не удалось загрузить комментарии — проверьте связь.'
      );
    });
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
      МЕСЯЦЫ-ПАПКИ.

      Записи сложены по месяцам (см. renderFeed), поэтому прятать надо не только
      сами записи, но и папку целиком, если внутри после фильтра ничего
      не осталось. Иначе получается «сентябрь (0)» — заголовок, за которым
      пустота, и человек нажимает на него, ожидая содержимого.

      Заодно раскрываем папку, в которой что-то нашлось: смысл фильтра
      в том, чтобы увидеть найденное, а не искать его внутри свёрнутых месяцев.
    */
    each(list.querySelectorAll('[data-tl-month]'), function (month) {
      var visible = 0;
      each(month.querySelectorAll('[data-tl-type]'), function (li) {
        if (!li.hidden) visible++;
      });

      month.hidden = visible === 0;

      var group = month.querySelector('[data-tl-group]');
      if (!group) return;

      /*
        Счётчик показывает, сколько видно СЕЙЧАС, а не сколько есть всего:
        при фильтре «только захваты» цифра 12 рядом с тремя записями врёт.
      */
      var count = month.querySelector('.tl__group-count');
      if (count) {
        if (count.dataset.total == null) count.dataset.total = count.textContent;
        count.textContent = currentType === 'all' ? count.dataset.total : String(visible);
      }

      // Фильтр включён — раскрываем найденное. Снят — возвращаем как было.
      if (currentType !== 'all' || currentMonth) group.open = visible > 0;
      else group.open = group.dataset.tlDefaultOpen === '1';
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
      if (inRange(btn.dataset.tlYm)) visible.push(btn);
    });

    /*
      Список режем до нескольких самых свежих — записей со временем десятки,
      и лента в шапке съедает экран. Кнопка открывает остальное; пока она
      не нажата, видно только первые WEEKS_SHOWN плашек (свежие сверху).
    */
    var shown = expandedWeeks ? visible : visible.slice(0, WEEKS_SHOWN);
    each(pills, function (btn) {
      btn.parentElement.hidden = shown.indexOf(btn) === -1;
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

    /*
      Кнопка подстраивается под фильтр: число в ней — сколько плашек спрятано
      сейчас, а не сколько всего в летописи. Нажата — становится «Свернуть».
    */
    var more = document.querySelector('[data-tl-more]');
    if (more) {
      var hiddenCount = visible.length - WEEKS_SHOWN;
      more.hidden = hiddenCount <= 0;
      more.setAttribute('aria-expanded', String(expandedWeeks));
      more.textContent = expandedWeeks ? 'Свернуть список' : 'Показать все (' + hiddenCount + ')';
    }

    var none = document.querySelector('[data-tl-noweeks]');
    if (none) none.hidden = visible.length !== 0;
  }

  /**
   * Переход от вердикта в шапке к записи в ленте ниже.
   *
   * Фильтры могли спрятать цель (тип, год, месяц) — тогда сначала снимаем их,
   * чтобы переходить было к чему. Отказ от сохранения выбора осознанный:
   * прыжок полезен, когда записи НЕ видно, а когда она и так на экране,
   * фильтры трогать не нужно.
   */
  function jumpToEvent(id) {
    var target = document.querySelector('[data-tl-id="' + id + '"]');
    if (!target) return;

    if (target.hidden) {
      showAllEvents();
      target = document.querySelector('[data-tl-id="' + id + '"]');
      if (!target) return;
    }

    // Запись в свёрнутом месяце не видна — раскрываем папку заранее.
    var group = target.closest('[data-tl-group]');
    if (group && !group.open) group.open = true;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Вспышка показывает, куда прыгнули, — иначе взгляд ищет сам.
    target.classList.add('is-flash');
    setTimeout(function () { target.classList.remove('is-flash'); }, 1100);
  }

  /** Снять фильтры и показать список целиком — для прыжка к записи. */
  function showAllEvents() {
    currentType = 'all';
    currentYear = 'all';
    currentMonth = null;
    expandedWeeks = false;
    each(document.querySelectorAll('.seg [data-tl-filter]'), function (b) {
      setPressed(b, b.dataset.tlFilter === 'all');
    });
    syncPick();
    apply();
  }

  /** Месяцы показываем только для выбранного года — иначе их будет двенадцать на год. */
  function applyMonths() {
    each(document.querySelectorAll('[data-tl-mo]'), function (btn) {
      var year = btn.dataset.tlMo.slice(0, 4);
      btn.hidden = currentYear === 'all' || year !== currentYear;
      setPressed(btn, btn.dataset.tlMo === currentMonth);
    });

    var row = document.querySelector('[data-tl-months]');
    if (row) row.hidden = currentYear === 'all';

    each(document.querySelectorAll('[data-tl-yr]'), function (btn) {
      setPressed(btn, btn.dataset.tlYr === currentYear);
    });
  }

  function apply() {
    applyMonths();
    applyWeeks();
    applyFeed();
  }

  /* ── Выпадающий список «Тип» (телефон) ─────────────────────────────────── */
  function setPickOpen(pick, open) {
    pick.classList.toggle('is-open', open);
    var btn = pick.querySelector('[data-pick-open]');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  function closePicks() {
    each(document.querySelectorAll('.pick.is-open'), function (pick) {
      setPickOpen(pick, false);
    });
  }

  /** Подпись на кнопке и галочка в списке — за выбранным типом. */
  function syncPick() {
    var pick = document.querySelector('.pick--tl');
    if (!pick) return;
    var label = null;
    each(pick.querySelectorAll('.pick__opt'), function (opt) {
      var on = opt.dataset.tlFilter === currentType;
      opt.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) label = opt.textContent;
    });
    var val = pick.querySelector('.pick__val');
    if (val) val.textContent = label || 'Все';
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    // Клик мимо открытого списка закрывает его.
    if (!e.target.closest('.pick')) closePicks();

    var openBtn = e.target.closest('[data-pick-open]');
    if (openBtn) {
      var pick = openBtn.closest('.pick');
      /*
        Чужие списки не трогаем: у форума свой делегат на document, и оба
        обработчика ловят один и тот же клик. Форумная кнопка уже раскрыта
        хронологией — второй удар по ней закрывает обратно.
      */
      if (!pick || !pick.classList.contains('pick--tl')) return;
      var wantOpen = !pick.classList.contains('is-open');
      closePicks();
      if (wantOpen) setPickOpen(pick, true);
      return;
    }

    var typeBtn = e.target.closest('[data-tl-filter]');
    if (typeBtn) {
      currentType = typeBtn.dataset.tlFilter;
      each(document.querySelectorAll('.seg [data-tl-filter]'), function (b) {
        setPressed(b, b === typeBtn);
      });
      // Выбор в списке закрывает его; на сегментах безвредно.
      if (typeBtn.closest('.pick')) closePicks();
      syncPick();
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

    var moreBtn = e.target.closest('[data-tl-more]');
    if (moreBtn) {
      expandedWeeks = !expandedWeeks;
      applyWeeks();
      return;
    }

    // Вердикт в шапке — кликабельный переход к записи в ленте ниже.
    var openCard = e.target.closest('[data-tl-open]');
    if (openCard) {
      jumpToEvent(openCard.dataset.tlOpen);
      return;
    }

    var weekBtn = e.target.closest('[data-tl-week]');
    if (weekBtn) {
      currentWeek = weekBtn.dataset.tlWeek;
      applyWeeks();
    }

    /* ── Комментарии к событиям ─────────────────────────────────────── */
    /*
      Кнопка «Комментарии» и кнопка «Попробовать снова» работают по одному
      правилу: обе зовут одну и ту же загрузку, обе берут id из своего блока.

      Раньше id брался из `dataset.tlCommentsFor` блока — атрибута такого
      у блока нет, он помечен `data-tl-comments-box`, и в форму уходил
      `undefined`. Теперь id берётся из блока по-настоящему, и нажатие
      открывает комментарии ИМЕННО той записи, у которой нажали: блок
      ищется по id из кнопки, а не «первый на странице».
    */
    var commentToggle = e.target.closest('[data-tl-comments-for]');
    var commentRetry = e.target.closest('[data-tl-comments-retry]');
    if (commentToggle || commentRetry) {
      var src = commentToggle || commentRetry;
      var wantedId = src.dataset.tlCommentsFor || src.dataset.tlCommentsRetry;
      if (!wantedId) return;
      var box = document.querySelector('[data-tl-comments-box="' + CSS.escape(wantedId) + '"]');
      if (!box) return;

      // Повторный клик по «Комментарии» — свернуть. Кнопка «Попробовать
      // снова» не сворачивает: человек просит повторить запрос.
      if (commentToggle && box.classList.contains('is-loaded') && !box.classList.contains('is-error')) {
        box.innerHTML = '';
        box.classList.remove('is-loaded', 'is-error');
        box.removeAttribute('aria-busy');
        return;
      }

      loadEventComments(box, wantedId);
      return;
    }

    var commentDel = e.target.closest('[data-tl-comment-del]');
    if (commentDel) {
      var cid = commentDel.dataset.tlCommentDel;
      var container = commentDel.closest('[data-tl-comments-box]');
      if (!container || !cid) return;
      if (!confirm('Удалить комментарий?')) return;
      forum.deleteEventComment(cid).then(function () {
        var evId = container.dataset.tlCommentsBox;
        return forum.listEventComments(evId);
      }).then(function (list) {
        renderEventComments(container, container.dataset.tlCommentsBox, list);
      }).catch(function (err) {
        alert(String(err?.message ?? err));
      });
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-tl-comment-form]');
    if (!form) return;
    e.preventDefault();
    var eventId = form.dataset.tlCommentForm;
    /* Запись без id — отправлять некуда: раньше здесь уходил `undefined`. */
    if (!eventId) return;
    var input = form.querySelector('input[name="body"]');
    if (!input || !input.value.trim()) return;
    var btn = form.querySelector('button[type="submit"]');
    var box = form.closest('[data-tl-comments-box]');
    if (btn) btn.disabled = true;
    forum.addEventComment(eventId, input.value).then(function () {
      input.value = '';
      return forum.listEventComments(eventId).then(function (list) {
        if (box && box.isConnected) renderEventComments(box, eventId, list);
      });
    }).catch(function (err) {
      /*
        Отказ показываем в блоке, а не в системном окне: человек на телефоне
        не видит, что именно сломалось, и окно перебивает вёрстку. Текст
        ошибки базы полезен — он называет причину.
      */
      var message = String(err && err.message ? err.message : '');
      if (box && box.isConnected) {
        box.classList.add('is-error');
        box.insertAdjacentHTML(
          'afterbegin',
          '<p class="tl__comment-note tl__comment-note--err">' +
            esc(message && message !== 'Failed to fetch'
              ? message
              : 'Не удалось отправить комментарий — проверьте связь.') +
          '</p>'
        );
      } else {
        alert(message || 'Не удалось отправить комментарий.');
      }
    }).finally(function () {
      if (btn) btn.disabled = false;
    });
  });

  // Esc закрывает выпадающий список, если он раскрылся и загородил страницу;
  // Enter и пробел на вердикте работают как клик (div-сслыка на запись).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePicks(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest) {
      var open = e.target.closest('[data-tl-open]');
      if (open) {
        e.preventDefault();
        jumpToEvent(open.dataset.tlOpen);
      }
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
    expandedWeeks = false;
    syncPick();
    apply();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
