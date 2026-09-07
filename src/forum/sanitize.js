/**
 * ОЧИСТКА ЧУЖОГО HTML — ЯДРО БЕЗОПАСНОСТИ ФОРМАТИРОВАНИЯ.
 *
 * Раньше текст хранился как набран, и разметка строилась при показе белым
 * списком из четырёх конструкций (format.js). Теперь участник форматирует
 * текст «по-живому» в редакторе, и на хранение уходит HTML. Это значит, что
 * чужой HTML проходит через браузер читателя, и цена ошибки здесь та же, что
 * всегда: незакрытая подстановка означает скрипт на нашем домене.
 *
 * ПОЭТОМУ ФОРМАТИРОВАНИЕ — БЕЛЫЙ СПИСОК ТЕГОВ, А НЕ ПРИЁМНИК HTML.
 *   — всё, что не в списке (script, img, table, div, style и т.п.), выкидывается;
 *     текст внутри таких тегов сохраняется как обычный текст;
 *   — атрибуты разрешены ровно двум тегам: a (только href через safeUrl)
 *     и span (только style="color: …" из безопасного набора);
 *   — всё прочее выходит без атрибутов вообще;
 *   — вложенность приводится к хорошо сформированной (каждый открытый тег
 *     закрывается), чтобы вёрстка не «перетекала» за пределы поста;
 *   — сущности честно декодируются на вход и экранируются на выходе, поэтому
 *     повторная очистка не плодит двойное экранирование.
 *
 * Файл напрямую не трогает DOM: очистка нужна и на сервере (превью, сборка),
 * и в браузере (перед отправкой), поэтому здесь только строки и регулярки.
 */
import { esc, safeUrl } from '../ui/helpers.js';

const BLOCK = new Set(['p', 'h3', 'blockquote', 'pre', 'ul', 'ol', 'li']);
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'code', 'span', 'a']);
const VOID = new Set(['br', 'img', 'hr']);

/** Приведение названий к канону: b → strong, i → em, strike → s, div → p. */
function canon(tag) {
  if (tag === 'b') return 'strong';
  if (tag === 'i') return 'em';
  if (tag === 'strike') return 's';
  if (tag === 'div') return 'p';
  return tag;
}

/** Декодирование сущностей на входе: esc() на выходе их вернёт обратно. */
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[\w]+);/g, (m) => {
    const body = m.slice(1, -1);
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(2), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) return String.fromCodePoint(code);
      return m;
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' }[body.toLowerCase()];
    return named ?? m;
  });
}

/** Разбор атрибутов тега. */
function parseAttrs(tail) {
  const attrs = [];
  const re = /([a-zA-Z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(tail)) !== null) {
    attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' });
  }
  return attrs;
}

/**
 * Токены исходника: текст и теги. Мусор без закрывающей скобки и незакрытые
 * имена не выкидываем, а возвращаем текстом — при очистке он будет экранирован.
 */
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push({ type: 'text', value: src.slice(i) }); break; }
    if (lt > i) out.push({ type: 'text', value: src.slice(i, lt) });

    const gt = src.indexOf('>', lt);
    if (gt === -1) { out.push({ type: 'text', value: src.slice(lt) }); break; }

    const raw = src.slice(lt + 1, gt);
    i = gt + 1;

    if (/^!--/.test(raw)) continue; // комментарий
    const m = raw.match(/^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*)$/);
    if (!m) { out.push({ type: 'text', value: `${raw}>` }); continue; }

    const closing = Boolean(m[1]);
    const name = m[2].toLowerCase();
    const tail = m[3].replace(/\/+\s*$/, '');

    if (closing) { out.push({ type: 'tag', name, closing }); continue; }
    out.push({ type: 'tag', name, closing: false, attrs: parseAttrs(tail) });
  }
  return out;
}

