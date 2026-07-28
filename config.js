/**
 * ЕДИНСТВЕННОЕ МЕСТО, которое нужно менять при переезде на другой источник данных.
 *
 * dataSource: 'json'       — демо-данные из файла. Работает без сети и без настройки.
 *             'sheets'     — Google Таблица, опубликованная в веб.
 *             'pocketbase' — своя база с админкой.
 *
 * Всё остальное в проекте про источник данных не знает вообще ничего.
 */
export const CONFIG = {
  dataSource: 'json',

  server: 33,
  siteTitle: 'Сервер 33 · Z Route: Redemption',

  /**
   * Правила начисления очков.
   * Пропуск недели по умолчанию 0, а не −1: иначе неактивные альянсы
   * улетают в глубокий минус и таблица перестаёт читаться.
   */
  scoring: {
    win: 1,
    loss: -1,
    draw: 0,
    skip: 0,
  },

  /** Сколько последних недель показывать в колонке «форма». */
  formLength: 5,

  json: {
    path: './data/demo.json',
  },

  sheets: {
    /** ID документа из адреса: docs.google.com/spreadsheets/d/<ЭТО>/edit */
    docId: '',
    /** Имена вкладок в таблице. */
    tabs: {
      alliances: 'alliances',
      weeks: 'weeks',
      results: 'results',
      events: 'events',
      texts: 'texts',
    },
  },

  pocketbase: {
    /** Например: https://s33.example.ru */
    url: '',
  },
};
