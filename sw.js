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
/*
  Версию поднимаем при изменении списка ниже И при правке любого файла из
  него: активация чистит кэши прошлых версий, и без смены версии старая
  копия стилей осталась бы лежать рядом с новой. Офлайн показывает ровно
  то, что человек видел в последний раз, — пусть тогда уже последнее.
*/
const CACHE = 'zroute-s33-v55';

/*
  Минимум для первого офлайн-открытия. Добавляем поштучно и не падаем,
  если чего-то нет: install не должен срываться из-за одного файла,
  иначе service worker вообще не установится.

  ЗА СПИСКОМ НАДО СЛЕДИТЬ, и он уже один раз разъехался: здесь лежал
  `src/styles.css`, которого сайт не грузит с версии v6, и `icon-192.png`,
  которого в репозитории нет вовсе (иконки хранятся как SVG — см. тест
  «I. Готовность к публикации»). Офлайн-копия при этом собиралась из файлов,
  не имеющих отношения к настоящей странице.

  Теперь список сверяется тестом с тем, что действительно подключено
  в index.html. Промах в имени файла обнаружится при запуске тестов,
  а не в первом самолёте без интернета.
*/
const SHELL = [
  './',
  './index.html',
  './src/styles-v8.css',
  './src/forum.css',
  './src/mobile.css',
  './src/controls.css',
  './src/refine.css',
  './src/main.js',
  './src/pages/about.js',
  './manifest.webmanifest',
  './public/icons/icon-192.svg',
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

/* ── Web Push: показать уведомление даже когда вкладка закрыта ──────── */

/*
  ТИХИЕ ЧАСЫ. Работник не видит localStorage и не может импортировать
  src/forum/quiet.js — обычный скрипт, не модуль. Поэтому имена хранилища
  зеркала, правило окна и границы минуты продублированы здесь; совпадение
  имён и поведение на контрольных случаях сторожит тест («прогоняют и тест
  страницы, и тест сервисного работника»).

  Держит окно фронт (quiet.js:saveQuietWindow), сюда оно попадает через
  IndexedDB. Ошибка любая — показываем: тишину, которую нельзя объяснить,
  человек замечает позже, чем шум. Промолчанный пуш не откладывается и не
  досылается — строка уведомления всё это время лежит в ленте колокольчика.
*/
const QUIET_DB = 'zr33-quiet-hours';
const QUIET_STORE = 'hours';
const QUIET_KEY = 'me';
const QUIET_MINUTES_MAX = 1439;

function readQuietWindow() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(QUIET_DB, 1);
      req.onupgradeneeded = () => {
        // Работник может прийти раньше фронта: пустое хранилище — не окно.
        if (req.result && !req.result.objectStoreNames.contains(QUIET_STORE)) {
          req.result.createObjectStore(QUIET_STORE);
        }
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const db = req.result;
          const get = db.transaction(QUIET_STORE, 'readonly').objectStore(QUIET_STORE).get(QUIET_KEY);
          get.onsuccess = () => { db.close(); resolve(get.result || null); };
          get.onerror = () => { db.close(); resolve(null); };
        } catch {
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

function quietMutesPush(win, now) {
  const s = win && win.start;
  const e = win && win.end;
  const ok = (v) => Number.isInteger(v) && v >= 0 && v <= QUIET_MINUTES_MAX;
  if (!ok(s) || !ok(e) || s === e) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return s < e ? (m >= s && m < e) : (m >= s || m < e);
}

self.addEventListener('push', (event) => {
  let data = { title: 'Сервер 33', body: '' };
  try {
    data = Object.assign(data, event.data?.json?.());
  } catch {
    try { data.body = String(event.data?.text?.() ?? ''); } catch { /* ignore */ }
  }
  event.waitUntil(
    (async () => {
      if (quietMutesPush(await readQuietWindow(), new Date())) return;
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: './public/icons/icon-192.svg',
        badge: './public/icons/icon-32.svg',
        data: data,
        tag: data.tag || undefined,
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url?.includes?.(self.location.origin)) {
          return client.focus();
        }
      }
      return self.clients.openWindow(self.location.origin);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Записи не делаем нигде, но на случай будущей админки — не вмешиваемся.
  if (request.method !== 'GET') return;

  /*
    ПАНЕЛЬ И БАЗА ПРОХОДЯТ МИМО КЭША ЦЕЛИКОМ.

    Для сайта устаревшая копия — небольшая неприятность. Для панели это
    прямой путь к потере данных: редактор открывает закэшированную версию,
    видит прошлую неделю, вносит правку и публикует её поверх чужой,
    ничего не заметив. Свежесть здесь дороже офлайна, которого панели
    и не нужно — без сети она всё равно ничего не может.

    Запросы к базе тоже не кэшируем. Причина та же, что была у api.github.com:
    в них уходит токен вошедшего человека, и общий кэш браузера — не место
    для ответов, полученных под чужой учётной записью. Плюс лента, показанная
    из кэша, выглядела бы как «новых постов нет».
  */
  const url = new URL(request.url);
  if (url.hostname === 'api.github.com') return;
  if (url.hostname.endsWith('.supabase.co')) return;
  if (url.origin === self.location.origin && /(^|\/)admin(\.html)?$|\/src\/admin\//.test(url.pathname)) return;

  // Счётчик посещений (GoatCounter): каждый заход даёт свою строку запроса,
  // повторно из кэша её всё равно не отдать — только копится мусор в запасе.
  if (url.hostname === 'gc.zgo.at' || url.hostname.endsWith('.goatcounter.com')) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });

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
