/**
 * АДАПТЕР: данные сайта из базы.
 *
 * РАБОЧИЙ РЕЖИМ после переезда с data/live.json. Читает один вызов функции
 * `site_dataset()`, которая отдаёт ровно тот же вид, что лежал в JSON —
 * поэтому разбор общий с json-адаптером (`_map.js`), и расхождения между
 * источниками быть не может по устройству, а не по договорённости.
 *
 * ПОЧЕМУ ОДИН ЗАПРОС, А НЕ ПЯТЬ. Объёмы крошечные: 32 альянса на 52 недели —
 * меньше двух тысяч строк в год. Пять запросов дали бы пять поводов для
 * частичной загрузки: альянсы приехали, результаты нет, и страница показывает
 * таблицу без цифр вместо честной ошибки.
 *
 * ЧТЕНИЕ РАБОТАЕТ БЕЗ ВХОДА. Сайт открытый: рейтинг обязан показываться
 * незарегистрированному человеку. Это обеспечивают правила доступа в базе
 * (select using(true)), а не отсутствие проверки здесь.
 */
import { rest, isConfigured } from '../../db/client.js';
import { mapAlliances, mapWeeks, mapResults, mapEvents, mapTexts } from './_map.js';

export const name = 'supabase';

/** @type {import('../types.js').Capabilities} */
export const capabilities = {
  /*
    Писать умеет — этим и отличается от json. Но пишет не адаптер, а панель:
    у записи своя логика прав и свой журнал, и складывать её сюда значило бы
    смешать «показать данные» с «изменить историю».
  */
  canWrite: true,
  canUploadImages: true,
  canAuth: true,
};

/** @type {Promise<any> | null} */
let cache = null;

/** Сбрасывает кэш, чтобы следующий запрос перечитал базу. */
export function clearCache() {
  cache = null;
}

async function raw() {
  if (cache) return cache;

  cache = (async () => {
    if (!isConfigured()) {
      throw new Error(
        'База не настроена: в config.js пустые supabase.url и anonKey. ' +
          'Порядок подключения — docs/FORUM.md.'
      );
    }

    const data = await rest('/rpc/site_dataset', { method: 'POST', body: {} });

    /*
      Пустой ответ означает, что функции в базе нет: скорее всего
      supabase/site-data.sql ещё не запускали. Сказать об этом прямо дешевле,
      чем показать сайт без данных и оставить человека гадать.
    */
    if (!data || typeof data !== 'object') {
      throw new Error(
        'База не отдала данные сайта. Похоже, не выполнен supabase/site-data.sql.'
      );
    }
    return data;
  })();

  // Неудачную попытку не запоминаем: иначе один сбой сети закрыл бы сайт
  // до перезагрузки страницы.
  cache.catch(() => { cache = null; });

  return cache;
}

export async function getAlliances() {
  return mapAlliances((await raw()).alliances);
}

export async function getWeeks() {
  return mapWeeks((await raw()).weeks);
}

export async function getResults() {
  return mapResults((await raw()).results);
}

export async function getEvents() {
  return mapEvents((await raw()).events);
}

export async function getTexts() {
  return mapTexts((await raw()).texts);
}
