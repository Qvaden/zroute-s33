/**
 * ВЛОЖЕНИЯ В ЧАТАХ: ЧТО ЭТО ЗА ФАЙЛ, СКОЛЬКО ОН ВЕСИТ И КАК ЕГО НАЗЫВАТЬ.
 *
 * Отдельным файлом, а не строкой внутри страницы чатов, по той же причине,
 * что и image-prep.js: одно и то же нужно в трёх местах — в браузере при
 * выборе файла, в адаптере базы при загрузке и в локальном адаптере.
 * Три копии «похоже на видео?» разошлись бы на первом же формате, который
 * придёт с телефона (.mov, .3gp, .heic).
 *
 * ЧТО РЕШАЕТСЯ ЗДЕСЬ И ЧТО НЕ ЗДЕСЬ. Здесь только разбор выбранного файла
 * и единый вид подписей («1,2 МБ», «0:42»). Права, хранилище и пределы базы
 * живут в адаптерах и в SQL: проверка в браузере нужна, чтобы человек
 * получил понятное «файл больше 25 МБ» до загрузки, а не «ошибка 413» после.
 */
import { CONFIG } from '../../config.js';

/** Пределы вложений. Те же числа стоят в триггере базы (supabase/chats.sql). */
export const CHAT_LIMITS = CONFIG.forum.chat;

/** Виды вложений. Больше не бывает: и хранилище, и показ завязаны на этот список. */
export const KINDS = ['image', 'video', 'audio', 'file'];

export const KIND_LABEL = {
  image: 'Картинка',
  video: 'Видео',
  audio: 'Голосовое',
  file: 'Файл',
};

/** Значок вида — для карточек вложений и для выжимки в списке чатов. */
export const KIND_GLYPH = {
  image: '🖼',
  video: '🎬',
  audio: '🎤',
  file: '📎',
};

