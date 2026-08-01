/**
 * КАРТИНКИ ДЛЯ ХРОНОЛОГИИ — подготовка в браузере перед загрузкой.
 *
 * Фотографии с телефона весят по несколько мегабайт и годами копились бы
 * в репозитории как есть, раздувая его и замедляя сайт. Поэтому перед
 * загрузкой картинка уменьшается и пережимается через обычный Canvas —
 * без единой библиотеки: в проекте их принципиально нет, он и сейчас
 * собирается без единого шага сборки. На выходе всегда JPEG — так предсказуем
 * и формат, и итоговый размер файла.
 *
 * Загрузка (сеть, repo.js) сюда не входит: этот модуль только готовит байты.
 */

const MAX_DIMENSION = 1600;
const QUALITY = 0.82;
const QUALITY_RETRY = 0.6;
const RETRY_THRESHOLD = 3 * 1024 * 1024;
const MAX_INPUT_SIZE = 40 * 1024 * 1024;

/**
 * Уникальное имя файла под загрузку.
 *
 * Не привязано к id записи: картинку можно выбрать раньше, чем у новой
 * записи вообще появится id (он назначается только при сохранении в список).
 *
 * @param {string} ext
 */
export function uploadPath(ext = 'jpg') {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `public/uploads/${token}.${ext}`;
}

/** @param {HTMLCanvasElement} canvas @param {number} quality */
function toJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Уменьшает и сжимает картинку, отдаёт готовый Blob.
 *
 * Бросает понятную ошибку, если браузер не смог прочитать файл — например
 * HEIC, формат фото по умолчанию на части iPhone, который умеет не каждый
 * браузер. Отдельную библиотеку для его расшифровки не подключаю: это была бы
 * первая и единственная зависимость в проекте без единого шага сборки.
 *
 * @param {File} file
 */
export async function prepareImage(file) {
  if (!String(file?.type ?? '').startsWith('image/')) {
    throw new Error('Это не картинка. Выберите файл JPG, PNG или похожий.');
  }
  if (file.size > MAX_INPUT_SIZE) {
    throw new Error('Файл слишком большой (больше 40 МБ). Выберите файл поменьше.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      'Не получилось прочитать это изображение — похоже, браузер не понимает его формат ' +
        '(частый случай — HEIC на iPhone). Сохраните фото как JPG или PNG и попробуйте снова.'
    );
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

    let blob = await toJpeg(canvas, QUALITY);
    // Редкий случай очень «шумной» картинки, которую JPEG сжимает плохо:
    // одна повторная попытка с более сильным сжатием, а не цикл без конца —
    // для летописи сервера этого достаточно.
    if (blob && blob.size > RETRY_THRESHOLD) {
      blob = await toJpeg(canvas, QUALITY_RETRY);
    }
    if (!blob) throw new Error('Браузер не смог обработать это изображение.');

    return blob;
  } finally {
    bitmap.close?.();
  }
}
