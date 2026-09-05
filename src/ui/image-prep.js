/**
 * КАРТИНКИ В БРАУЗЕРЕ — подготовка перед загрузкой.
 *
 * Вынесено из admin/image.js, когда картинки понадобились не только панели:
 * теперь их прикрепляют к постам и комментариям, и у людей появились аватарки.
 * Держать три копии сжатия — три разных предела веса и три места, где можно
 * забыть про HEIC.
 *
 * ЗАЧЕМ СЖИМАТЬ ВООБЩЕ. Фотография с телефона весит 3–8 МБ. Без сжатия
 * бесплатное хранилище (1 ГБ) кончится на двухсотом скриншоте, а лента
 * на мобильном интернете превратится в ожидание. Уменьшение до 1600 пикселов
 * по длинной стороне даёт файл в 200–400 КБ и не портит скриншот из игры.
 *
 * Обычный Canvas, без библиотек: в проекте их нет принципиально, он собирается
 * без единого шага сборки.
 */

/** Пределы под разные задачи. Аватарка маленькая и квадратная, скриншот большой. */
const PRESETS = {
  /* Фото в летописи и вложения к постам: читаемый скриншот интерфейса игры. */
  photo: { max: 1600, quality: 0.82, retryQuality: 0.6, retryOver: 3 * 1024 * 1024 },
  /*
    Аватарка. 256 пикселов хватает: показывается она размером 36–96,
    удвоение — запас под экраны с высокой плотностью. Больше означало бы
    хранить в десять раз больше байтов ради невидимой разницы.
  */
  avatar: { max: 256, quality: 0.85, retryQuality: 0.7, retryOver: 200 * 1024, square: true },
};

const MAX_INPUT_SIZE = 40 * 1024 * 1024;

/**
 * Уникальное имя файла под загрузку.
 *
 * Не привязано к записи, к которой картинка относится: её выбирают раньше,
 * чем у новой записи появится идентификатор.
 *
 * @param {string} folder
 * @param {string} ext
 */
export function uploadPath(folder = 'uploads', ext = 'jpg') {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${folder}/${token}.${ext}`;
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
 * первая и единственная зависимость в проекте без шага сборки.
 *
 * @param {File|Blob} file
 * @param {'photo'|'avatar'} [preset]
 */
export async function prepareImage(file, preset = 'photo') {
  const cfg = PRESETS[preset] ?? PRESETS.photo;

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
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (cfg.square) {
      /*
        Аватарка обрезается по центру до квадрата, а не сжимается по осям.
        Сжатие превратило бы лицо на портретном фото в приплюснутое, и человек
        решил бы, что сайт испортил его картинку.
      */
      const side = Math.min(bitmap.width, bitmap.height);
      const sx = Math.round((bitmap.width - side) / 2);
      const sy = Math.round((bitmap.height - side) / 2);
      const out = Math.min(cfg.max, side);

      canvas.width = out;
      canvas.height = out;
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    } else {
      const scale = Math.min(1, cfg.max / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(bitmap, 0, 0, w, h);
    }

    let blob = await toJpeg(canvas, cfg.quality);
    /*
      Редкий случай очень «шумной» картинки, которую JPEG сжимает плохо:
      одна повторная попытка с более сильным сжатием, а не цикл без конца —
      для скриншотов из игры этого достаточно.
    */
    if (blob && blob.size > cfg.retryOver) {
      blob = await toJpeg(canvas, cfg.retryQuality);
    }
    if (!blob) throw new Error('Браузер не смог обработать это изображение.');

    return blob;
  } finally {
    bitmap.close?.();
  }
}
