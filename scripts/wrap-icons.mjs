/**
 * Заворачивает готовые PNG-иконки в SVG-обёртки.
 *
 * ЗАЧЕМ ЭТО НУЖНО.
 * Интеграция с GitHub, через которую заливается репозиторий, умеет передавать
 * только текст: бинарный файл она портит (base64 сохраняется как текст,
 * а сырые байты раздуваются при перекодировке в UTF-8). Проверено опытом.
 *
 * SVG — текст, поэтому заливается без потерь. А внутрь можно вложить точный
 * PNG как data-URI: браузер отрисует его пиксель в пиксель, никакой разницы
 * с обычным PNG нет.
 *
 * Что это НЕ решает: iOS не принимает SVG в apple-touch-icon, а превью ссылок
 * в мессенджерах требует растровой картинки. Эти два файла (icon-180.png
 * и og.png) нужно один раз загрузить в репозиторий вручную — см. README.
 *
 * Запуск:  node scripts/wrap-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const SIZES = [32, 192, 512];

for (const size of SIZES) {
  const png = await readFile(`public/icons/icon-${size}.png`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<image width="${size}" height="${size}" href="data:image/png;base64,${png.toString('base64')}"/>` +
    `</svg>\n`;
  await writeFile(`public/icons/icon-${size}.svg`, svg, 'utf8');
  console.log(`  icon-${size}.svg — ${(svg.length / 1024).toFixed(1)} КБ`);
}

const mask = await readFile('public/icons/maskable-512.png');
await writeFile(
  'public/icons/maskable-512.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<image width="512" height="512" href="data:image/png;base64,${mask.toString('base64')}"/>` +
    `</svg>\n`,
  'utf8'
);
console.log(`  maskable-512.svg — ${(mask.length * 1.37 / 1024).toFixed(1)} КБ`);
console.log('\nГотово.');
