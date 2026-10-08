/** Мелкие помощники отрисовки. Без фреймворков — обычный DOM и строки. */

/** Экранирование: данные приходят из таблицы, которую правит человек. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Ссылка из данных — только http и https.
 *
 * Экранирование здесь не спасает: `esc` честно обработает кавычки, но
 * `javascript:` внутри href останется рабочим кодом. Ссылки на картинки
 * вносит человек руками, и одна опечатка в схеме не должна превращаться
 * в исполняемый код — ни на сайте, ни в панели.
 */
export function safeUrl(url) {
  const s = String(url ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
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

/** Цветные точки последних результатов. Исходов два: победа или поражение. */
export function formDots(form) {
  if (!form.length) return '<span class="muted">нет данных</span>';
  return `<span class="form">${form
    .map((o) => `<i class="dot dot--${o ?? 'pending'}" title="${o === 'win' ? 'победа' : o === 'loss' ? 'поражение' : 'результат ещё не внесён'}"></i>`)
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

/**
 * Что строка рейтинга говорит вслух.
 *
 * Порядок тот же, что глаз видит слева направо: место и его изменение, кто
 * это, победы и поражения, очки, свежая форма, затем служебное (серия,
 * слияние, распад, достижения).
 *
 * Нужен и общему рейтингу, и «Кварту», и любому будущему списку альянсов:
 * строка везде одна и та же по составу, а имя у неё только одно, поэтому и
 * формулировка не должна расходиться по файлам.
 *
 * Очки даны словами «плюс» и «минус» вместе с падежом: «-6» в середине фразы
 * читатель склеивает с отрицанием следующего значения, а «минус 6 очков» —
 * однозначно. Падежи считает plural, и для нуля, и для отрицательных.
 */
export function standingsRowLabel(r, { mergedTarget = null, achievementCount = 0 } = {}) {
  const a = r.alliance;
  const parts = [];

  parts.push(`${r.place}-е место`);
  if (r.delta !== null && r.delta !== 0) {
    parts.push(r.delta > 0 ? `подъём на ${r.delta}` : `спуск на ${Math.abs(r.delta)}`);
  }

  const form = Array.isArray(r.form) ? r.form : [];
  const formWins = form.filter((o) => o === 'win').length;

  parts.push(`${a.name} (${a.tag})`);
  parts.push(
    `${plural(r.wins, 'победа', 'победы', 'побед')}, ` +
      `${plural(r.losses, 'поражение', 'поражения', 'поражений')}`
  );
  parts.push(
    `${r.points > 0 ? 'плюс ' : r.points < 0 ? 'минус ' : ''}` +
      `${plural(Math.abs(r.points), 'очко', 'очка', 'очков')}`
  );
  if (form.length) {
    parts.push(`форма: ${plural(formWins, 'победа', 'победы', 'побед')} из ${form.length}`);
  }
  if (r.streak && r.streak.length > 1) {
    parts.push(
      r.streak.type === 'win'
        ? `серия: ${plural(r.streak.length, 'победа', 'победы', 'побед')} подряд`
        : `серия: ${plural(r.streak.length, 'поражение', 'поражения', 'поражений')} подряд`
    );
  }
  if (achievementCount) {
    parts.push(plural(achievementCount, 'достижение', 'достижения', 'достижений'));
  }
  /*
    Имя партнёра по слиянию стоит в именительном и в кавычках: просклонять
    выдуманное название программа не может, а «слился с Космическая коалиция»
    звучало бы как обрывок.
  */
  if (mergedTarget) parts.push(`слияние: «${mergedTarget.name}»`);
  else if (!a.active) parts.push('распался');

  return parts.join(', ');
}
