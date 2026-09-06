/**
 * КАРТИНКИ ДЛЯ ХРОНОЛОГИИ — тонкая обёртка над общей подготовкой.
 *
 * Само сжатие живёт в src/ui/image-prep.js: к картинкам добрался второй
 * потребитель (форум — вложения и аватарки), и держать две копии одного
 * сжатия значило бы два предела веса и два места, где можно забыть про HEIC.
 *
 * Файл оставлен, чтобы не переписывать вызовы в панели и не смешивать
 * переезд с правкой экранов.
 */
import { prepareImage as prepare, uploadPath as makePath } from '../ui/image-prep.js';

/** Путь для фотографии летописи. */
export function uploadPath(ext = 'jpg') {
  return makePath('events', ext);
}

/** @param {File} file */
export function prepareImage(file) {
  return prepare(file, 'photo');
}
