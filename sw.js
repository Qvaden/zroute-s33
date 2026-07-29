/*
  Service worker: только для установки на телефон и работы без связи.

  СТРАТЕГИЯ — СЕТЬ ВСЕГДА ПЕРВАЯ. Кэш используется исключительно как запас,
  когда сети нет.

  Это выбрано осознанно. Классическая беда service worker'ов — «залипшая»
  версия: человек открывает сайт, видит прошлую неделю и не понимает, почему.
  Для проекта, который ведут не программисты, такая поломка неотлаживаема:
  никто не будет объяснять пользователям, как чистить кэш браузера.

  Поэтому: пока есть интернет — данные всегда свежие. Кэш срабатывает
  только когда запрос вообще не прошёл. Устареть содержимое может лишь
  в офлайне, и это ровно то поведение, которое человек ожидает.

  Обратная сторона: повторные загрузки не становятся быстрее, потому что
  каждый раз идёт запрос в сеть. Для сайта на четыре страницы это
  незначительно, а предсказуемость дороже.
*/
const CACHE = 'zroute-s33-v1';

/*
  Минимум для первого офлайн-открытия. Добавляем поштучно и не падаем,
  если чего-то нет: install не должен срываться из-за одного файла,
  иначе service worker вообще не установится.
*/
const SHELL = [
  './',
  './index.html',
  './src/styles.css',
  './src/main.js',
  './manifest.webmanifest',
  './public/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Чистим кэши прошлых версий, чтобы они не занимали место годами.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Записи не делаем нигде, но на случай будущей админки — не вмешиваемся.
  if (request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request);

        /*
          Кладём в запас удачные ответы, включая данные из Google Таблицы:
          тогда без связи сайт покажет последнее, что видел, а не ошибку.
          Частичные и ошибочные ответы не кэшируем, чтобы не законсервировать
          страницу с ошибкой.
        */
        if (fresh && fresh.ok && fresh.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cached = await caches.match(request, { ignoreSearch: false });
        if (cached) return cached;

        // Переход по адресу без связи и без запаса — отдаём оболочку.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('Нет сети и нет сохранённой копии');
      }
    })()
  );
});
