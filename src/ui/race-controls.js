/*
  График сезона: выбор альянсов и рисование линий.

  Файл, как и соседние *-controls.js, намеренно без import и export: его
  дословно вставляет scripts/build-preview.mjs. Собранная копия сайта — это
  аварийный выход из плана, и график в ней обязан работать тем же кодом, что
  на живом сайте, иначе «резервная версия» начнёт вести себя иначе ровно в
  тот день, когда больше ничего не останется.

  Отсюда два следствия, и оба неприятные, поэтому оговорены.

  1. ЧИСЛА ГРАФИКА ПРИХОДЯТ ИЗ СТРАНИЦЫ. До computeStandings отсюда не
     добраться, поэтому src/pages/ladder.js кладёт серии в блок
     `<script type="application/json">`, а здесь они только читаются.
  2. ГЕОМЕТРИЯ ЖИВЁТ ЗДЕСЬ, А НЕ В ui/chart.js. График перерисовывается на
     каждый выбор, значит рисующий код обязан быть доступен драйверу. Два
     экземпляра геометрии разъезжаются молча — сайт и копия начинают
     показывать разные сезоны.
*/
(function () {
  'use strict';

  var KEY = 's33-race';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /*
    Краска линии и краска подписи. Обе приходят со страницы и обе — ссылка на
    CSS-переменную темы, уже посчитанную на контраст: `var(--aink-a01,#ade773)`.
    Сырой цвет альянса живёт внутри этой ссылки запасным значением, поэтому
    даже без объявленной переменной линия выйдет цветом альянса, а не чёрной.

    Значение берётся из `style`, а не из атрибута `stroke`: атрибутом
    CSS-переменную задать нельзя, и paint остался бы былым HEXом при любой теме.
  */
  function inkOf(r) {
    return r.ink || r.color;
  }

  function labelInkOf(r) {
    return r.inkLabel || r.color;
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' ' + one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' ' + few;
    return n + ' ' + many;
  }

  function store() {
    try { return window.localStorage || null; } catch (_) { return null; }
  }

  function capOf(panel) {
    return +panel.dataset.raceCap || 8;
  }

  function defaultOf(panel) {
    return +panel.dataset.raceDefault || 5;
  }

  function readData(panel) {
    var node = panel.querySelector('[data-race-data]');
    if (!node) return null;
    try {
      var d = JSON.parse(node.textContent);
      if (!d || !Array.isArray(d.lines) || !Array.isArray(d.weeks)) return null;
      return d;
    } catch (_) {
      // Сломанный JSON — не причина ронять страницу: рейтинг выше уже нарисован.
      return null;
    }
  }

  /**
   * Порядок линий — рейтинговый, а не порядок нажатий.
   *
   * Две пересекающиеся линии рисуются в порядке вставки, и если порядок
   * задавать кликами, то от одного нажатия альянсы начинают перехлёстываться
   * местами: человек видит тот же набор, но уже другой график.
   */
  function orderedByRating(data, ids, cap) {
    var want = {};
    ids.forEach(function (id) { want[id] = true; });
    return data.lines
      .filter(function (l) { return want[l.id]; })
      .slice(0, cap)
      .map(function (l) { return l.id; });
  }

  function defaultIds(panel, data) {
    return data.lines
      .filter(function (l) { return l.active; })
      .slice(0, defaultOf(panel))
      .map(function (l) { return l.id; });
  }

  /**
   * Выбранные альянсы: сохранённые, а если их не было — первые N активных.
   *
   * ПОЧЕМУ СОВОК ХРАНИТСЯ В localStorage, А НЕ В АДРЕСЕ. Человек приходит на
   * график сравнить СВОЙ альянс с соседями и возвращается к нему неделями.
   * Адрес для этого не годится: ссылку в чат кидают, чтобы показать всем одно
   * и то же, а выбор у каждого свой.
   *
   * Пустой список — это выбор («Снять все»), а не отсутствие выбора: его
   * нельзя подменять пятерыми лидеров при следующем заходе.
   */
  function chosenIds(panel, data) {
    var cap = capOf(panel);
    var known = {};
    data.lines.forEach(function (l) { known[l.id] = true; });

    var ls = store();
    var raw = null;
    try { raw = ls ? ls.getItem(KEY) : null; } catch (_) { raw = null; }
    if (raw !== null) {
      var saved = null;
      try { saved = JSON.parse(raw); } catch (_) { saved = null; }
      if (Array.isArray(saved)) {
        if (!saved.length) return [];
        var kept = orderedByRating(data, saved.filter(function (id) { return known[id]; }), cap);
        if (kept.length) return kept;
        /*
          В сохранённом списке не осталось ни одного живого альянса: сезон
          переписали, состав распустили. Выбор потерян не по нашей вине, а
          пустой экран с подписью «никого» читается как поломка — знакомые
          пятеро честнее.
        */
      }
    }
    return defaultIds(panel, data);
  }

  function saveIds(ids) {
    var ls = store();
    if (!ls) return;
    try { ls.setItem(KEY, JSON.stringify(ids)); } catch (_) {}
  }

  /*
    ПОЛЕ РИСУЕТСЯ В РЕАЛЬНЫХ ПИКСЕЛЯХ ЭКРАНА.

    До переноса на страницу рейтинга у графика был фиксированный viewBox
    760×260. На телефоне браузер сжимал его в 2,2 раза вместе со всеми
    надписями: кегль, назначенный как 11 px, человек получал примерно пять, и
    теги альянсов нельзя было прочесть без лупы. Именно на это и жаловались —
    «названия должны быть крупнее».

    Здесь ширина берётся у самого контейнера, и единица графика равна одному
    CSS-пикселу: сколько написано, столько и видно. Поэтому же поле
    перерисовывается при смене ширины, а не тянется масштабом.
  */
  function measure(node) {
    var w = node && node.clientWidth ? node.clientWidth : 0;
    if (w) return Math.max(240, Math.round(w));
    /*
      Контейнера ещё нет в макете — так бывает в собранной копии, где все
      страницы лежат в документе сразу и не открытая скрыта через display:none.
      Берём ширину окна за вычетом полей оболочки; настоящий размер поле
      получит при первом же клике на этой странице, и перерисуется само.
    */
    var win = window.innerWidth || 980;
    return Math.max(240, Math.min(760, win - 64));
  }

  function geometry(width) {
    var compact = width < 520;
    return {
      W: width,
      // На телефоне поле выше: строк меньше, зато каждая читается.
      H: compact ? 300 : 264,
      pad: { top: 16, right: compact ? 58 : 70, bottom: 30, left: compact ? 30 : 40 },
      label: compact ? 15 : 13,
      tick: compact ? 12 : 11,
      stroke: compact ? 2.2 : 2.6,
    };
  }

  /**
   * SVG поля по выбранным линиям. `rows` уже отобран и не пуст.
   */
  function chartMarkup(rows, weekNumbers, g) {
    var plotW = g.W - g.pad.left - g.pad.right;
    var plotH = g.H - g.pad.top - g.pad.bottom;
    var n = weekNumbers.length;

    var pool = [];
    rows.forEach(function (r) { pool = pool.concat(r.series); });
    var min = Math.min(0, Math.min.apply(null, pool));
    var max = Math.max(0, Math.max.apply(null, pool));
    // Небольшой запас, чтобы линии и подписи у их концов не липли к краю.
    var pad = Math.max(1, Math.round((max - min) * 0.12));
    min -= pad;
    max += pad;
    var span = (max - min) || 1;

    var x = function (i) { return g.pad.left + (n > 1 ? i / (n - 1) : 0) * plotW; };
    var y = function (v) { return g.pad.top + plotH - ((v - min) / span) * plotH; };

    // Сетка по «круглым» значениям: 5, 10, 25 … а не 7, 14, 21.
    var stepRaw = (max - min) / 4;
    var step = Math.max(1, Math.round(stepRaw / 5) * 5 || Math.round(stepRaw));
    var ticks = [];
    for (var t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);

    var grid = ticks
      .map(function (v) {
        return '<line x1="' + g.pad.left + '" y1="' + y(v).toFixed(1) + '" x2="' + (g.pad.left + plotW).toFixed(1) +
          '" y2="' + y(v).toFixed(1) + '" class="race__grid' + (v === 0 ? ' race__grid--zero' : '') + '"/>' +
          '<text x="' + (g.pad.left - 7).toFixed(1) + '" y="' + (y(v) + g.tick * 0.35).toFixed(1) +
          '" class="race__tick" font-size="' + g.tick + '">' + (v > 0 ? '+' : '') + v + '</text>';
      })
      .join('');

    /*
      Подписи недель режутся на узком поле: двенадцать чисел подряд по
      12 px на 250 px поля превращаются в кашу раньше, чем становится виден
      сам прогиб линии. Последняя неделя печатается всегда — она и есть итог.
    */
    var every = n > 8 ? 2 : 1;
    var xLabels = weekNumbers
      .map(function (num, i) {
        if (i % every !== 0 && i !== n - 1) return '';
        return '<text x="' + x(i).toFixed(1) + '" y="' + (g.H - 9).toFixed(1) +
          '" class="race__tick race__tick--x" font-size="' + g.tick + '">' + esc(num) + '</text>';
      })
      .join('');

    var lines = rows
      .map(function (r) {
        var pts = r.series.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
        return '<polyline points="' + pts + '" fill="none" style="stroke:' + esc(inkOf(r)) +
          '" stroke-width="' + g.stroke + '" stroke-linejoin="round" stroke-linecap="round" class="race__line"/>';
      })
      .join('');

    /*
      Подписи у концов линий обязаны разъезжаться по вертикали.
      Два альянса часто заканчивают сезон с одинаковыми очками, и без
      разведения их теги печатаются друг поверх друга. Точка остаётся на
      настоящем месте, сдвигается только подпись — и, если сдвинули, точка
      соединяется с ней тонкой чёрточкой.
    */
    var gap = g.label + 3;
    /*
      `color` со страницы всегда HEX: страница подставляет общий запасной
      (ui/ink.js, tagColor). Поэтому третьего серого у драйвера нет — без
      импорта он не в праве выдумывать свою краску.
    */
    var ends = rows
      .map(function (r) {
        return {
          tag: r.tag,
          color: r.color,
          ink: inkOf(r),
          inkLabel: labelInkOf(r),
          realY: y(r.series[r.series.length - 1]),
        };
      })
      .sort(function (a, b) { return a.realY - b.realY; });

    ends.forEach(function (e, k) {
      e.labelY = k === 0 ? e.realY : Math.max(e.realY, ends[k - 1].labelY + gap);
    });

    // Если пачка вылезла за нижний край поля — поджать её целиком вверх.
    var overflow = ends.length ? ends[ends.length - 1].labelY - (g.H - g.pad.bottom) : 0;
    if (overflow > 0) ends.forEach(function (e) { e.labelY -= overflow; });

    var lastX = x(n - 1);
    var labels = ends
      .map(function (e) {
        var shifted = Math.abs(e.labelY - e.realY) > 1.5;
        /*
          Точка и подпись берут контрастную краску, чёрточка между ними — нет.
          Она печатается при `opacity=".5"` и служит связью двух знаков, а не
          самостоятельным элементом: требование 3:1 к ней не предъявляют,
          зато требуемое затемнение сделало бы её невидимой на бумаге.
        */
        return '<circle cx="' + lastX.toFixed(1) + '" cy="' + e.realY.toFixed(1) + '" r="3.4" style="fill:' +
          esc(e.ink) + '"/>' +
          (shifted
            ? '<line x1="' + (lastX + 3).toFixed(1) + '" y1="' + e.realY.toFixed(1) + '" x2="' + (lastX + 8).toFixed(1) +
              '" y2="' + e.labelY.toFixed(1) + '" stroke="' + esc(e.color) + '" stroke-width="1" opacity=".5"/>'
            : '') +
          '<text x="' + (lastX + 11).toFixed(1) + '" y="' + (e.labelY + g.label * 0.35).toFixed(1) +
          '" class="race__label" style="fill:' + esc(e.inkLabel) + '" font-size="' + g.label + '">' + esc(e.tag) + '</text>';
      })
      .join('');

    var names = rows.map(function (r) { return r.tag; }).join(', ');
    return '<svg viewBox="0 0 ' + g.W + ' ' + g.H + '" preserveAspectRatio="xMidYMid meet" role="img"' +
      ' aria-label="Накопленные очки по неделям: ' + esc(names) + '">' +
      grid + xLabels + lines + labels + '</svg>';
  }

  function syncChips(panel, ids) {
    var on = {};
    ids.forEach(function (id) { on[id] = true; });
    var chips = panel.querySelectorAll('[data-race-chip]');
    Array.prototype.forEach.call(chips, function (b) {
      var pressed = !!on[b.dataset.raceChip];
      /*
        Класс видит глаз, `aria-pressed` слышит программа экрана. Про одну из
        двух половинок говорить «это же просто подсветка» нельзя: кнопка с
        подсветкой и «не нажато» хуже, чем без обеих.
      */
      b.classList.toggle('is-on', pressed);
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }

  function summary(ids, total, refused) {
    if (refused) return refused;
    if (!ids.length) return 'На поле ни одной линии — отметьте альянсы в списке ниже.';
    return 'На графике ' + plural(ids.length, 'линия', 'линии', 'линий') + ' из ' + total + '.';
  }

  function writeCount(panel, text) {
    var count = panel.querySelector('[data-race-count]');
    if (!count) return;
    /*
      Присваивание вслепую — это замена текстового узла, и зона объявлений
      (`role="status"`) реагирует на неё даже при прежней строке. Без проверки
      счётчик бормотал бы одно и то же при каждой перерисовке.
    */
    if (count.textContent !== text) count.textContent = text;
  }

  var last = '';

  /**
   * Перерисовать поле по текущему выбору.
   *
   * Вызов дешёвый, но не бесплатный: он читает ширину контейнера, то есть
   * заставляет браузер пересчитать макет. Поэтому без перемены выбора и
   * без смены ширины работа не делается — страница рейтинга перерисовывается
   * таймерами и сменой сервера, и каждый такой тик не должен трогать SVG.
   */
  function apply(refused) {
    var panel = document.querySelector('[data-race-panel]');
    if (!panel) return;
    var data = readData(panel);
    if (!data) return;

    var plot = panel.querySelector('[data-race-plot]');
    var ids = chosenIds(panel, data);
    var width = measure(plot);
    var key = width + '|' + ids.join(',');

    if (key === last) {
      /*
        Отказ на превышении предела ничего не меняет в наборе линий, поэтому
        поле перерисовывать незачем — довольно одна строка счётчика.
      */
      if (refused) writeCount(panel, refused);
      return;
    }

    var byId = {};
    data.lines.forEach(function (l) { byId[l.id] = l; });
    var rows = ids.map(function (id) { return byId[id]; }).filter(Boolean);

    if (plot) plot.innerHTML = rows.length ? chartMarkup(rows, data.weeks, geometry(width)) : '';
    var empty = panel.querySelector('[data-race-empty]');
    if (empty) empty.hidden = rows.length !== 0;

    syncChips(panel, ids);
    writeCount(panel, summary(ids, data.lines.length, refused));
    last = key;
  }

  function toggleChip(panel, chip) {
    var data = readData(panel);
    if (!data) return;
    var cap = capOf(panel);
    var ids = chosenIds(panel, data);
    var id = chip.dataset.raceChip;
    var at = ids.indexOf(id);

    if (at > -1) {
      ids.splice(at, 1);
    } else if (ids.length >= cap) {
      /*
        Предел объясняется словами, а не молчаливым отказом. Кнопка, на которую
        отреагировали ничем, читается как сломанная; здесь же человек слышит
        число и знает, какое действие его разблокирует.
      */
      apply('Больше ' + cap + ' линий на поле не помещается. Снимите одну, чтобы добавить эту.');
      return;
    } else {
      ids.push(id);
    }
    saveIds(ids);
    apply();
  }

  function applyPreset(panel, preset) {
    var data = readData(panel);
    if (!data) return;
    var ids = preset === 'none' ? [] : defaultIds(panel, data);
    saveIds(ids);
    apply();
    /*
      После «Снять все» фокус обязан остаться на кнопке, а не повиснуть на
      удалённом узле: кнопки на месте (список не перерисовывается), но выбор
      стал пустым, и без этого шага клавиатура потеряла бы страницу.
    */
    var back = panel.querySelector('[data-race-preset="' + preset + '"]');
    if (back && back.focus) back.focus();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var panel = document.querySelector('[data-race-panel]');
    if (!panel) return;

    var chip = e.target.closest('[data-race-chip]');
    if (chip && panel.contains(chip)) {
      toggleChip(panel, chip);
      return;
    }

    var preset = e.target.closest('[data-race-preset]');
    if (preset && panel.contains(preset)) {
      applyPreset(panel, preset.dataset.racePreset);
      return;
    }

    /*
      Тап по самому полю открывает список. Человек смотрит на график, хочет
      другой набор и жмёт именно на картинку — это первое, что приходит в
      голову, и она должна сработать. Клавиатуре этот путь не нужен: у
      списка есть своя кнопка «Выбрать альянсы».
    */
    var plot = e.target.closest('[data-race-plot]');
    if (plot && panel.contains(plot)) {
      var box = panel.querySelector('[data-race-picker]');
      if (box) box.open = true;
      return;
    }

    // Клик мимо графика: проверяем только ширину (смена страницы в копии).
    apply();
  });

  /*
    Смена размеров окна — не косметика: поле рисуется в пикселах экрана, и
    после поворота телефона прежний SVG остался бы растянутым масштабом, то
    есть ровно с теми мелкими подписями, от которых уходили.
  */
  var timer = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { last = ''; apply(); }, 160);
  });

  window.addEventListener('hashchange', function () {
    window.setTimeout(function () {
      // Вернулись на рейтинг — поле могло сменить ширину, пока нас не было.
      last = '';
      apply();
    }, 0);
  });

  /*
    Страница рисуется асинхронно, уже после того как этот файл выполнился,
    поэтому одного прогона на старте мало. main.js дёргает эту функцию после
    каждой отрисовки — тем же списком хуков, что и фильтры рейтинга.
  */
  window.__raceApply = apply;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(); });
  } else {
    apply();
  }
})();