/** Цвет из style: только безопасные формы. Всё прочее — пусто (тег уходит). */
function parseColor(style) {
  if (!style) return '';
  for (const part of String(style).split(';')) {
    const m = part.match(/^\s*color\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const v = m[1].trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v.toLowerCase();
    const rgb = v.match(/^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i);
    if (rgb && rgb.slice(1).every((n) => +n <= 255)) return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
    const rgba = v.match(/^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*([01](?:\.\d+)?|\.\d+)\)$/i);
    if (rgba && rgba.slice(1, 4).every((n) => +n <= 255)) {
      return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${rgba[4]})`;
    }
  }
  return '';
}

/**
 * Очистка HTML по белому списку.
 * @param {string} raw
 */
export function sanitizeHtml(raw) {
  const src = String(raw ?? '').trim();
  if (!src) return '';

  const stack = [];
  let out = '';

  const closeTo = (keepInline) => {
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (keepInline && INLINE.has(top)) { out += `</${stack.pop()}>`; continue; }
      if (!keepInline) { out += `</${stack.pop()}>`; continue; }
      break;
    }
  };

  for (const tok of tokenize(src)) {
    if (tok.type === 'text') {
      out += esc(decodeEntities(tok.value));
      continue;
    }

    const name = canon(tok.name);

    if (tok.closing) {
      if (name === 'br') continue;
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue; // чужие/перекошенные закрытия игнорируем
      while (stack.length > idx) out += `</${stack.pop()}>`;
      continue;
    }

    if (VOID.has(tok.name)) {
      if (tok.name === 'br') out += '<br>';
      continue; // img и hr исчезают целиком
    }
    if (!BLOCK.has(name) && !INLINE.has(name)) continue; // чужой тег — только текст внутри

    if (BLOCK.has(name)) {
      /*
        Блочные теги живут по-своему: blockquote и pre — контейнеры (внутри
        них могут быть p и списки), ul/ol держат li. Общие же p и h3 — соседи:
        новый открытый закрывает предыдущий, иначе из книжной вёрстки
        получается матрёшка. closeTo(true) снимает сначала строчную разметку.
      */
      closeTo(true);
      if (name === 'li') {
        while (stack.length && stack[stack.length - 1] !== 'ul' && stack[stack.length - 1] !== 'ol') {
          out += `</${stack.pop()}>`;
        }
      } else {
        while (stack.length) {
          const t = stack[stack.length - 1];
          if (t === 'p' || t === 'h3' || t === 'li') { out += `</${stack.pop()}>`; continue; }
          break;
        }
      }
    }

    if (name === 'a') {
      const url = safeUrl(decodeEntities((tok.attrs ?? []).find((a) => a.name === 'href')?.value ?? ''));
      if (!url) continue;
      stack.push('a');
      out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer ugc">`;
      continue;
    }
    if (name === 'span') {
      const color = parseColor((tok.attrs ?? []).find((a) => a.name === 'style')?.value ?? '');
      if (!color) continue;
      stack.push('span');
      out += `<span style="color:${color}">`;
      continue;
    }

    stack.push(name);
    out += `<${name}>`;
  }

  closeTo(false);
  return out;
}

/**
 * Видимый текст посторонней записи: без тегов и разметки.
 * Используется для выжимок, длины и цитат — везде, где нужен «что прочитает
 * человек», а не HTML.
 * @param {string} html
 */
export function textOf(html) {
  let out = '';
  for (const tok of tokenize(String(html ?? ''))) {
    if (tok.type === 'text') out += decodeEntities(tok.value);
    else if ((tok.closing || tok.name === 'br') && /\b(?:p|h3|li|pre|blockquote|div|br)\b/i.test(tok.name)) {
      out += '\n';
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Ссылки из текста. Принимает уже очищенный HTML: внутри <a> и <pre> ссылки
 * не ищем, в остальном тексте — ищем и превращаем в ссылки с доменом в подписи.
 * Схему проверяем через safeUrl: `javascript:` в href остаётся рабочим кодом
 * даже после экранирования кавычек.
 * @param {string} safe Уже очищенный и экранированный HTML.
 */
export function linkify(safe) {
  let out = '';
  let i = 0;
  let aDepth = 0;
  let preDepth = 0;

  while (i < safe.length) {
    const c = safe[i];
    if (c === '<') {
      const gt = safe.indexOf('>', i);
      if (gt === -1) { out += safe.slice(i); break; }
      const raw = safe.slice(i, gt + 1);
      out += raw;
      const m = raw.match(/^<\s*\/?\s*([a-zA-Z][\w-]*)/);
      if (m) {
        const nm = m[1].toLowerCase();
        const closing = /^<\s*\//.test(raw);
        if (nm === 'a') aDepth += closing ? -1 : 1;
        if (nm === 'pre') preDepth += closing ? -1 : 1;
        aDepth = Math.max(0, aDepth);
        preDepth = Math.max(0, preDepth);
      }
      i = gt + 1;
      continue;
    }

    if (aDepth > 0 || preDepth > 0 || !safe.startsWith('https://', i) && !safe.startsWith('http://', i)) {
      out += c;
      i += 1;
      continue;
    }

    // Строка адреса: до пробела или до тега.
    let j = i;
    while (j < safe.length && !/\s/.test(safe[j]) && safe[j] !== '<') j += 1;
    let hit = safe.slice(i, j);
    const trimmed = hit.replace(/[.,;:!?)»"']+$/, '');
    const tail = hit.slice(trimmed.length);

    const raw = trimmed
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
    const url = safeUrl(raw);
    if (!url) { out += c; i += 1; continue; }

    let label = trimmed;
    try {
      label = new URL(raw).hostname.replace(/^www\./, '');
    } catch { /* адрес не разобрался — покажем как есть, он уже экранирован */ }

    out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer ugc">${esc(label)}</a>${tail}`;
    i += trimmed.length + tail.length;
  }
  return out;
}