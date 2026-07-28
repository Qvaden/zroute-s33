/**
 * Минимальный, но корректный парсер CSV.
 *
 * Своя реализация вместо библиотеки — чтобы у проекта не было ни одной
 * зависимости и ни шага сборки. Сайт должен запускаться открытием файла,
 * а не установкой пакетов: его будут поддерживать не программисты.
 *
 * Умеет то, что реально встречается в выгрузке Google Таблиц:
 * кавычки, запятые и переносы строк внутри значений, «» внутри кавычек, CRLF.
 */

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Убираем BOM — Google его иногда добавляет, и он приклеивается к первому заголовку.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // пропускаем, перевод строки обработает \n
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * CSV с первой строкой-заголовком → массив объектов.
 *
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    /** @type {Record<string, string>} */
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });
}
