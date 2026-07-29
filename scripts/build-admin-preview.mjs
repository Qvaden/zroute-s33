/**
 * Собирает панель в один HTML-файл на выдуманных данных.
 *
 * Зачем: панель без токена не открывается, а значит показать её кому-то
 * можно было бы только выдав доступ к настоящему репозиторию. Это плохой
 * выбор между «никому не показывать» и «дать права». Превью убирает его —
 * файл открывается двойным кликом, данные в нём выдуманные, а вёрстка
 * настоящая: те же экраны и тот же каркас, что в admin.html.
 *
 * Запуск:  node scripts/build-admin-preview.mjs [файл]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mapDataset } from '../src/data/adapters/_map.js';
import { validateDataset } from '../src/data/contract.js';
import { marksFromRaw } from '../src/admin/edit.js';
import { renderShell } from '../src/admin/shell.js';
import { renderOverview } from '../src/admin/screens/overview.js';
import { renderWeek } from '../src/admin/screens/week.js';
import { renderAlliances } from '../src/admin/screens/alliances.js';
import { renderEvents } from '../src/admin/screens/events.js';
import { renderTexts } from '../src/admin/screens/texts.js';

const outFile = process.argv[2] || 'dist/admin-preview.html';

const raw = JSON.parse(await readFile('data/demo.json', 'utf8'));
const data = mapDataset(raw);

// Самая свежая неделя — её и показываем на экране ввода.
const latestWeek = [...data.weeks].sort((a, b) => b.number - a.number)[0];

/*
  Правдоподобная обвязка вокруг данных: панель показывает не только сами
  данные, но и кто их правил последним и сколько весит файл. В превью это
  выдумано, но выдумано так, как выглядит в жизни.
*/
const view = {
  user: { login: 'редактор', name: '', avatar: '' },
  repo: { fullName: 'Qvaden/zroute-s33', isPrivate: false, defaultBranch: 'main', canPush: true },
  file: { path: 'data/live.json', size: 96_400, sha: 'd41d8cd98f00b204e9800998ecf8427e' },
  commit: {
    sha: 'a3f19c2',
    message: 'неделя 27: результаты внесены',
    date: new Date(),
    authorName: 'редактор',
    authorLogin: 'редактор',
  },
  raw,
  data,
  weeks: data.weeks,
  problems: validateDataset(data),

  /*
    Состояние экрана ввода. В настоящей панели его готовит main.js;
    здесь подставляем вручную, иначе превью показало бы «тридцать новых
    отметок» вместо «изменений нет» и предупреждение об отсутствии прав.
  */
  weekId: latestWeek?.id ?? null,
  marks: latestWeek ? marksFromRaw(raw, latestWeek.id) : {},
  draftSaved: null,
  canPush: true,
};

const SCREENS = [
  { id: 'overview', label: 'Обзор', html: renderOverview(view) },
  { id: 'week', label: 'Неделя', html: renderWeek(view, null) },
  { id: 'alliances', label: 'Альянсы', html: renderAlliances(view) },
  { id: 'events', label: 'Хронология', html: renderEvents(view) },
  { id: 'texts', label: 'Тексты', html: renderTexts(view) },
];

const [siteCss, admCss] = await Promise.all([
  readFile('src/styles.css', 'utf8'),
  readFile('src/admin/admin.css', 'utf8'),
]);

const inner = SCREENS.map(
  (s, i) => `<div class="page${i === 0 ? ' is-active' : ''}" id="page-${s.id}">${s.html}</div>`
).join('\n');

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Панель · Сервер 33 · превью</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${siteCss}
${admCss}
.page { display: none; }
.page.is-active { display: block; }
</style>
</head>
<body class="adm">
<div id="admin">
${renderShell({ screens: SCREENS, activeId: 'overview', inner, login: view.user.login })}
</div>

<script>
// Мини-роутер превью: в настоящей панели это делает адресная строка.
document.addEventListener('click', function (e) {
  var link = e.target.closest('a[href^="#/"]');
  if (!link) return;
  e.preventDefault();

  var id = link.getAttribute('href').replace(/^#\\/?/, '').split('/')[0] || 'overview';
  var target = document.getElementById('page-' + id);
  if (!target) return;

  document.querySelectorAll('.page').forEach(function (p) {
    p.classList.toggle('is-active', p === target);
  });
  document.querySelectorAll('.adm-nav__link').forEach(function (a) {
    a.classList.toggle('is-active', a.getAttribute('href') === '#/' + id);
  });
  window.scrollTo(0, 0);
});

// Кнопки панели в превью ничего не делают — объясняем это вслух,
// чтобы не выглядело поломкой.
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-refresh], [data-logout]')) {
    alert('Это превью на выдуманных данных. В настоящей панели кнопка работает.');
  }
});
</script>
</body>
</html>
`;

await mkdir(outFile.split('/').slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outFile, html, 'utf8');

console.log(`Готово: ${outFile}`);
console.log(`Экранов: ${SCREENS.length}, данные выдуманные (data/demo.json).`);
