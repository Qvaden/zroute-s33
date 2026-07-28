/** Мелкие помощники отрисовки. Без фреймворков — обычный DOM и строки. */

/** Экранирование: данные приходят из таблицы, которую правит человек. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** @param {Date} d */
export function fmtDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** @param {Date} d */
export function fmtDateFull(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Выбирает форму слова по числу: 1 победа, 2 победы, 5 побед.
 * Само число не подставляет — нужно там, где цифра выводится отдельно
 * и крупно, иначе она задваивается: «10 · 10 месяцев истории».
 */
export function pluralWord(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** То же самое, но вместе с числом: «5 побед». */
export function plural(n, one, few, many) {
  return `${n} ${pluralWord(n, one, few, many)}`;
}

/** Значок изменения места: вверх, вниз или без движения. */
export function deltaBadge(delta) {
  if (delta === null || delta === 0) return '<span class="delta delta--flat">—</span>';
  const dir = delta > 0 ? 'up' : 'down';
  const arrow = delta > 0 ? '▲' : '▼';
  return `<span class="delta delta--${dir}">${arrow}${Math.abs(delta)}</span>`;
}

/** Цветные точки последних результатов. */
export function formDots(form) {
  if (!form.length) return '<span class="muted">—</span>';
  return `<span class="form">${form
    .map((o) => `<i class="dot dot--${o}" title="${
      { win: 'победа', loss: 'поражение', draw: 'ничья', skip: 'не участвовал' }[o]
    }"></i>`)
    .join('')}</span>`;
}

/**
 * Спарклайн динамики очков. Обычный inline-SVG, без библиотек:
 * на 32 строки это дешевле и надёжнее, чем тянуть графическую зависимость.
 */
export function sparkline(series, color = '#e0a33e', w = 84, h = 24) {
  if (!series || series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = w / (series.length - 1);
  const pts = series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  /*
    preserveAspectRatio="none" растягивает линию по ширине колонки — на широком
    экране график читается заметно лучше. Точку в конце пришлось убрать: при
    неравномерном масштабе круг превратился бы в эллипс. Потери нет — текущие
    очки и так стоят числом в соседней колонке.
    vector-effect держит толщину линии постоянной при любом растяжении.
  */
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"
    preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round" opacity="0.9"
      vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/**
 * Разбивает markdown на секции по заголовкам «## ».
 *
 * Нужно, чтобы страница могла разложить текст карточками, а доверенный
 * человек при этом продолжал править обычный текст в таблице, без вёрстки.
 * Он пишет «## Заголовок» — на сайте появляется карточка.
 *
 * @param {string} md
 * @returns {{title: string, body: string}[]}
 */
export function splitSections(md) {
  const out = [];
  let current = null;

  for (const line of String(md ?? '').split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      // Текст до первого заголовка — вступление без названия.
      current = { title: '', lines: [line] };
      out.push(current);
    }
  }

  return out.map((s) => ({ title: s.title, body: s.lines.join('\n').trim() }));
}

/** Крошечный markdown: заголовки, списки, жирный, абзацы. Больше и не нужно. */
export function miniMarkdown(src) {
  const lines = String(src ?? '').split('\n');
  const out = [];
  let inList = false;

  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }

    if (t === '') continue;
    if (t.startsWith('### ')) out.push(`<h4>${inline(t.slice(4))}</h4>`);
    else if (t.startsWith('## ')) out.push(`<h3>${inline(t.slice(3))}</h3>`);
    else if (t.startsWith('# ')) out.push(`<h2>${inline(t.slice(2))}</h2>`);
    else out.push(`<p>${inline(t)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
