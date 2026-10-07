/**
 * ТОЧКА ПЕРЕКЛЮЧЕНИЯ ФОРУМА.
 *
 * Ровно та же роль, что у src/data/index.js для данных сайта: страницы
 * импортируют только `forum` отсюда и не знают, где лежат посты. Переезд
 * с локального режима на общую базу — одна строка в config.js.
 *
 * ПОЧЕМУ ЧЕРНОВЫЙ АДАПТЕР ПРИХОДИТ ОТДЕЛЬНЫМ ЗАПРОСОМ.
 *
 * `adapters/local.js` — режим разработки: он держит ленту в localStorage и
 * никогда не бывает нужен тому, кто открыл сайт. До этого он ехал в стартовом
 * графе вместе с боевым адаптером: 193 КБ исходника, ~49 КБ по сети, один
 * запрос из шести соединений на HTTP/1.1 — и ни одного читателя в бою.
 *
 * Поэтому боевой адаптер остаётся статическим импортом (в бою `forumReady()`
 * не ждёт ничего), а черновой приходит по `import()` только когда в config.js
 * стоит `source: 'local'`. Страницы от этого не теряют ничего: они обращаются
 * к `forum.…` в момент вызова, а не в момент импорта.
 *
 * Чего здесь намеренно нет:
 *  - Proxy-заглушки — панель пробует возможности проверкой
 *    `typeof forum.X === 'function'`, и под Proxy такая проба врёт;
 *  - верхнеуровневого await (TLA) — он превратил бы ожидание адаптера в
 *    условие загрузки всего графа и сломал бы вход на старых Safari.
 *
 * Вместо них `forum` — обычный объект, который заполняется один раз:
 * синхронно, если адаптер уже принесён статическим импортом, и после
 * `await forumReady()` в черновом режиме. Вход сайта и панель этот вызов
 * делают, поэтому порядок всегда правильный.
 */
import { CONFIG } from '../../config.js';
import * as supabase from './adapters/supabase.js';

const ADAPTERS = { supabase };

/**
 * Адаптеры, которых нет в стартовом графе. Ключ — то же имя, что стоит в
 * config.js, значение — функция, приносящая модуль.
 */
const LAZY = {
  local: () => import('./adapters/local.js'),
};

/** @type {import('./contract.js').ForumAdapter} */
export const forum = {};

let started = null;

async function fill() {
  const name = CONFIG.forum.source;
  let adapter = ADAPTERS[name];
  if (!adapter && LAZY[name]) adapter = await LAZY[name]();
  if (!adapter) {
    throw new Error(
      `Неизвестный источник форума: «${name}». ` +
        `Доступны: ${[...Object.keys(ADAPTERS), ...Object.keys(LAZY)].join(', ')}`
    );
  }
  Object.assign(forum, adapter);
  return forum;
}

/**
 * Гарантирует, что `forum` наполнен. В бою он наполнен ещё до этого вызова —
 * адаптер лежит рядом с этим файлом, — поэтому ждать сети нет ни секунды.
 */
export function forumReady() {
  if (!started) started = fill();
  return started;
}

if (ADAPTERS[CONFIG.forum.source]) forumReady();
