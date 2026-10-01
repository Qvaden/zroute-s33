/**
 * ФИЛЬТРЫ ЛЕНТЫ В АДРЕСЕ СТРАНИЦЫ.
 *
 * Раздел, тег, порядок и поиск живут в адресе: `#/forum?cat=vs&sort=top`.
 * Пока они жили только в памяти страницы, ссылку на «Разбор VS» дать было
 * нельзя: человек кидал в чат адрес форума, а собеседник открывал пустую
 * ленту и сам искал нужный раздел. Тот же смысл терялся при перезагрузке
 * страницы и при возврате «назад» из темы.
 *
 * ПОЧЕМУ КЛЮЧИ КОРОТКИЕ И НЕПОДВИЖНЫЕ. Ссылку пишут один раз, а открывают
 * через месяцы. `cat`, `tag`, `sort`, `q`, `saved` — те же имена, что у полей
 * состояния ленты, и переименовать их значит обессмыслить всё, что уже
 * разослано. Значения — id разделов и тегов из базы (rules.js), поэтому они
 * автоматически живут столько же, сколько сама база.
 *
 * ПОЧЕМУ `saved` — ВСЁ-ТАКИ АДРЕС, ХОТЬ СПИСОК ЛИЧНЫЙ. Закладки приватны, и
 * кинутая в чат ссылка `#/forum?saved=1` откроет собеседнику его собственный
 * список, а не ваш — обычно пустой. Это не обман, а то же правило, что у
 * «только мои темы» в любом почтовике: адрес описывает вид, а не данные.
 * Выигрывает от этого сам человек: фильтр переживает перезагрузку страницы и
 * возврат «назад» из темы, а ради этого ключи и живут в адресе.
 *
 * ПОЧЕМУ ФУНКЦИИ ЧИСТЫЕ. Адрес — единственное место форума, где одна и та же
 * строка должна дважды дать один и тот же результат: один раз при входе на
 * страницу, второй — когда состояние пересохраняют обратно в адрес. Проверить
 * это можно без браузера, поэтому здесь нет ни DOM, ни обращений к состоянию.
 */

/** Сколько символов поиска держим в адресе: длиннее — только ради длинной ссылки. */
export const QUERY_MAX = 80;

/** Дефолт не пишем: «Все разделы, свежее» — это просто #/forum без хвоста. */
export const DEFAULT_SECTION = 'all';
export const DEFAULT_SORT = 'fresh';

/**
 * Закладки в адресе — одно слово, а не список id. Id уехали бы в ссылку на
 * сотни тем, устарели бы в тот же день и перестали бы быть «моими закладками»
 * у того, кто открыл адрес.
 */
export const SAVED_FLAG = '1';

/**
 * Сервер в адресе — его номер, а не название.
 *
 * `server=44` переживает переезд человека между браузерами и означает ровно
 * то же, что колонка `server_id` в базе: границы числа взяты из проверки
 * таблицы, и число вне них — не ошибка адреса, а обычный «фильтра нет».
 *
 * Дефолт в адрес не пишется по той же причине, что и «Все разделы»: ссылка на
 * общий сервер не должна выглядеть как ссылка на выбранный.
 */
export const SERVER_KEY = 'server';
export const SERVER_MIN = 1;
export const SERVER_MAX = 999;

/** Строка адреса → номер сервера или null, когда сервер в адресе не назван. */
export function serverFromSearch(search) {
  const raw = new URLSearchParams(String(search ?? '')).get(SERVER_KEY);
  if (raw == null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < SERVER_MIN || id > SERVER_MAX) return null;
  return id;
}

/**
 * Адрес → состояние ленты.
 *
 * Смысл имеет только то, что форум действительно умеет показать: чужой или
 * устаревший id в адресе — не ошибка, а обычный вид ленты. Иначе ссылка из
 * пятилетней давности показывала бы пустой экран вместо темы, которой нет.
 *
 * @param {string} search Хвост адреса после «?», без знака вопроса.
 * @param {{categories: string[], tags: string[], sorts: string[]}} known
 */
export function filtersFromSearch(search, known) {
  const params = new URLSearchParams(String(search ?? ''));
  const cat = params.get('cat');
  const tag = params.get('tag');
  const sort = params.get('sort');
  return {
    category: cat && known.categories.includes(cat) ? cat : DEFAULT_SECTION,
    tag: tag && known.tags.includes(tag) ? tag : DEFAULT_SECTION,
    sort: sort && known.sorts.includes(sort) ? sort : DEFAULT_SORT,
    query: (params.get('q') ?? '').slice(0, QUERY_MAX),
    // Не «1» — значит выключено: чужой или битый адрес не обязан что-то значить.
    saved: params.get('saved') === SAVED_FLAG,
    server: serverFromSearch(search),
  };
}

/**
 * Состояние ленты → адрес.
 *
 * Пробелы URLSearchParams передаёт как «+», а в адресе, который человек
 * видит в строке браузера и копирует оттуда, «+» посреди русского слова
 * выглядит поломкой, а не пробелом. Берём %20.
 *
 * @param {{category: string, tag: string, sort: string, query: string, saved?: boolean, server?: number|null, defaultServer?: number|null}} filters
 */
export function searchFromFilters(filters) {
  const params = new URLSearchParams();
  if (filters.category && filters.category !== DEFAULT_SECTION) params.set('cat', filters.category);
  if (filters.tag && filters.tag !== DEFAULT_SECTION) params.set('tag', filters.tag);
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (filters.query) params.set('q', filters.query);
  if (filters.saved) params.set('saved', SAVED_FLAG);
  /*
    Сервер пишем только когда он выбран и когда он не тот, что «по умолчанию
    для этого сайта». Иначе первый в мире адрес форума оброс бы хвостом, а
    ссылка, данная человеку до мультиаренды, начала бы спорить сама с собой.

    Выбор не проверяют одной конечностью числа: `Number(null)` — это ноль, и
    без оговорки «значение названо» пустой выбор уехал бы в адрес как
    `server=0`, а человек получил бы ссылку на сервер, которого в таблице нет.
  */
  const server = Number(filters.server);
  const fallback = Number(filters.defaultServer);
  if (filters.server != null && Number.isInteger(server) && server !== fallback) {
    params.set(SERVER_KEY, String(server));
  }
  return params.toString().replace(/\+/g, '%20');
}

/**
 * Куда привести человека сразу, помимо ленты: `#/forum?new=event`.
 *
 * Кнопка «Создать встречу» в календаре ведёт на форум, потому что встреча у
 * нас и есть тема. Открывать при этом пустой редактор — значит заставить
 * человека искать галочку «Событие» среди семи; адрес говорит, что он пришёл
 * за встречей, и форма встречается с ним готовой.
 *
 * Ключ живёт рядом с фильтрами по той же причине, что и они: это часть адреса,
 * который человек кидает в чат, и разбирать его должно то же чистое место.
 */
export const COMPOSE_INTENTS = ['event'];

/** @param {string} search Хвост адреса после «?», без знака вопроса. */
export function composeIntentFromSearch(search) {
  const intent = new URLSearchParams(String(search ?? '')).get('new');
  return COMPOSE_INTENTS.includes(intent) ? intent : '';
}
