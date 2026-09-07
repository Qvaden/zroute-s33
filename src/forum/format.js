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
 * ЧТО ХРАНИТСЯ. С прошлой версии текст писался как набран, а разметка
 * собиралась при показе из маркеров **, *, __, ~~. Это было безопасно,
 * но неудобно: звёздочки мешали глазам, и цветов в таком виде не сделать.
 * Теперь участник форматирует текст прямо в редакторе (contenteditable),
 * и на хранение уходит HTML. Безопасность держит не этот файл, а белый
 * список тегов в sanitize.js: здесь только склейка, абзацы и ссылки.
 *
 * Старые записи (плоский текст) остались в базе как есть: sanitize пропускает
 * их как обычный текст, а пустые строки снова превращаются в абзацы.
 */
import { esc } from '../ui/helpers.js';
import { sanitizeHtml, textOf, linkify } from './sanitize.js';

export { textOf, sanitizeHtml };

/**
 * Абзацы из плоского текста (старые записи): пустая строка — новый абзац,
 * одиночный перенос — <br>.
 * @param {string} text
 */
function paragraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Редактируемая копия текста для формы правки: та же структура, что поедет
 * на хранение, но без превращения адресов в ссылки (в редакторе адрес — текст,
 * и человек может его править).
 * @param {string} src
 */
export function editorHtml(src) {
  const text = String(src ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  return /<[a-zA-Z/][^>]*>/.test(text) ? sanitizeHtml(text) : paragraphs(text);
}

/**
 * Текст записи к показу.
 *
 * Что делает:
 *   — HTML-текст (новые записи) очищается белым списком sanitize.js;
 *   — плоский текст (старые записи) разбивается на абзацы;
 *   — адреса http(s) в тексте становятся ссылками с доменом в подписи.
 *
 * @param {string} src
 */
export function postBody(src) {
  const text = String(src ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  const built = /<[a-zA-Z/][^>]*>/.test(text) ? sanitizeHtml(text) : paragraphs(text);
  const linked = linkify(built);
  // Строка без единого блока (например, после выкидывания <script>) встаёт
  // в абзац, чтобы не висеть голым текстом между карточками.
  return /\b(?:p|h3|blockquote|pre|ul|ol|li|br)\b/.test(linked) ? linked : `<p>${linked}</p>`;
}

/**
 * Короткая выжимка для ленты: первые слова текста без разметки.
 * Теги убираем, иначе лента показывала бы «<strong>жирный</strong>».
 * @param {string} src
 * @param {number} [max]
 */
export function excerpt(src, max = 220) {
  const flat = textOf(src).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
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
