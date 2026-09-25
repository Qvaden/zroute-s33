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
 * через месяцы. `cat`, `tag`, `sort`, `q` — те же имена, что у полей состояния
 * ленты, и переименовать их значит обессмыслить всё, что уже разослано.
 * Значения — id разделов и тегов из базы (rules.js), поэтому они
 * автоматически живут столько же, сколько сама база.
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
  };
}

/**
 * Состояние ленты → адрес.
 *
 * Пробелы URLSearchParams передаёт как «+», а в адресе, который человек
 * видит в строке браузера и копирует оттуда, «+» посреди русского слова
 * выглядит поломкой, а не пробелом. Берём %20.
 *
 * @param {{category: string, tag: string, sort: string, query: string}} filters
 */
export function searchFromFilters(filters) {
  const params = new URLSearchParams();
  if (filters.category && filters.category !== DEFAULT_SECTION) params.set('cat', filters.category);
  if (filters.tag && filters.tag !== DEFAULT_SECTION) params.set('tag', filters.tag);
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (filters.query) params.set('q', filters.query);
  return params.toString().replace(/\+/g, '%20');
}