const MIME_KINDS = [
  [/^image\//, 'image'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
];

/**
 * ЧТО В ЧАТ НЕ ОТДАЁТСЯ ВОВСЕ.
 *
 * Файл из чата открывается по ссылке в хранилище, то есть в браузере. Страница
 * на том же адресе, что и картинка, выполнит свой скрипт в домене хранилища —
 * а оттуда уже недалеко до фишинга «войди ещё раз, тут новая версия сайта».
 * Исполняемые файлы добавляют к этому второй сюжет: «патч для клиента»,
 * который на самом деле лежит рядом с альянсовым чатом.
 *
 * Поэтому страницы, скрипты и программы отклоняются на входе — с понятной
 * причиной, а не молча. Тот же список зашит в триггер базы
 * (supabase/chats.sql): браузер можно обойти, базу — нет.
 */
export const BLOCKED_EXT = [
  'html', 'htm', 'xhtml', 'svg', 'xml', 'js', 'mjs',
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'jar', 'apk',
];

/** Расширение файла в нижнем регистре, без точки. Пусто, если его нет. */
function extOf(name) {
  const raw = String(name ?? '').toLowerCase();
  const dot = raw.lastIndexOf('.');
  if (dot < 0 || dot === raw.length - 1) return '';
  return raw.slice(dot + 1).replace(/[^a-z0-9]/g, '');
}

/**
 * Вид вложения по типу файла.
 *
 * Смотрим на MIME, а не на расширение: с телефона приходят .mov и .3gp,
 * и по расширению их пришлось бы перечислять вручную. Расширение — запасной
 * признак для случаев, когда браузер тип не назвал (бывает у файлов
 * из некоторых менеджеров).
 *
 * @param {File|Blob & {name?: string}} file
 * @returns {'image'|'video'|'audio'|'file'}
 */
export function kindOfFile(file) {
  const mime = String(file?.type ?? '').toLowerCase();
  for (const [re, kind] of MIME_KINDS) {
    if (re.test(mime)) return kind;
  }
  const name = String(file?.name ?? '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|avif|bmp|heic)$/.test(name)) return 'image';
  if (/\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/.test(name)) return 'video';
  if (/\.(mp3|ogg|oga|opus|m4a|aac|wav|webm)$/.test(name)) return 'audio';
  return 'file';
}

/** Предел веса для вида вложения. */
export function maxBytesFor(kind) {
  return CHAT_LIMITS.maxBytes[kind] ?? CHAT_LIMITS.maxBytes.file;
}

/**
 * Проверка перед загрузкой: вид и вес.
 *
 * Возвращает причину отказа текстом, а не исключение: решение принимает
 * страница — она может показать это рядом с полем выбора файла.
 *
 * @param {File} file
 * @returns {{ok: true, kind: string} | {ok: false, error: string}}
 */
export function checkFile(file) {
  if (!file) return { ok: false, error: 'Файл не выбран' };
  if (!file.size) return { ok: false, error: `«${nameOf(file)}» пустой — его нечего отправлять` };

  const ext = extOf(file.name);
  if (BLOCKED_EXT.includes(ext)) {
    return {
      ok: false,
      error: `«${nameOf(file)}» — файл, который открывается как программа или страница. ` +
        'Такое в чат не отправляется: пришлите архив или ссылку',
    };
  }

  const kind = kindOfFile(file);
  const max = maxBytesFor(kind);
  if (file.size > max) {
    return {
      ok: false,
      error: `${KIND_LABEL[kind]} «${nameOf(file)}» весит ${formatBytes(file.size)}, ` +
        `а предел — ${formatLimit(max)}`,
    };
  }
  return { ok: true, kind };
}

/**
 * Предел веса в подписи об отказе: «10 МБ», а не «10,0 МБ».
 *
 * Рядом стоит вес файла с десятыми, и «весит 10,0 МБ, а предел — 10,0 МБ»
 * выглядит как ошибка сайта, а не как объяснение. Ровный предел пишется
 * целым числом, дробный — как есть.
 */
export function formatLimit(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1000000 && n % 1000000 === 0) return `${n / 1000000} МБ`;
  if (n >= 1000 && n % 1000 === 0 && n < 1000000) return `${n / 1000} КБ`;
  return formatBytes(n);
}

/** Имя файла без пути и лишних пробелов: в подписи и в адресе хранилища. */
export function nameOf(file) {
  const raw = String(file?.name ?? '').trim().replace(/\s+/g, ' ');
  return raw.slice(0, CHAT_LIMITS.nameMax) || 'файл';
}

/**
 * Имя для хранилища: только безопасные символы.
 *
 * Имя файла приходит с чужого устройства и попадает в адрес объекта, поэтому
 * всё, кроме латиницы, цифр, точки, дефиса и подчёркивания, заменяется.
 * Иначе пробел или `#` в имени сломали бы адрес, а `../` — увели бы в чужую
 * папку. Русские имена при этом не теряются: они остаются в подписи вложения
 * (колонка `name`), а в хранилище лежит техническое имя.
 */
export function storageName(file, ext = '') {
  const raw = String(file?.name ?? 'file');
  const dot = raw.lastIndexOf('.');
  const base = (dot > 0 ? raw.slice(0, dot) : raw).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'file';
  const tail = ext || (dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin');
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${stamp}-${base}.${tail.slice(0, 5) || 'bin'}`;
}

/**
 * Вес по-человечески: «940 КБ», «1,2 МБ».
 *
 * Единицы в проекте десятичные (КБ = 1000 байт), как в проводнике Windows
 * и в игре: человек, читающий «2,4 МБ», сверяет это с размером файла
 * на телефоне, а не с определением мебибайта.
 */
export function formatBytes(n) {
  const size = Number(n) || 0;
  if (size < 1000) return `${size} Б`;
  if (size < 1000 * 1000) return `${Math.round(size / 1000)} КБ`;
  if (size < 1000 * 1000 * 1000) return `${(size / 1000000).toFixed(1).replace('.', ',')} МБ`;
  return `${(size / 1000000000).toFixed(2).replace('.', ',')} ГБ`;
}

/** Длительность записи: «0:42», «12:05». */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/**
 * Выжимка для списка чатов: «🖼 Фото · Иванов: текст».
 *
 * У сообщения из одних картинок тела нет вовсе, и в списке оставалась пустая
 * строка — чат выглядел так, будто в нём ничего не писали.
 */
export function attachmentLabel(kind, count = 1) {
  const word = { image: 'Фото', video: 'Видео', audio: 'Голосовое', file: 'Файл' }[kind] ?? 'Вложение';
  const many = { image: 'Фото', video: 'Видео', audio: 'Голосовые', file: 'Файлы' }[kind] ?? 'Вложения';
  return count > 1 ? `${KIND_GLYPH[kind]} ${many} · ${count}` : `${KIND_GLYPH[kind]} ${word}`;
}

/** Сколько вложений и каких в сообщении. */
export function attachmentKinds(attachments) {
  const list = Array.isArray(attachments) ? attachments.filter((a) => a?.url) : [];
  const out = {};
  for (const a of list) out[a.kind] = (out[a.kind] ?? 0) + 1;
  return out;
}

/**
 * Длительность аудио из Blob. Нужна голосовым сообщениям: в самом файле
 * длительность есть, но MediaRecorder пишет её не всегда, а показать «0:00»
 * хуже, чем показать «0:--».
 *
 * Возвращает 0, если браузер не смог прочитать — это не ошибка отправки.
 *
 * @param {Blob} blob
 * @returns {Promise<number>} миллисекунды
 */
export function audioDuration(blob) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(0); return; }
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    const done = (value) => {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(value);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    audio.onerror = () => done(0);
    // Страховка: некоторые браузеры не отвечают ни тем, ни другим на битом файле.
    setTimeout(() => done(0), 4000);
    audio.src = url;
  });
}

/** Файл → data-URL. Только для локального режима: там хранилища нет. */
export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Браузер не смог прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/** data-URL → Blob. Обратная дорога для локального режима. */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',');
  const mime = head?.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  if (!head?.includes('base64')) return new Blob([decodeURIComponent(body ?? '')], { type: mime });
  const bin = atob(body ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
