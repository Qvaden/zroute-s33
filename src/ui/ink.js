/*
  Краски альянсов, доведённые до контраста.
  ============================================================================
  Цвет альянса — данные, а не вёрстка: его вводит владелец в панели, и в
  таблице он любой. В тёмной теме почти любая краска яркая и на тёмной
  подложке читается. На светлой бумаге та же краска тонет: по правилу этого
  файла (подложка пластинки, прозрачность самого бледного потребителя) худшая
  из 28 живых красок даёт 1,13:1 (#d8eb47), а #ade773 — 1,22:1, #51e1aa —
  1,37:1, #ed925a и #6ab0dc — 1,84:1. Порог для линии, точки и любой графики,
  несущей смысл, — 3:1 (WCAG 1.4.11), для подписи из тех же красок — 4,5:1 (1.4.3).

  ПОЧЕМУ ЗНАЧЕНИЯ СЧИТАЮТСЯ ДЛЯ ОБЕИХ ТЕМ ОДНОВРЕМЕННО.
  Переключатель темы перекрашивает документ через CSS: `applyTheme` в main.js
  меняет атрибут `data-theme` и больше ничего. Если бы краска считалась в JS
  при отрисовке страницы, после переключения темы на экране остались бы
  чернила прежней темы — линия, нарисованная для бумаги, лежала бы на ночном
  фоне. Поэтому для каждого альянса считаются ОБА значения и кладутся в
  переменные, которые темы разбирают сами:

      :root[data-theme="light"] { --aink-a01: …; --ainkt-a01: …; }
      :root[data-theme="dark"]  { --aink-a01: …; --ainkt-a01: …; }

  Отрисовка тогда ссылается именем (`var(--aink-a01,#d44949)`), а не числом,
  и перерисовки при смене темы не нужно. Это же держит на месте собранную
  копию сайта: её разметка печатается один раз при сборке и темами уже не
  пересобирается.

  ПОЧЕМУ ПОДЛОЖКА В РАСЧЁТЕ — САМАЯ НЕПРИЯТНАЯ ТОЧКА КАРТОЧКИ, А НЕ `--bg`.
  Линию рисует не фон страницы, а пластинка панели: `--plate-grad` кладёт
  карточку на `--raised-2` с переходом в `--surface`, а строка рейтинга сверху
  добавляет подкраску из 3,5 % чернил темы. Поэтому за основу берётся слой,
  на котором контраст минимален: в светлой теме — самый тёмный из четырёх
  (`#f2eee8`, подкраска строки на нижней ступени пластинки), в тёмной — самый
  светлый (`#26303d`, та же подкраска на верхней ступени). Считать по `--bg`
  было бы самообманом: замер по живым краскам дал бы на `--bg` 3,02:1 там, где
  на настоящем слое линии лежит 2,24:1 (это #695ad8 с прозрачностью 0,85).

  ПОЧЕМУ В РАСЧЁТЕ СТОИТ ПРОЗРАЧНОСТЬ 0,85, ХОТЯ ЛИНИИ РИСУЮТСЯ СПЛОШЬ.
  Одной краской рисуют и сплошные линии (2,6–2,8 px), и полупрозрачные
  точки (`placeChart`, opacity .85) и sparkline (0,9). Порог проверяется по
  самому бледному из потребителей — иначе точка в 2,7:1 формально считалась
  бы «исправленной». Сплошная линия от этого только выигрывает: вместо 3:1
  она получает 3,46:1 на бумаге и 3,62:1 в ночи, а глазу эта разница не видна.
  (Оба числа — худшая из 28 красок живого графика, а не средняя.)

  НОЧЬ ПРАВИТ НЕ МЕНЬШЕ, ЧЕМ ДЕНЬ. При честной подложке ночная тема тоже
  оказалась с провалами: худшая линия — 2,22:1 (#8f49d4), худшая подпись —
  2,58:1 (#695ad8). Поэтому функция двигает краску в обеих темах, и
  тест сверяет порог по обеим, а не по одной.
*/

/*
  Пороги и подложки. Числа подложек и чернил выведены из токенов тем в
  styles-v8.css (ступени лестницы плюс подкраска строки рейтинга) — совпадение
  проверяет тест, потому что правка токена темы без этой строки молча вернула
  бы блёклые линии.
*/
export const INK = {
  light: { surface: '#eff0ed', ink: '#202124', stroke: 3, label: 4.5, fade: 0.85 },
  dark: { surface: '#292f38', ink: '#f1f5f9', stroke: 3, label: 4.5, fade: 0.85 },
};

/* Краска «альянс без краски»: тот же серый, что подставляют страницы. */
export const NO_ALLIANCE_COLOR = '#7a8494';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Любой ли это HEX (тройной или шестизначный); всё остальное — не краска. */
export function isColor(value) {
  return typeof value === 'string' && HEX.test(value.trim());
}

/**
 * Краска плашки альянса: своя, если в базе лежит HEX, иначе общий запасной.
 * Один владелец у запасного числа: страницы подставляли то #7a8494, то
 * #8a93a2, и «альянс без краски» выглядел двумя разными серыми.
 */
