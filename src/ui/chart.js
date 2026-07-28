import { esc } from './helpers.js';

let uid = 0;
const nextId = () => `g${++uid}`;

/**
 * Большой график накопленных очков одного альянса, с заливкой под линией.
 *
 * Можно передать эталонную линию (например, средние очки по серверу) —
 * тогда сразу видно, идёт альянс выше или ниже общего темпа. Без такого
 * ориентира голая кривая мало о чём говорит.
 *
 * @param {number[]} series
 * @param {{number:number}[]} weeks
 * @param {string} color
 * @param {{reference?: number[], referenceLabel?: string, height?: number}} [opts]
 */
export function areaChart(series, weeks, color, opts = {}) {
  const { reference = null, referenceLabel = 'средний по серверу', height = 260 } = opts;
  if (!series || series.length < 2) return '';

  const W = 760;
  const H = height;
  const PAD = { top: 20, right: 16, bottom: 30, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const pool = reference ? series.concat(reference) : series;
  let min = Math.min(0, ...pool);
  let max = Math.max(0, ...pool);
  const pad = Math.max(1, Math.round((max - min) * 0.14));
  min -= pad;
  max += pad;
  const span = max - min || 1;

  const x = (i) => PAD.left + (i / (series.length - 1)) * plotW;
  const y = (v) => PAD.top + plotH - ((v - min) / span) * plotH;

  const step = Math.max(1, Math.round((max - min) / 4));
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

  const grid = ticks
    .map(
      (v) => `<line x1="${PAD.left}" y1="${y(v).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(v).toFixed(1)}"
        class="ch__grid ${v === 0 ? 'ch__grid--zero' : ''}"/>
      <text x="${PAD.left - 8}" y="${(y(v) + 3.5).toFixed(1)}" class="ch__ytick">${v > 0 ? '+' : ''}${v}</text>`
    )
    .join('');

  const xLabels = weeks
    .map((w, i) => {
      const every = weeks.length > 8 ? 2 : 1;
      if (i % every !== 0 && i !== weeks.length - 1) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 10}" class="ch__xtick">${w.number}</text>`;
    })
    .join('');

  const line = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${PAD.left},${y(min + pad).toFixed(1)} ${line} ${(PAD.left + plotW).toFixed(1)},${y(min + pad).toFixed(1)}`;
  const gid = nextId();

  const ref = reference
    ? `<polyline points="${reference.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"
         fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".65"/>`
    : '';

  return `
    <div class="ch ch--big">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="Накопленные очки по неделям">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="${esc(color)}" stop-opacity=".34"/>
            <stop offset="100%" stop-color="${esc(color)}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        ${xLabels}
        <polygon points="${area}" fill="url(#${gid})"/>
        ${ref}
        <polyline points="${line}" fill="none" stroke="${esc(color)}" stroke-width="2.8"
          stroke-linejoin="round" stroke-linecap="round" class="ch__line" style="--dash:2200; --delay:.1s"/>
      </svg>
      ${reference ? `<p class="ch__legend"><i class="ch__dash"></i> ${esc(referenceLabel)}</p>` : ''}
    </div>`;
}

/**
 * Движение по местам. Ось перевёрнута: первое место сверху,
 * потому что «подняться в таблице» должно выглядеть как движение вверх.
 *
 * @param {number[]} places
 * @param {{number:number}[]} weeks
 * @param {number} total сколько всего альянсов
 * @param {string} color
 */
export function placeChart(places, weeks, total, color) {
  if (!places || places.length < 2) return '';

  const W = 760;
  const H = 150;
  const PAD = { top: 16, right: 16, bottom: 26, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const best = Math.max(1, Math.min(...places) - 1);
  const worst = Math.min(total, Math.max(...places) + 1);
  const span = worst - best || 1;

  const x = (i) => PAD.left + (i / (places.length - 1)) * plotW;
  const y = (p) => PAD.top + ((p - best) / span) * plotH; // больше место — ниже точка

  const ticks = [...new Set([best, Math.round((best + worst) / 2), worst])];
  const grid = ticks
    .map(
      (p) => `<line x1="${PAD.left}" y1="${y(p).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(p).toFixed(1)}" class="ch__grid"/>
      <text x="${PAD.left - 8}" y="${(y(p) + 3.5).toFixed(1)}" class="ch__ytick">${p}</text>`
    )
    .join('');

  const xLabels = weeks
    .map((w, i) => {
      const every = weeks.length > 8 ? 2 : 1;
      if (i % every !== 0 && i !== weeks.length - 1) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch__xtick">${w.number}</text>`;
    })
    .join('');

  const pts = places.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const dots = places
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p).toFixed(1)}" r="2.6" fill="${esc(color)}" opacity=".85"/>`)
    .join('');

  return `
    <div class="ch">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="Место в таблице по неделям">
        ${grid}
        ${xLabels}
        <polyline points="${pts}" fill="none" stroke="${esc(color)}" stroke-width="2.2"
          stroke-linejoin="round" stroke-linecap="round" class="ch__line" style="--dash:2200; --delay:.25s"/>
        ${dots}
      </svg>
    </div>`;
}

