/**
 * ДОМЕННАЯ МОДЕЛЬ.
 *
 * Спроектирована под настоящую базу данных, а НЕ под Google Таблицу.
 * Это принципиально: если описать модель под особенности таблицы
 * (всё строки, нет ID, широкая матрица) — при переезде на PocketBase
 * придётся менять саму модель, и вся затея с адаптерами теряет смысл.
 *
 * Поэтому таблица подгоняется под модель, а не наоборот.
 * Вся грязь (разворот матрицы, приведение типов) живёт внутри адаптера.
 *
 * Здесь только JSDoc-типы, никакого кода — файл ничего не исполняет.
 */

/**
 * Альянс.
 *
 * ВАЖНО: id постоянный и живёт отдельно от name и tag.
 * В этом жанре альянсы регулярно переименовываются и сливаются.
 * Если привязать историю к названию — она порвётся на первом же переименовании.
 *
 * @typedef {Object} Alliance
 * @property {string}  id       Постоянный идентификатор. Не меняется никогда.
 * @property {string}  tag      Тег в игре, например «RUS». Может меняться.
 * @property {string}  name     Отображаемое название. Может меняться.
 * @property {string}  [color]  HEX-цвет для графиков, например «#d4483b».
 * @property {boolean} active   Существует ли альянс сейчас.
 * @property {string}  [note]   Произвольный комментарий.
 */

/**
 * Игровая неделя (один цикл VS).
 *
 * @typedef {Object} Week
 * @property {string} id         Идентификатор, например «W24».
 * @property {number} number     Порядковый номер недели.
 * @property {Date}   startDate
 * @property {Date}   endDate
 * @property {string} [note]
 */

/**
 * Результат одного альянса за одну неделю.
 * Нормализованная «длинная» строка — по одной на каждую пару неделя+альянс.
 *
 * @typedef {'win'|'loss'|'draw'|'skip'} Outcome
 *
 * @typedef {Object} Result
 * @property {string}  weekId
 * @property {string}  allianceId
 * @property {Outcome} outcome
 * @property {string}  [opponent]  Кто был противником, если известно.
 * @property {string}  [comment]
 */

/**
 * Историческое событие: захват сервера, война, слияние альянсов.
 *
 * @typedef {Object} GameEvent
 * @property {string}  id
 * @property {Date}    date
 * @property {string}  type          'server_capture' | 'war' | 'merge' | 'other'
 * @property {number}  [serverNumber] Номер сервера — для захватов.
 * @property {string}  title
 * @property {string}  [body]
 * @property {string}  [imageUrl]     В режиме sheets — внешняя ссылка.
 */

/**
 * Редактируемый текстовый блок (гайды, раздел для малых альянсов).
 *
 * @typedef {Object} TextBlock
 * @property {string} key    Ключ, по которому страница его запрашивает.
 * @property {string} title
 * @property {string} body   Markdown.
 */

/**
 * Что умеет конкретный адаптер.
 * Здесь абстракция честно протекает: чтение одинаково у всех,
 * запись есть только у pocketbase. Страницы это учитывают явно.
 *
 * @typedef {Object} Capabilities
 * @property {boolean} canWrite
 * @property {boolean} canUploadImages
 * @property {boolean} canAuth
 */

/**
 * Контракт, который обязан реализовать каждый адаптер.
 * Все методы асинхронные — даже там, где источник мог бы ответить синхронно.
 * Иначе при смене источника поедут все места вызова.
 *
 * @typedef {Object} DataAdapter
 * @property {string} name
 * @property {Capabilities} capabilities
 * @property {() => Promise<Alliance[]>}  getAlliances
 * @property {() => Promise<Week[]>}      getWeeks
 * @property {() => Promise<Result[]>}    getResults
 * @property {() => Promise<GameEvent[]>} getEvents
 * @property {() => Promise<TextBlock[]>} getTexts
 */

export {};
