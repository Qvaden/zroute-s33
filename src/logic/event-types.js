/**
 * ТИПЫ СОБЫТИЙ ХРОНОЛОГИИ — один словарь на сайт и на панель.
 *
 * Разделение обязанностей в проекте такое:
 *
 *   Неделя      — только счёт альянсов: победа или поражение в VS. Ничего больше.
 *   Хронология  — что делал сервер целиком: брал чужие Капитолии и защищал свой.
 *                 Плюс войны, слияния и прочее.
 *
 * ГЛАВНОЕ ПРО НОМЕР СЕРВЕРА: он значит РАЗНОЕ у атаки и у защиты.
 *
 *   При захвате   — чей Капитолий берём. Номер чужого сервера.
 *   При защите    — КТО НАПАДАЛ. Защищаем мы только свой Капитолий 33 сервера
 *                   и никакой другой, поэтому «чей» тут вопрос без смысла,
 *                   а «от кого» — единственное, что стоит записать.
 *
 * Раньше при защите в номер подставлялся свой 33 — теперь это прямо неверно,
 * и подстановка убрана. Ошибка была бы тихой: цифра выглядела бы осмысленной.
 */

/**
 * @typedef {'server_capture'|'capture_failed'|'server_defended'|'server_lost'
 *   |'war'|'merge'|'other'} EventType
 */

export const EVENT_TYPE = {
  server_capture: {
    label: 'Захват Капитолия',
    filter: 'Захваты',
    kind: 'win',
    action: 'capture',
    /** Подпись поля с номером сервера в панели. */
    numberLabel: 'Чей Капитолий',
    numberHint: 'номер чужого сервера, например 74',
    verdict: (n) => `Захватили Капитолий сервера ${n}`,
    verdictNoNumber: 'Захватили чужой Капитолий',
    pill: (n) => (n != null ? `взяли ${n}` : 'взяли Капитолий'),
  },
  capture_failed: {
    label: 'Проигран захват',
    filter: 'Неудачи',
    kind: 'loss',
    action: 'capture',
    numberLabel: 'Чей Капитолий',
    numberHint: 'номер чужого сервера, например 52',
    verdict: (n) => `Проиграли захват Капитолия сервера ${n}`,
    verdictNoNumber: 'Захват чужого Капитолия не удался',
    pill: (n) => (n != null ? `не взяли ${n}` : 'не взяли'),
  },
  server_defended: {
    label: 'Защитили Капитолий',
    filter: 'Защиты',
    kind: 'win',
    action: 'defense',
    numberLabel: 'Кто нападал',
    numberHint: 'номер сервера, который шёл на нас',
    verdict: (n) => `Успешно защитили свой Капитолий от сервера ${n}`,
    verdictNoNumber: 'Успешно защитили свой Капитолий',
    pill: (n) => (n != null ? `отбились от ${n}` : 'отбились'),
  },
  server_lost: {
    label: 'Не защитили Капитолий',
    filter: 'Потери',
    kind: 'loss',
    action: 'defense',
    numberLabel: 'Кто нападал',
    numberHint: 'номер сервера, который нас взял',
    verdict: (n) => `Не смогли защитить Капитолий от сервера ${n}`,
    verdictNoNumber: 'Не смогли защитить свой Капитолий',
    pill: (n) => (n != null ? `не отбились от ${n}` : 'не отбились'),
  },
  war: {
    label: 'Война',
    filter: 'Войны',
    pill: () => 'война',
  },
  merge: {
    label: 'Слияние альянсов',
    filter: 'Слияния',
    pill: () => 'слияние',
  },
  other: {
    label: 'Событие',
    filter: 'Прочее',
    pill: () => 'событие',
  },
};

/** Порядок для кнопок: сначала атака, потом защита, потом остальное. */
export const EVENT_TYPE_ORDER = [
  'server_capture',
  'capture_failed',
  'server_defended',
  'server_lost',
  'war',
  'merge',
  'other',
];

/** Четыре типа, у которых есть исход и направление. */
export const SERVER_TYPES = EVENT_TYPE_ORDER.filter((t) => EVENT_TYPE[t].action);

/** @param {string} type */
export function isServerEvent(type) {
  return Boolean(EVENT_TYPE[type]?.action);
}

/** Подпись типа, с запасом на неизвестное значение из старых данных. */
export function typeLabel(type) {
  return (EVENT_TYPE[type] ?? EVENT_TYPE.other).label;
}

/**
 * Строка вердикта целиком.
 *
 * Номер необязателен: без него говорим то же самое, но без указания стороны.
 * Выдумывать номер нельзя — при защите это означало бы назвать нападавшим
 * сервер, который никуда не нападал.
 *
 * @param {string} type
 * @param {number} [serverNumber]
 */
export function verdictText(type, serverNumber) {
  const meta = EVENT_TYPE[type];
  if (!meta?.verdict) return '';
  return serverNumber != null ? meta.verdict(serverNumber) : meta.verdictNoNumber;
}

/** Короткая подпись для плашки летописи: «взяли 74», «отбились от 51». */
export function pillText(type, serverNumber) {
  const meta = EVENT_TYPE[type] ?? EVENT_TYPE.other;
  return meta.pill(serverNumber ?? null);
}

/**
 * Серверные события, свежие сверху — то, из чего складывается летопись
 * «чьи Капитолии забрали и свой ли удержали».
 *
 * @param {{type: string, date: Date}[]} events
 */
export function serverEvents(events) {
  return (events ?? [])
    .filter((e) => isServerEvent(e.type) && e.date instanceof Date && !Number.isNaN(e.date.getTime()))
    .sort((a, b) => b.date - a.date);
}