export function tagColor(color) {
  return isColor(color) ? color.trim() : NO_ALLIANCE_COLOR;
}

function toRgb(hex) {
  const h = hex.trim().replace('#', '').toLowerCase();
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/* Относительная яркость по WCAG 2.x (sRGB, линейная составляющая). */
export function luminance(rgb) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

/** Контраст двух цветов, как его считает WCAG: 1…21. */
export function contrastRatio(a, b) {
  const la = luminance(typeof a === 'string' ? toRgb(a) : a);
  const lb = luminance(typeof b === 'string' ? toRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Что увидит глаз, если положить `color` с альфой на `surface`. */
function composited(color, surface, alpha) {
  if (alpha >= 1) return color;
  const c = toRgb(color);
  const s = toRgb(surface);
  return toHex({
    r: c.r * alpha + s.r * (1 - alpha),
    g: c.g * alpha + s.g * (1 - alpha),
    b: c.b * alpha + s.b * (1 - alpha),
  });
}

/* HSL — чтобы краску двигать по одной светлоте, не теряя тон и насыщенность:
   смешение с чёрным превратило бы салатовый в грязь, а шагалка по L оставляет
   ему шанс остаться узнаваемым. */
function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: Math.round(ch(h + 1 / 3) * 255), g: Math.round(ch(h) * 255), b: Math.round(ch(h - 1 / 3) * 255) };
}

/**
 * Краска, доведённая до контраста с подложкой темы.
 *
 * @param {string} color HEX из данных (что угодно не-HEX возвращается как есть)
 * @param {'light'|'dark'} theme
 * @param {'stroke'|'label'} stroke — линии, точки, заливки (3:1); label — текст (4,5:1)
 * @returns {string} HEX: исходный, если он и так проходил порог
 */
export function inkFor(color, theme, kind = 'stroke') {
  const t = INK[theme] || INK.dark;
  if (!isColor(color)) return color;
  const c = toHex(toRgb(color.trim()));
  const min = t[kind] || t.stroke;
  const fade = kind === 'label' ? 1 : t.fade;
  if (contrastRatio(composited(c, t.surface, fade), t.surface) >= min) return c;

  /* Куда двигать светлоту: на светлой подложке краску темним, на тёмной —
     осветляем. Направление одно и то же для линий и подписей. */
  const lighten = luminance(toRgb(t.surface)) < 0.5;
  const { h, s, l } = rgbToHsl(toRgb(c));
  for (let step = 1; step <= 48; step++) {
    const nl = lighten ? Math.min(0.98, l + step * 0.02) : Math.max(0.02, l - step * 0.02);
    const cand = toHex(hslToRgb({ h, s, l: nl }));
    if (contrastRatio(composited(cand, t.surface, fade), t.surface) >= min) return cand;
    if (nl === (lighten ? 0.98 : 0.02)) break;
  }
  /* Спасу нет (чистый белый на белой бумаге при любой светлоте — редкость,
     но шаг до 0,02 его не берёт): отдаём чернила темы. Линия останется
     различимой, а вот индивидуальность альянса — нет, и это меньшее из зол. */
  return t.ink;
}

/* Имя переменной из id: id приходит из базы и из панели, поэтому в CSS не
   попадает ничем, кроме букв, цифр, дефиса и подчёркивания. Без этой замены
   id вида `a1}-` дописал бы правило в `<style>` головы страницы. */
function varName(id) {
  return String(id == null ? '' : id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

/**
 * Две ссылки на краски альянса: для штриха и для подписи.
 *
 * Значение — не число, а `var()` с запасом: если блока с переменными на
 * странице нет (старый кэш index.html, собранная копия без него), линия
 * останется прежней краской, а не исчезнет.
 */
export function inkOf(id, color) {
  const v = varName(id);
  const base = isColor(color) ? color : NO_ALLIANCE_COLOR;
  return {
    line: `var(--aink-${v},${base})`,
    label: `var(--ainkt-${v},${base})`,
  };
}

/**
 * CSS-блок красок на обе темы. Пишется в `<style id="alliance-inks">` один
 * раз при приходе данных; собранная копия вставляет его в `<head>` при сборке.
 */
export function allianceInkCss(alliances) {
  const light = [];
  const dark = [];
  for (const a of Array.isArray(alliances) ? alliances : []) {
    if (!a || a.id == null || a.id === '') continue;
    const v = varName(a.id);
    const c = isColor(a.color) ? a.color : NO_ALLIANCE_COLOR;
    light.push(`--aink-${v}:${inkFor(c, 'light', 'stroke')};--ainkt-${v}:${inkFor(c, 'light', 'label')}`);
    dark.push(`--aink-${v}:${inkFor(c, 'dark', 'stroke')};--ainkt-${v}:${inkFor(c, 'dark', 'label')}`);
  }
  if (!light.length) return '';
  return `:root[data-theme="light"]{${light.join(';')};}\n:root[data-theme="dark"]{${dark.join(';')};}\n`;
}
