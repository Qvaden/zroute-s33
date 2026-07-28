/**
 * Собирает шаблон Google Таблицы: по одному CSV на вкладку.
 *
 * Структура берётся из scripts/sheet-schema.mjs — там же, откуда её читает
 * тест. Так шаблон и код не могут разойтись незаметно.
 *
 * Запуск:  node scripts/make-sheet-template.mjs
 * Выход:   dist/sheet-template/<вкладка>.csv
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { TABS, toCsv, weeks } from './sheet-schema.mjs';

await mkdir('dist/sheet-template', { recursive: true });

for (const [tab, { headers, rows }] of Object.entries(TABS)) {
  await writeFile(`dist/sheet-template/${tab}.csv`, toCsv(headers, rows), 'utf8');
  console.log(`  ${tab}.csv — колонок ${headers.length}, строк ${rows.length}`);
}

console.log(
  `\nГотово: dist/sheet-template/ (${Object.keys(TABS).length} вкладки)\n` +
    `Недели подготовлены с ${weeks[0].id} (${weeks[0].startDate}) по ${weeks.at(-1).id}.`
);
