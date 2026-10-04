/**
 * ТОЧКА ПЕРЕКЛЮЧЕНИЯ ИСТОЧНИКА ДАННЫХ.
 *
 * Весь остальной код импортирует только `db` отсюда и не знает,
 * откуда реально приходят данные. Переезд между источниками =
 * одна строка в config.js.
 *
 * ПОЧЕМУ ЗДЕСЬ ЕСТЬ ВТОРАЯ ПОПЫТКА, О КОТОРОЙ НИКТО НЕ ПРОСИЛ.
 *
 * Основной источник — база, и она висит за чужой сетью: адрес
 * `*.supabase.co` отдаёт Cloudflare, а российские провайдеры без VPN
 * иногда режут его целиком. Оболочка сайта в этот момент приходит
 * (она лежит на GitHub и Render), а данные — нет, и страница показывала
 * пустой рейтинг молча. Человек читает это как «сайт умер», хотя дело
 * ровно в одном запросе.
 *
 * Поэтому: если основной источник не ответил, сайт читает `data/live.json`
 * с того же адреса, откуда уже пришёл сам. Этот файл воркфлоу
 * `backup-from-db.yml` обновляет каждые два часа, и он в том же репозитории,
 * что и зеркало, — то есть доступность у него ровно та же, что у страницы,
 * которая его показывает. Дальше сайт говорит вслух, что на экране снимок
 * и каким часом он снят.
 *
 * Часовая свежесть здесь не цель: данные сайта правят руками после каждого
 * VS, то есть несколько раз в сутки. Ровно два часа выбраны потому, что
 * почасовой прогон вдвое дороже по минутам GitHub Actions, а читателю важнее
 * не возраст копии, а признание сайта, что он смотрит копию.
 *
 * Чего это НЕ лечит: форум, вход и запись постов. Они ходят в живую базу
 * напрямую, и без базы их не заменит никакой снимок — поэтому полоска
 * о снимке говорит и об этом.
 */
import { CONFIG } from '../../config.js';
import * as json from './adapters/json.js';
import * as sheets from './adapters/sheets.js';
import * as pocketbase from './adapters/pocketbase.js';
import * as supabase from './adapters/supabase.js';

const ADAPTERS = { json, sheets, pocketbase, supabase };

const selected = ADAPTERS[CONFIG.dataSource];
if (!selected) {
  throw new Error(
    `Неизвестный источник данных: «${CONFIG.dataSource}». ` +
      `Доступны: ${Object.keys(ADAPTERS).join(', ')}`
  );
}

/** @type {import('./types.js').DataAdapter} */
export const db = selected;

/**
 * ПУСТОЙ НАБОР НЕ ОТДАЁТСЯ ЗА СВЕЖИЕ ДАННЫЕ.
 *
 * Здесь три состояния, и их различает читатель, а не только код: живой
 * источник отдал данные (`source` = имя адаптера), данные пришли из
 * снимка в `data/live.json` (`source` = 'снимок', `snapshotAt` = когда он
 * снят), и не пришло ничего (`source` = ''). `primaryError` хранит, чем именно
 * ответил основной источник, — без этой строки объяснение на странице
 * свелось бы к «что-то не загрузилось».
 */
export let lastLoad = {
  source: selected.name, snapshotAt: null, primaryError: '',
};

/** @type {import('./types.js').Capabilities} */
export const capabilities = selected.capabilities;

/**
 * Загружает всё разом. Объёмы тут крошечные — 32 альянса на 52 недели
 * это меньше двух тысяч строк в год, поэтому серверную фильтрацию
 * намеренно не делаем: как только начнёшь оптимизировать то, что
 * не тормозит, адаптеры разъедутся по возможностям.
 */
async function readAll(adapter) {
  const [alliances, weeks, results, events, texts] = await Promise.all([
    adapter.getAlliances(),
    adapter.getWeeks(),
    adapter.getResults(),
    adapter.getEvents(),
    adapter.getTexts(),
  ]);
  return { alliances, weeks, results, events, texts };
}

/*
  Копия `data/live.json` снята с того набора, о котором договорились в
  config.js, и сервер на сайте один — поэтому спасать ей больше нечего и
  объяснять расхождение выбора с копией некому.
*/
export async function loadAll() {
  let primaryError = '';

  try {
    const data = await readAll(selected);
    lastLoad = { source: selected.name, snapshotAt: null, primaryError: '' };
    return data;
  } catch (err) {
    primaryError = String(err?.message ?? err);
    /*
      Снимок и есть этот же адаптер: просить его спасти ситуацию, когда он
      сам не ответил, нечего. Ошибку отдаём наружу как раньше.
    */
    if (selected === json) {
      lastLoad = { source: '', snapshotAt: null, primaryError };
      throw err;
    }
  }

  /*
    Сюда доходит только пролёт основной попытки: удачная возвращает данные
    внутри try. Падение снимка летит наружу — врать про «всё хорошо» права
    нет, а объяснением займётся тот, кто ловит ошибку.
  */
  try {
    const data = await readAll(json);
    lastLoad = {
      source: 'снимок',
      snapshotAt: await json.getPulledAt(),
      primaryError,
    };
    return data;
  } catch (err) {
    lastLoad = { source: '', snapshotAt: null, primaryError };
    throw err;
  }
}
