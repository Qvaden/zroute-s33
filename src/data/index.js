/**
 * ТОЧКА ПЕРЕКЛЮЧЕНИЯ ИСТОЧНИКА ДАННЫХ.
 *
 * Весь остальной код импортирует только `db` отсюда и не знает,
 * откуда реально приходят данные. Переезд между источниками =
 * одна строка в config.js.
 */
import { CONFIG } from '../../config.js';
import * as json from './adapters/json.js';
import * as sheets from './adapters/sheets.js';
import * as pocketbase from './adapters/pocketbase.js';

const ADAPTERS = { json, sheets, pocketbase };

const selected = ADAPTERS[CONFIG.dataSource];
if (!selected) {
  throw new Error(
    `Неизвестный источник данных: «${CONFIG.dataSource}». ` +
      `Доступны: ${Object.keys(ADAPTERS).join(', ')}`
  );
}

/** @type {import('./types.js').DataAdapter} */
export const db = selected;

/** @type {import('./types.js').Capabilities} */
export const capabilities = selected.capabilities;

/**
 * Загружает всё разом. Объёмы тут крошечные — 32 альянса на 52 недели
 * это меньше двух тысяч строк в год, поэтому серверную фильтрацию
 * намеренно не делаем: как только начнёшь оптимизировать то, что
 * не тормозит, адаптеры разъедутся по возможностям.
 */
export async function loadAll() {
  const [alliances, weeks, results, events, texts] = await Promise.all([
    db.getAlliances(),
    db.getWeeks(),
    db.getResults(),
    db.getEvents(),
    db.getTexts(),
  ]);
  return { alliances, weeks, results, events, texts };
}
