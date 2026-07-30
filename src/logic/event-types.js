/**
 * ТИПЫ СОБЫТИЙ ХРОНОЛОГИИ — один словарь на сайт и на панель.
 *
 * Разделение обязанностей в проекте такое:
 *
 *   Неделя      — только счёт альянсов: победа или поражение в VS. Ничего больше.
 *   Хронология  — что делал сервер целиком: захватил чужой, удержал свой,
 *                 не смог взять, потерял. Плюс войны, слияния и прочее.
 *
 * Раньше захваты и защиты жили ещё и у недели, и один и тот же захват можно было
 * записать дважды — как итог недели и как событие. На вкладке «Хронология» тогда
 * один сервер упоминался до пяти раз. Теперь у каждого факта ровно одно место.
 *
 * Серверные события отличаются от остальных двумя вещами: у них есть исход
 * (получилось или нет) и направление (мы шли или к нам шли). Из этого строятся
 * вердикт и цвет, поэтому оба признака лежат прямо в словаре.
 */

/**
 * @typedef {'server_capture'|'capture_failed'|'server_defended'|'server_lost'
 *   |'war'|'merge'|'other'} EventType
 */

export const EVENT_TYPE = {
  server_capture: {
    label: 'Захватили сервер',
    short: 'взяли',
    filter: 'Захваты',
    kind: 'win',
    action: 'capture',
    verdict: (n) => `Успешно захватили сервер ${n}`,
    verdictNoNumber: 'Успешно захватили сервер',
  },
  capture_failed: {
    label: 'Не захватили',
    short: 'не взяли',
    filter: 'Неудачи',
    kind: 'loss',
    action: 'capture',
    verdict: (n) => `Сервер ${n} взять не удалось`,
    verdictNoNumber: 'Захват не удался',
  },
  server_defended: {
    label: 'Успешно защитили',
    short: 'удержали',
    filter: 'Защиты',
    kind: 'win',
    action: 'defense',
    verdict: (n) => `Успешно защитили сервер ${n}`,
    verdictNoNumber: 'Успешно защитили свой сервер',
  },
  server_lost: {
    label: 'Потеряли сервер',
    short: 'потеряли',
    filter: 'Потери',
    kind: 'loss',
    action: 'defense',
    verdict: (n) => `Сервер ${n} потерян`,
    verdictNoNumber: 'Свой сервер не удержали',
  },
  war: {
    label: 'Война',
    short: 'война',
    filter: 'Войны',
  },
  merge: {
    label: 'Слияние альянсов',
    short: 'слияние',
    filter: 'Слияния',
  },
  other: {
    label: 'Событие',
    short: 'событие',
    filter: 'Прочее',
  },
};

/** Порядок для кнопок: сначала серверные исходы, потом остальное. */
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
 * Номер сервера необязателен намеренно: при защите чаще всего защищают свой,
 * и заставлять человека каждый раз вписывать «33» — лишняя работа ради данных,
 * которые и так известны.
 *
 * @param {string} type
 * @param {number} [serverNumber]
 * @param {number} [ownServer] Свой номер сервера из конфига.
 */
export function verdictText(type, serverNumber, ownServer) {
  const meta = EVENT_TYPE[type];
  if (!meta?.verdict) return '';

  const shown = serverNumber ?? (meta.action === 'defense' ? ownServer : undefined);
  return shown != null ? meta.verdict(shown) : meta.verdictNoNumber;
}

/**
 * Серверные события, свежие сверху — то, из чего складывается летопись
 * «кого забрали и что удержали».
 *
 * @param {{type: string, date: Date}[]} events
 */
export function serverEvents(events) {
  return (events ?? [])
    .filter((e) => isServerEvent(e.type) && e.date instanceof Date && !Number.isNaN(e.date.getTime()))
    .sort((a, b) => b.date - a.date);
}
