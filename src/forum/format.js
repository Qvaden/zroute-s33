/**
 * ПОКАЗ ТЕКСТА, КОТОРЫЙ НАПИСАЛ ПОСТОРОННИЙ ЧЕЛОВЕК.
 *
 * Отдельный файл, а не пара строк внутри страницы, ровно по одной причине:
 * до появления форума ВСЕ тексты на сайте писал доверенный редактор, и самое
 * страшное, что могло случиться, — опечатка. Теперь текст пишет кто угодно,
 * и он попадает на страницу к другим людям. Это меняет цену ошибки:
 * незакрытая подстановка здесь означает, что чужой скрипт исполняется
 * в браузере читателя, на нашем домене.
 *
 * Поэтому правило жёсткое: разметку собираем ТОЛЬКО из esc() и своих строк.
 * Никакой markdown-разметки от участников: жирный текст и заголовки в посте
 * приятны, но каждая новая конструкция — это ещё одно место, где можно
 * ошибиться. Абзацы, переносы строк и ссылки закрывают почти всё, зачем
 * форуму вообще нужна разметка.
 *
 * miniMarkdown из ui/helpers.js здесь не годится: он умеет `<strong>`
 * и заголовки, то есть принимает разметку от автора. Для текстов редактора
 * это удобно, для текстов посторонних — лишняя поверхность.
 */
import { esc, safeUrl } from '../ui/helpers.js';

/**
 * Текст записи в разметку.
 *
 * Что делает:
 *   — пустая строка разбивает текст на абзацы;
 *   — одиночный перенос остаётся переносом;
 *   — ссылки http(s) становятся ссылками, остальное — обычным текстом.
 *
 * Порядок важен: сначала экранируем ВСЁ, и только потом вставляем свои теги.
 * Если сделать наоборот, экранирование съест собственную разметку.
 *
 * @param {string} src
 */
export function postBody(src) {
  const text = String(src ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = linkify(para);
      return `<p>${safe.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/**
 * Ссылки в тексте.
 *
 * Схему проверяем через safeUrl: `javascript:` внутри href остаётся рабочим
 * кодом даже после честного экранирования кавычек — тот же довод, что
 * в helpers.js, но здесь он весомее, потому что адрес пишет посторонний.
 *
 * Показываем только домен: полный адрес на телефоне ломает вёрстку, а длинная
 * ссылка-простыня — стандартный вид рекламы, которую правила и так запрещают.
 *
 * rel="ugc" помечает ссылку как чужую: это принятый способ сказать
 * поисковикам, что за неё отвечает не сайт, а автор записи.
 */
function linkify(paragraph) {
  const escaped = esc(paragraph);

  // Ищем в уже экранированном тексте: сущности вида &amp; адрес не ломают.
  return escaped.replace(/https?:\/\/[^\s<]+/g, (match) => {
    // Знаки в конце — почти всегда часть предложения, а не адреса.
    const trimmed = match.replace(/[.,;:!?)»"']+$/, '');
    const tail = match.slice(trimmed.length);

    // Возвращаем сущности перед проверкой: в адресе они значат сами себя.
    const raw = trimmed.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const url = safeUrl(raw);
    if (!url) return match;

    let label = trimmed;
    try {
      const host = new URL(raw).hostname.replace(/^www\./, '');
      label = host;
    } catch {
      // Адрес не разобрался — покажем как есть, он уже экранирован.
    }

    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer ugc">${esc(label)}</a>${tail}`;
  });
}

/**
 * Короткая выжимка для ленты: первые слова текста без разметки.
 * @param {string} src
 * @param {number} [max]
 */
export function excerpt(src, max = 220) {
  const flat = String(src ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  // Режем по слову: обрубленное посередине слово выглядит как поломка.
  const cut = flat.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > max * 0.6 ? at : max).trimEnd()}…`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * «5 минут назад», «вчера», «3 сен».
 *
 * Относительное время у свежих записей и точная дата у старых — так читается
 * и лента, и архив. Граница на трёх днях: дальше «12 дней назад» уже хуже
 * даты, потому что требует считать в голове.
 *
 * Считаем в местном часовом поясе читателя, а не в UTC: даты событий сервера
 * привязаны к игровому расписанию (потому в timeline.js и стоит getUTC*),
 * а «когда написан пост» — это про часы того, кто читает.
 *
 * @param {Date} date
 * @param {Date} [now] Для тестов: время «сейчас» можно задать.
 */
export function timeAgo(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  const sec = Math.floor((now - date) / 1000);

  if (sec < 45) return 'только что';
  if (sec < 90) return 'минуту назад';

  const min = Math.round(sec / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;

  /*
    Дальше считаем по КАЛЕНДАРЮ, а не по числу прошедших часов, и порядок
    здесь важнее, чем кажется. Сообщение, написанное в 23:00 и прочитанное
    в 00:30, — вчерашнее, хотя прошло полтора часа. Если сначала проверить
    «меньше суток», до календаря дело не дойдёт, и человек прочитает
    «2 часа назад» про вчерашний день.
  */
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday - startOfThen) / 86400000);

  if (days === 0) {
    const hour = Math.round(min / 60);
    return `${hour} ${plural(hour, 'час', 'часа', 'часов')} назад`;
  }
  if (days === 1) return 'вчера';
  if (days === 2) return 'позавчера';

  const sameYear = date.getFullYear() === now.getFullYear();
  const head = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return sameYear ? head : `${head} ${date.getFullYear()}`;
}

/** Точное время для подсказки: её видно при наведении и читают вслух программы. */
export function fullTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Русские формы без числа — то же правило, что в ui/helpers.js. */
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Цвет метки участника из его ника.
 *
 * Аватарок нет и не будет: их надо где-то хранить, а хранение картинок —
 * это первое, что упирается в деньги. Вместо них буква в цветном квадрате,
 * и цвет всегда один и тот же для одного ника — тогда знакомого человека
 * видно в ленте по цвету, не читая подпись.
 *
 * @param {string} nick
 */
export function nickColor(nick) {
  const s = String(nick ?? '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 360;
  }
  // Насыщенность и светлота фиксированы: иначе часть ников получит цвета,
  // неразличимые на тёмном фоне.
  return `hsl(${hash} 52% 58%)`;
}

/** Первая буква ника для метки. */
export function nickInitial(nick) {
  const s = String(nick ?? '').trim();
  return s ? s[0].toUpperCase() : '?';
}
