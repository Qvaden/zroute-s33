/**
 * ИТОГ НЕДЕЛИ НА УРОВНЕ СЕРВЕРА.
 *
 * Это не то же самое, что результаты VS. Там счёт ведут альянсы друг с другом
 * внутри сервера; здесь — что сервер сделал за неделю целиком: пошёл в атаку
 * или отбивался, и чем это кончилось.
 *
 * Состояний ровно четыре, потому что осей две: что делали (захват или защита)
 * и чем кончилось (получилось или нет). Хранится это ОДНИМ значением, а не
 * двумя полями «действие» и «успех» — тогда строка вида «защита / захвачено»
 * невозможна физически, а не запрещена инструкцией.
 *
 * Словарь живёт в logic, а не в adapters и не в pages: им пользуются и сайт,
 * и админ-панель, а разбор входящих слов — отдельно, в _coerce.js.
 *
 * @typedef {'captured'|'not_captured'|'held'|'lost'} ServerOutcome
 */
import { byWeekStartDesc } from '../data/week-order.js';

/**
 * Как каждый исход называется и подаётся.
 *
 * `kind` нужен для цвета: успех и неудача красятся теми же токенами,
 * которыми на сайте показаны победа и поражение, — человек не должен
 * учить второй язык цветов.
 */
export const SERVER_OUTCOME = {
  captured: {
    label: 'Успешно захватили',
    short: 'взяли',
    /** Как исход называется в сообщении коммита. */
    commit: 'взяли сервер',
    kind: 'win',
    action: 'capture',
    /** Заголовок вердикта, когда номер сервера известен. */
    verdict: (n) => `Успешно захватили сервер ${n}`,
    verdictNoNumber: 'Успешно захватили сервер',
  },
  not_captured: {
    label: 'Не захватили',
    short: 'не взяли',
    commit: 'не взяли сервер',
    kind: 'loss',
    action: 'capture',
    verdict: (n) => `Сервер ${n} взять не удалось`,
    verdictNoNumber: 'Захват не удался',
  },
  held: {
    label: 'Успешно защитили',
    short: 'удержали',
    commit: 'удержали сервер',
    kind: 'win',
    action: 'defense',
    verdict: (n) => `Успешно защитили сервер ${n}`,
    verdictNoNumber: 'Успешно защитили свой сервер',
  },
  lost: {
    label: 'Не защитили',
    short: 'потеряли',
    commit: 'потеряли сервер',
    kind: 'loss',
    action: 'defense',
    verdict: (n) => `Сервер ${n} потерян`,
    verdictNoNumber: 'Свой сервер не удержали',
  },
};

/** Порядок для кнопок и списков: сначала атака, потом защита, успех первым. */
export const SERVER_OUTCOME_ORDER = ['captured', 'not_captured', 'held', 'lost'];

/**
 * Строка вердикта целиком.
 *
 * Номер сервера необязателен намеренно. При защите чаще всего защищают свой,
 * и заставлять человека каждую неделю вписывать «33» — лишняя работа ради
 * данных, которые и так известны.
 *
 * @param {ServerOutcome} outcome
 * @param {number} [serverNumber]
 * @param {number} [ownServer] Свой номер сервера из конфига.
 */
export function verdictText(outcome, serverNumber, ownServer) {
  const meta = SERVER_OUTCOME[outcome];
  if (!meta) return '';

  const shown = serverNumber ?? (meta.action === 'defense' ? ownServer : undefined);
  return shown != null ? meta.verdict(shown) : meta.verdictNoNumber;
}

/**
 * Недели с внесённым итогом, свежие сверху.
 *
 * ВАЖНО: сюда нужно передавать полный список недель, а не обрезанный
 * `weeksUpToLastData`. Тот отбрасывает недели без результатов VS — и неделя,
 * где заполнили только серверный итог, исчезла бы с глаз, хотя внесена.
 *
 * @param {{serverOutcome?: string, number: number}[]} weeks
 */
export function weeksWithOutcome(weeks) {
  return (weeks ?? [])
    .filter((w) => w.serverOutcome && SERVER_OUTCOME[w.serverOutcome])
    .sort(byWeekStartDesc);
}
