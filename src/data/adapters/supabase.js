/**
 * АДАПТЕР: данные сайта из базы.
 *
 * РАБОЧИЙ РЕЖИМ после переезда с data/live.json. Читает один вызов функции
 * `site_dataset(p_server)`, которая отдаёт набор одного сервера ровно в том же
 * виде, что лежал в JSON — поэтому разбор общий с json-адаптером (`_map.js`),
 * и расхождения между источниками быть не может по устройству, а не по
 * договорённости.
 *
 * НОМЕР СЕРВЕРА берётся из `src/data/server.js`, а не отсюда: тот же набор
 * читает панель, и два места с одним числом однажды показали бы человеку
 * рейтинг одного сервера, а правку — другого.
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
import { datasetBody, siteServer } from '../server.js';
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

/**
 * Один ответ на страницу: пять геттеров делят один запрос.
 * @type {Promise<any>|null}
 */
let running = null;

/** Сбрасывает кэш, чтобы следующий запрос перечитал базу. */
export function clearCache() {
  running = null;
}

async function raw() {
  const server = siteServer();
  if (running) return running;

  const pending = (async () => {
    if (!isConfigured()) {
      throw new Error(
        'База не настроена: в config.js пустые supabase.url и anonKey. ' +
          'Порядок подключения — docs/FORUM.md.'
      );
    }

    /*
      ОДИН ПОВТОР ПРИ ОБРЫВЕ ОТВЕТА.

      Путь до базы из России без VPN идёт через чужие крайние узлы, и часть
      из них обрывает ответ на середине. Замер 27.10.2026 с домашнего
      Ростелекома при выключенном VPN: из четырёх адресов, которые отдаёт DNS
      на `*.supabase.co`, два (8.47.69.5 и 8.6.112.5) доводят 25 КБ из 53 и
      дальше молчат до таймаута, а два других отдают ответ целиком за 0,25 с.
      В одном соединении обрывается примерно один поток из трёх — значит,
      повтор обычно попадает на живой. Без него читатель на таком узле каждый
      раз получал снимок вместо живых данных и не знал, что дело в одном
      запросе: полоска говорит «живая база не ответила», а она отвечала,
      только не до конца.
    */
    const data = await rest('/rpc/site_dataset', {
      method: 'POST',
      body: datasetBody(server),
      retryOnAbort: true,
    });

    /*
      Пустой ответ означает, что функции в базе нет: скорее всего
      supabase/applied/site-data.sql ещё не запускали. Сказать об этом прямо
      дешевле, чем показать сайт без данных и оставить человека гадать.

      Путь назван ровно так, как файл лежит на диске: человек по нему и
      пойдёт, а опечатка в тексте ошибки стоит дороже опечатки в коде — её
      не увидеть, пока база не откажет.

      Второй файл назван рядом с первым намеренно: вызова с `p_server` база
      без него не знает, и отказ выглядит как «данных нет», хотя данные в
      таблицах лежат.
    */
    if (!data || typeof data !== 'object') {
      throw new Error(
        'База не отдала данные сайта. Похоже, не выполнен ' +
          'supabase/applied/site-data.sql или supabase/applied/20261004-site-server-scope.sql.'
      );
    }
    return data;
  })();

  running = pending;

  /*
    Неудачную попытку не оставляем: иначе один сбой сети закрыл бы данные до
    перезагрузки страницы. Сброс проверяет, что в кэше всё ещё лежит именно эта
    неудачная попытка, — за время её ожидания мог уйти новый запрос, и стирать
    его старой не нужно.
  */
  pending.catch(() => {
    if (running === pending) running = null;
  });

  return pending;
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
