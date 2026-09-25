/**
 * ФОРМАТ ДАТЫ СОБЫТИЯ И ФАЙЛ В КАЛЕНДАРЬ.
 *
 * Здесь только чистые превращения: строка → надпись, дата → текст .ics.
 * Разметка живёт в страницах (pages/forum.js и pages/calendar.js), поведение
 * — в src/forum/calendar.js. Отдельный файл потому, что и то и другое
 * обращение к этим функциям должно давать один и тот же ответ: карточка темы
 * и список календаря не вправе называть один момент двумя разными способами.
 */
import { CONFIG } from '../../config.js';
import { plural } from '../ui/helpers.js';

/**
 * Момент встречи одним взглядом: «чт, 25 сент., 20:00».
 *
 * Год не показываем у ближайших встреч — горизонт планирования 90 дней, и
 * за его пределами дата без года двусмысленна (см. eventWhenFull).
 */
const WHEN = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

/** Полный момент: с годом — для заголовка карточки и для подписи title. */
const WHEN_FULL = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** @param {Date|string|null|undefined} at */
export function eventWhen(at) {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? WHEN.format(d) : 'время не названо';
}

/** @param {Date|string|null|undefined} at */
export function eventWhenFull(at) {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? WHEN_FULL.format(d) : 'время не названо';
}

/** Встреча уже началась? Прошедшие не дают ответить, и список делит себя по этому признаку. */
export function eventIsPast(at, now = Date.now()) {
  const d = at ? new Date(at).getTime() : NaN;
  return Number.isNaN(d) ? true : d <= now;
}

/**
 * Момент для поля `datetime-local`: «2026-09-25T20:00» по местным часам.
 *
 * Браузер ждёт строку без часового пояса и трактует её локально, а `toISOString`
 * отдаёт UTC с суффиксом «Z» — из-за этого встреча в 20:00 открылась бы в поле
 * на несколько часов раньше или позже, ровно на разницу с Гринвичем. Поэтому
 * части даты берём по местному времени и склеиваем сами.
 *
 * @param {Date|string|null|undefined} at
 */
export function localInputValue(at) {
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * «через 3 дня», «через 40 мин», «было 2 дня назад».
 *
 * Человек смотрит на календарь, чтобы ответить на вопрос «успею?», а не
 * «какое число?». Точная дата лежит рядом в подписи, а короткая фраза — на
 * виду. Порог в сутки: меньше — минуты и часы, больше — дни.
 */
export function eventCountdown(at, now = Date.now()) {
  const d = at ? new Date(at).getTime() : NaN;
  if (Number.isNaN(d)) return '';
  const diff = d - now;
  const ahead = diff > 0;
  const min = Math.round(Math.abs(diff) / 60000);
  /*
    Один шаг по величине: минуты → часы → дни. Порог в сутки, а не «30 дней»:
    человек отвечает на вопрос «успею?», и «через 50 часов» честнее, чем
    «через 2 дня» — второе звучит как целая свободная неделя.
  */
  if (min < 60) return `${ahead ? 'через ' : ''}${plural(min, 'минуту', 'минуты', 'минут')}${ahead ? '' : ' назад'}`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${ahead ? 'через ' : ''}${plural(hours, 'час', 'часа', 'часов')}${ahead ? '' : ' назад'}`;
  const days = Math.round(hours / 24);
  return `${ahead ? 'через ' : ''}${plural(days, 'день', 'дня', 'дней')}${ahead ? '' : ' назад'}`;
}

/**
 * Подпись срока напоминания.
 *
 * Числа берутся из CONFIG.forum.limits.eventRemindChoices — тех же, что
 * принимает база, — а формулировка одна на странице и в отказе черновика.
 */
export function remindLabel(minutes) {
  const n = Number(minutes);
  if (n === 1440) return 'за сутки';
  if (n === 60) return 'за час';
  if (n === 15) return 'за 15 минут';
  return n ? `за ${n} мин` : 'без напоминания';
}

/** Готовые сроки из тех же чисел, что держит колонка remind_minutes. */
export function remindChoices() {
  return (CONFIG.forum.limits.eventRemindChoices || []).map(Number).filter((m) => m > 0);
}

/**
 * Файл .ics для чужого календаря: телефон, почтовый клиент, рабочий планер.
 *
 * Формат требует CRLF в концах строк и переноса длинных строк, а символы
 * «,», «;» и «\» внутри текста — экранирования. Длительности у нас нет:
 * тема-встреча знает только момент, поэтому DTEND отсутствует, и приложение
 * покажет событие как точку во времени. Это честнее, чем выдуманное «+2 часа».
 *
 * @param {{id: string, title: string, body?: string, eventAt: Date|string, authorNick?: string}} event
 */
export function icsFor(event) {
  const stamp = (v) => new Date(v).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const text = (v) => String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
  const fold = (line) => {
    const LIMIT = 72;
    if (line.length <= LIMIT) return line;
    const parts = [line.slice(0, LIMIT)];
    let rest = line.slice(LIMIT);
    while (rest.length > LIMIT - 1) {
      parts.push(` ${rest.slice(0, LIMIT - 1)}`);
      rest = rest.slice(LIMIT - 1);
    }
    if (rest) parts.push(` ${rest}`);
    return parts.join('\r\n');
  };

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//zroute-s33//kalendr vstrech//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${text(event.id)}@zroute-s33`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.eventAt)}`,
    `SUMMARY:${text(event.title)}`,
    `DESCRIPTION:${text(`${event.authorNick ? `Организатор: ${event.authorNick}\n` : ''}${String(event.body ?? '').slice(0, 300)}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

/**
 * Ссылка на файл.
 *
 * Data-адрес, а не Blob URL: страница статическая, сервера для отдачи файла
 * нет, а встреча весит столько, что влезает в адрес без хранилища.
 */
export function icsHref(event) {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsFor(event))}`;
}
