/**
 * ТОЧКА ПЕРЕКЛЮЧЕНИЯ ФОРУМА.
 *
 * Ровно та же роль, что у src/data/index.js для данных сайта: страницы
 * импортируют только `forum` отсюда и не знают, где лежат посты. Переезд
 * с локального режима на общую базу — одна строка в config.js.
 */
import { CONFIG } from '../../config.js';
import * as local from './adapters/local.js';
import * as supabase from './adapters/supabase.js';

const ADAPTERS = { local, supabase };

const selected = ADAPTERS[CONFIG.forum.source];
if (!selected) {
  throw new Error(
    `Неизвестный источник форума: «${CONFIG.forum.source}». ` +
      `Доступны: ${Object.keys(ADAPTERS).join(', ')}`
  );
}

/** @type {import('./contract.js').ForumAdapter} */
export const forum = selected;

/** @type {import('./contract.js').ForumCapabilities} */
export const forumCapabilities = selected.capabilities;