/**
 * График гонки за сезон: накопленные очки нескольких альянсов по неделям.
 *
 * Обычный inline-SVG без библиотек. Причина та же, что и везде в проекте:
 * ни одной зависимости и ни шага сборки. Для пяти линий на двенадцати точках
 * графическая библиотека — это 200 КБ ради того, что здесь занимает страницу кода.
 *
 * @param {{alliance: {tag:string,name:string,color?:string}, series:number[]}[]} rows
 * @param {{id:string,number:number}[]} weeks
 */
export function raceChart(rows, weeks, { height = 260 } = {}) {
  if (!rows.length || weeks.length < 2) return '';

  const W = 760;
  const H = height;
  const PAD = { top: 18, right: 62, bottom: 34, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const all = rows.flatMap((r) => r.series);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  // Небольшой запас сверху и снизу, чтобы линии не липли к краю.
  const pad = Math.max(1, Math.round((max - min) * 0.12));
  min -= pad;
  max += pad;
  const span = max - min || 1;

  const x = (i) => PAD.left + (i / (weeks.length - 1)) * plotW;
  const y = (v) => PAD.top + plotH - ((v - min) / span) * plotH;

  // Горизонтальная сетка по «круглым» значениям.
  const stepRaw = (max - min) / 4;
  const step = Math.max(1, Math.round(stepRaw / 5) * 5 || Math.round(stepRaw));
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

  const grid = ticks
    .map(
      (v) => `
      <line x1="${PAD.left}" y1="${y(v).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(v).toFixed(1)}"
            class="ch__grid ${v === 0 ? 'ch__grid--zero' : ''}"/>
      <text x="${PAD.left - 8}" y="${(y(v) + 3.5).toFixed(1)}" class="ch__ytick">${v > 0 ? '+' : ''}${v}</text>`
    )
    .join('');

  // Подписи недель — только каждая вторая, иначе на телефоне каша.
  const xLabels = weeks
    .map((w, i) => {
      const showEvery = weeks.length > 8 ? 2 : 1;
      if (i % showEvery !== 0 && i !== weeks.length - 1) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch__xtick">${w.number}</text>`;
    })
    .join('');

  /*
    Подписи у концов линий обязаны разъезжаться по вертикали.
    Два альянса часто заканчивают сезон с одинаковыми очками — без разведения
    их теги печатаются друг поверх друга и превращаются в кашу.
    Точку оставляем на настоящем месте, а подпись сдвигаем и, если сдвинули,
    соединяем с точкой тонкой чёрточкой.
  */
  const MIN_GAP = 15;
  const ends = rows
    .map((r, idx) => ({
      idx,
      tag: r.alliance.tag,
      color: r.alliance.color || '#8b929e',
      realY: y(r.series[r.series.length - 1]),
    }))
    .sort((a, b) => a.realY - b.realY);

  ends.forEach((e, k) => {
    e.labelY = k === 0 ? e.realY : Math.max(e.realY, ends[k - 1].labelY + MIN_GAP);
  });

  // Если внизу вылезли за поле — поджимаем всю пачку обратно вверх.
  const overflow = ends.length ? ends[ends.length - 1].labelY - (H - PAD.bottom) : 0;
  if (overflow > 0) ends.forEach((e) => (e.labelY -= overflow));

  const lastX = x(weeks.length - 1);

  const lines = rows
    .map((r, idx) => {
      const color = r.alliance.color || '#8b929e';
      const pts = r.series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${esc(color)}" stroke-width="2.4"
        stroke-linejoin="round" stroke-linecap="round" class="ch__line"
        style="--dash:1400; --delay:${idx * 0.12}s"/>`;
    })
    .join('');

  const labels = ends
    .map((e) => {
      const delay = `${(0.9 + e.idx * 0.12).toFixed(2)}s`;
      const shifted = Math.abs(e.labelY - e.realY) > 1.5;
      return `
      <circle cx="${lastX.toFixed(1)}" cy="${e.realY.toFixed(1)}" r="3.6" fill="${esc(e.color)}"
        class="ch__dot" style="--delay:${delay}"/>
      ${
        shifted
          ? `<line x1="${(lastX + 3).toFixed(1)}" y1="${e.realY.toFixed(1)}"
                   x2="${(lastX + 8).toFixed(1)}" y2="${e.labelY.toFixed(1)}"
                   stroke="${esc(e.color)}" stroke-width="1" opacity=".5"
                   class="ch__dot" style="--delay:${delay}"/>`
          : ''
      }
      <text x="${(lastX + 11).toFixed(1)}" y="${(e.labelY + 4).toFixed(1)}"
        class="ch__label" fill="${esc(e.color)}" style="--delay:${delay}">${esc(e.tag)}</text>`;
    })
    .join('');

  return `
    <div class="ch">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="Динамика очков лидеров по неделям">
        ${grid}
        ${xLabels}
        ${lines}
        ${labels}
      </svg>
    </div>`;
}
