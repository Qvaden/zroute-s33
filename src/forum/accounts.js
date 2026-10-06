/**
 * ДОСКА АККАУНТОВ — поведение.
 *
 * Разметка — в `src/pages/accounts.js`, здесь состояние, запросы и кнопки.
 * Тот же раздел, что у «Обновлений игры», календаря и гайдов: живой вкладке
 * мало вернуть строку, ей нужен свой запуск и своя остановка.
 *
 * ПОЧЕМУ СОСТОЯНИЕ ЖИВЁТ В АДРЕСЕ.
 *
 * `#/accounts?sort=talked&sold=1&q=40` — те же короткие ключи, что у ленты
 * форума (см. `feed-url.js`), по той же причине: ссылку на «что обсуждают на
 * доске» кидают в чат, а перезагрузка страницы и возврат «назад» из темы не
 * должны наказывать человека потерей выбранного вида. Открытую форму в адрес
 * не пишем: `new=accounts` здесь только для прихода по старой ссылке (см.
 * main.js), а правка живёт состоянием — ссылаться на «мой черновик правки»
 * некому, и через минуту она была бы уже неактуальной.
 *
 * ПОЧЕМУ ПРОДАННЫЕ РЕЖУТСЯ ЗДЕСЬ, А НЕ В БАЗЕ.
 *
 * Колонка `account_sold_at` есть у строки, и фильтр «только висящие» база
 * принять могла бы — но ради этого пришлось бы заводить ещё один параметр
 * запроса и ещё одну миграцию, а проданных объявлений на доске будет единицы.
 * Цена решения — число в заголовке говорит про экран, а не про всю базу, и
 * страница честно показывает «Показать ещё», пока лента не кончилась.
 */
import { forum } from './index.js';
import { renderAccounts, ACCOUNT_SORTS, ACCOUNT_CATEGORY } from '../pages/accounts.js';
import { ACCOUNT_TAG_ID, validatePost } from './rules.js';
import { attachImage } from './profile.js';
import { textOf } from './format.js';
import { editorFor, applyFormat, wireRichEditor } from './editor.js';
import { siteServer } from '../data/server.js';
import { esc } from '../ui/helpers.js';
import { CONFIG } from '../../config.js';

const DEFAULT_SORT = 'fresh';

/**
 * Поля, которые переживают перерисовку.
 *
 * Краска списка — это `host.innerHTML`, и без сохранения она стирала бы
 * набранный текст объявления и каретку в поиске ровно в тот момент, когда
 * человек их заполняет. Тот же приём, что у вкладки гайдов.
 */
const KEPT = [
  'input[name="q"]',
  'input[name="title"]',
  'input[name="account_price"]',
  'textarea[name="account_offer"]',
  'select[name="expires_in"]',
  '[data-editor]',
];

/** @type {{sort: string, showSold: boolean, query: string, posts: any[], total: number, loading: boolean, more: boolean, error: string, ready: boolean|null, me: any, composing: boolean, editing: any}} */
const state = {
  sort: DEFAULT_SORT,
  showSold: false,
  query: '',
  posts: [],
  total: 0,
  loading: true,
  more: false,
  error: '',
  ready: null,
  me: null,
  composing: false,
  editing: null,
};

let host = null;
let wired = false;
/*
  Каждый уход со страницы поднимает токен, и ответ запроса, который ушёл до
  ухода, не рисует чужую вкладку: к тому моменту на экране уже другой раздел.
  Без этого шага человек, вернувшийся из темы, получал доску поверх форума.
*/
let mountToken = 0;
let searchTimer = 0;

/** Адрес вида → состояние. Чужое значение — не ошибка, а обычный вид доски. */
function readSearch(search) {
  const params = new URLSearchParams(String(search ?? ''));
  const sort = params.get('sort');
  state.sort = ACCOUNT_SORTS.some((item) => item.id === sort) ? sort : DEFAULT_SORT;
  state.showSold = params.get('sold') === '1';
  state.query = (params.get('q') ?? '').trim();
}

/** Состояние → адрес. Дефолт не пишем: «свежие, без проданных» — это #/accounts. */
function writeSearch() {
  const params = new URLSearchParams();
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.showSold) params.set('sold', '1');
  if (state.query) params.set('q', state.query);
  const query = params.toString();
  const hash = `#/accounts${query ? `?${query}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function paint() {
  if (!host) return;

  const prev = [];
  for (const sel of KEPT) {
    for (const el of host.querySelectorAll(sel)) {
      const value = sel === '[data-editor]' ? el.innerHTML : el.value;
      if (value) prev.push({ sel, value });
    }
  }
  const active = document.activeElement;
  const activeSel = active && host.contains(active)
    ? KEPT.find((sel) => active.matches(sel))
    : null;

  host.innerHTML = renderAccounts(state);

  for (const { sel, value } of prev) {
    const el = sel === '[data-editor]'
      ? host.querySelector('[data-editor]')
      : host.querySelector(sel);
    if (!el) continue;
    if (sel === '[data-editor]') { if (!textOf(el.innerHTML)) el.innerHTML = value; continue; }
    if (!el.value) el.value = value;
  }
  if (activeSel) {
    const el = activeSel === '[data-editor]' ? host.querySelector(activeSel) : host.querySelector(activeSel);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof el.setSelectionRange === 'function' && el.value) {
        try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* select без каретки */ }
      }
    }
  }
  paintShots();
}

/**
 * Одна страница доски.
 *
 * `limit + 1` не просим: адаптер сам возвращает `total`, и «ещё» считается по
 * нему. Метку передаём ту же, что отмечена в теме, — витрина и есть лента,
 * только отфильтрованная. Поиск — общий с лентой (`q`), поэтому он находит и
 * то, что ещё не приехало на экран.
 */
async function loadPage(reset) {
  const token = mountToken;
  const limit = CONFIG.forum.pageSize;
  const offset = reset ? 0 : state.posts.length;
  state.loading = true;
  paint();
  try {
    const { posts, total } = await forum.listPosts({
      tag: ACCOUNT_TAG_ID,
      sort: state.sort,
      q: state.query,
      limit,
      offset,
    });
    if (token !== mountToken) return;
    state.posts = reset ? posts : [...state.posts, ...posts];
    state.total = Number(total) || state.posts.length;
    state.more = state.posts.length < state.total;
    state.error = '';
  } catch (err) {
    if (token !== mountToken) return;
    state.error = `Доску прочитать не удалось: ${String(err?.message ?? err)}
Если база ещё не обновлена, прогоните supabase/applied/20261006-account-board.sql.`.trim();
  }
  if (token !== mountToken) return;
  state.loading = false;
  paint();
}

/** Сообщение об отказе — в строку формы, а не в общий error списка. */
function showFormError(message) {
  const box = host?.querySelector('[data-accounts-error]');
  if (box) { box.textContent = message; box.hidden = false; }
}

/* ── Скриншоты к объявлению ───────────────────────────────────────────────── */

/*
  Предел один на проект и повторён триггером базы
  (supabase/applied/profiles.sql): браузер предупреждает заранее, база охраняет
  от запросов мимо сайта. Второй цифры для доски не заводят — вложения лежат в
  той же таблице и под тем же `target_type='post'`, что у темы и комментария,
  потому что объявление и есть тема.
*/
const MAX_SHOTS = CONFIG.forum.limits.attachmentsMax;

/*
  Выбранные файлы живут вне состояния и вне разметки: ссылка на Blob есть только
  в памяти браузера, в строку она не превращается и в черновик не попадёт.
  Ключ — область формы ('ad' при создании, `ad:<id>` при правке), иначе
  картинки, выбранные для одного объявления, молча переехали бы в форму другого
  и уехали не туда.
*/
const pendingShots = new Map();

/** Область, которой сейчас принадлежит форма. */
function shotScope() {
  return state.editing ? `ad:${state.editing.id}` : 'ad';
}

/*
  Узлы ищем перебором по data-атрибуту, а не селектором вида
  `[data-attach-list="ad:p_1"]`: идентификатор приходит из базы, и собирать из
  него строку запроса — значит ловить исключение на первом же странном символе
  (тот же приём, что у страницы гайдов).

  Значение читаем через getAttribute, а не через `dataset[имя]`: ключи dataset —
  верблюжьи, `dataset['attach-list']` всегда пустой, и поиск молча возвращал бы
  null. Тогда превью выбранной картинки не появилось бы вообще, без единого
  сообщения об ошибке.
*/
function shotNode(attr, scope) {
  for (const el of host?.querySelectorAll(`[${attr}]`) ?? []) {
    if (el.getAttribute(attr) === scope) return el;
  }
  return null;
}

function shotError(message) {
  const box = shotNode('data-attach-error', shotScope());
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

/**
 * Превью выбранных картинок.
 *
 * Дорисовываются ПОСЛЕ перерисовки, а не собираются в строку разметки: ссылка
 * на Blob живёт в памяти, и в `innerHTML` формы её не положить.
 */
function paintShots() {
  if (!host) return;
  for (const [scope, files] of pendingShots) {
    const list = shotNode('data-attach-list', scope);
    if (!list) continue;
    list.innerHTML = files
      .map((f, i) => `<div class="forum-attach__item">
        <img src="${f.preview}" alt="">
        <button type="button" class="forum-attach__drop"
                data-attach-drop="${esc(scope)}:${i}" title="Убрать">✕</button>
      </div>`)
      .join('');
  }
}

/** Сколько картинок уже приложено к объявлению: комнату под новые считаем от общего предела. */
function existingShots() {
  const id = state.editing?.id;
  if (!id) return 0;
  return state.posts.find((p) => p.id === id)?.attachments?.length ?? 0;
}

function addShots(files) {
  const scope = shotScope();
  const current = pendingShots.get(scope) ?? [];
  const room = MAX_SHOTS - existingShots() - current.length;

  if (room <= 0) {
    shotError(`К объявлению можно приложить не больше ${MAX_SHOTS} картинок`);
    return;
  }

  const taken = [...files].slice(0, room);
  let rejected = '';
  for (const file of taken) {
    if (!String(file.type).startsWith('image/')) {
      rejected = `«${file.name}» не картинка`;
      continue;
    }
    current.push({ file, preview: URL.createObjectURL(file) });
  }

  if (current.length) pendingShots.set(scope, current);
  /*
    Сообщения идут по важности: обрезали по пределу — говорим про предел, иначе
    — про отвергнутый файл, и только когда приняли всё снимаем прошлый отказ.
    Раньше «не картинка» ставился в цикле и стирался ниже, если в списке уже
    лежала хоть одна картинка: человек не понимал, почему файл пропал.
  */
  if (taken.length < files.length) {
    shotError(`Взято ${current.length}: к объявлению можно приложить не больше ${MAX_SHOTS} картинок`);
  } else if (rejected) {
    shotError(rejected);
  } else if (current.length) {
    shotError('');
  }

  paintShots();
}

function dropShot(scope, index) {
  const list = pendingShots.get(scope);
  if (!list?.[index]) return;
  // Ссылку на Blob освобождаем сразу: иначе браузер держит файл до перезагрузки.
  URL.revokeObjectURL(list[index].preview);
  list.splice(index, 1);
  if (list.length) pendingShots.set(scope, list);
  else pendingShots.delete(scope);
  shotError('');
  paintShots();
}

function clearShots(scope) {
  for (const item of pendingShots.get(scope) ?? []) URL.revokeObjectURL(item.preview);
  pendingShots.delete(scope);
}

function clearAllShots() {
  for (const scope of [...pendingShots.keys()]) clearShots(scope);
}

/**
 * Загрузить выбранное к уже созданной теме.
 *
 * Картинки уходят ПОСЛЕ объявления, а не до: вложение ссылается на запись,
 * значит запись должна существовать. Загрузка до публикации оставила бы в
 * хранилище файлы, на которые никто не ссылается, — брошенную форму чистить
 * было бы нечем.
 *
 * Неудача одной картинки не отменяет публикацию: тема уже написана и видна
 * другим, и терять её из-за третьего скриншота нельзя. О возвращённых ссылках
 * просим не ради красоты — карточка обязана показать свой скриншот сразу, без
 * перечитывания доски.
 *
 * @returns {Promise<{error: string, added: {id: string, url: string}[]}>}
 */
async function uploadShots(scope, targetId, onProgress) {
  const list = pendingShots.get(scope) ?? [];
  if (!list.length) return { error: '', added: [] };

  /*
    В локальном режиме файла некуда положить: хранилища нет. Отказ должен
    говорить про режим, а не про вход: `attachImage` в черновом режиме ответил
    бы «Сначала войдите» человеку, который только что вошёл в черновой профиль,
    и это была бы ложь вместо объяснения.
  */
  if (CONFIG.forum.source !== 'supabase') {
    clearShots(scope);
    return { error: 'Картинки не приложены: в локальном режиме хранилища нет. Объявление опубликовано без скриншотов.', added: [] };
  }

  const failed = [];
  const added = [];
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i + 1, list.length);
    try {
      const shot = await attachImage('post', targetId, list[i].file);
      if (shot?.url) added.push({ id: shot.id, url: shot.url });
    } catch (err) {
      failed.push(String(err?.message ?? err));
    }
  }
  clearShots(scope);
  return { error: failed.length ? `Не загрузились картинки: ${failed[0]}` : '', added };
}

/**
 * Тело темы из ящика объявления.
 *
 * Комментарий необязателен: пустой означает «опиши один раз». Тогда текстом
 * темы уходит строка состава — та уже прошла проверку длины в форме и в базе,
 * а человек не обязан печатать одно и то же дважды.
 */
function bodyFromForm(form) {
  const editor = form.querySelector('[data-editor]');
  const comment = editor ? editor.innerHTML : '';
  return textOf(comment) ? comment : String(form.account_offer?.value ?? '');
}

/** Собранное состояние формы: то же уходит и при создании, и при правке. */
function readForm(form) {
  const days = Number(form.expires_in?.value ?? 0);
  return {
    title: String(form.title?.value ?? ''),
    offer: String(form.account_offer?.value ?? ''),
    price: String(form.account_price?.value ?? ''),
    body: bodyFromForm(form),
    expiresAt: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
  };
}

/** Строка объявления в том виде, в котором её хочет видеть форма правки. */
function editSeed(post) {
  return {
    id: post.id,
    title: post.title,
    offer: post.accountOffer || '',
    price: post.accountPrice || '',
  };
}

async function submitForm(form, submitter) {
  const editing = state.editing;
  const value = readForm(form);
  /*
    Проверка та же функция, что у композера форума: заголовок и тело правит
    одна реализация, и форма доски не может стать местом, где проходит то, что
    отвергла бы лента. Строки доски местной проверки не имеют нарочно — их
    держат проверка таблицы и триггер, и их текст человек должен читать целиком.
  */
  const checked = validatePost({ title: value.title, body: value.body, category: ACCOUNT_CATEGORY });
  if (!checked.ok) return showFormError(checked.error);

  if (submitter) submitter.disabled = true;
  try {
    if (editing) {
      const updated = await forum.updateAccountAd(editing.id, {
        title: checked.value.title,
        offer: value.offer,
        price: value.price,
        expiresAt: value.expiresAt,
      });
      /*
        Скриншоты — следом за правкой, в область `ad:<id>`: поле выбора
        картинок было видно всё это время, и человек ждёт, что его файлы уедут
        вместе с составом и ценой.
      */
      const shots = await uploadShots(`ad:${editing.id}`, editing.id, (i, n) => {
        if (submitter) submitter.textContent = `Картинка ${i}/${n}…`;
      });
      const i = state.posts.findIndex((p) => p.id === editing.id);
      if (i >= 0 && updated) {
        state.posts[i] = { ...updated, attachments: [...(updated.attachments ?? []), ...shots.added] };
      }
      state.editing = null;
      state.composing = false;
      state.error = shots.error;
    } else {
      const draft = {
        ...checked.value,
        tags: [ACCOUNT_TAG_ID],
        expiresAt: value.expiresAt,
        accountOffer: value.offer,
        accountPrice: value.price,
      };
      /*
        Тема принадлежит серверу сайта — другому серверу лента этого форума не
        показывает. Номер ставится только когда он назван: без колонки база
        отвергла бы тему целиком (см. тот же шаг в mount.js).
      */
      const server = siteServer();
      if (server != null) draft.serverId = server;
      const created = await forum.createPost(draft);
      if (created) {
        const shots = await uploadShots('ad', created.id, (i, n) => {
          if (submitter) submitter.textContent = `Картинка ${i}/${n}…`;
        });
        state.posts = [{ ...created, attachments: [...(created.attachments ?? []), ...shots.added] }, ...state.posts];
        /*
          Список не перечитывается — объявление уже в руках, и второй запрос
          ради одного слова был бы платным дважды. Но «на доске» берётся из
          `total` адаптера, и без шага здесь она показала бы 0 при одном
          видимом объявлении: число в шапке стало бы меньше экрана.
        */
        state.total += 1;
        state.error = shots.error;
      }
      state.composing = false;
    }
    paint();
  } catch (err) {
    showFormError(String(err?.message ?? err));
    if (submitter) submitter.disabled = false;
  }
}

function wire() {
  if (wired) return;
  wired = true;

  wireRichEditor(() => host);

  host.addEventListener('click', async (e) => {
    const t = e.target;
    if (!host?.contains(t)) return;

    /* Панель формата объявления — тот же механизм, что у форума и гайдов. */
    const cmdBtn = t.closest?.('[data-editor-cmd]');
    if (cmdBtn) {
      const editor = editorFor(cmdBtn);
      if (editor) applyFormat(editor, cmdBtn.dataset.editorCmd, cmdBtn.dataset.editorValue);
      return;
    }
    const colorBtn = t.closest?.('[data-editor-color]');
    if (colorBtn) {
      const editor = editorFor(colorBtn);
      if (editor) applyFormat(editor, 'color', colorBtn.dataset.editorColor || 'inherit');
      return;
    }

    const dropBtn = t.closest?.('[data-attach-drop]');
    if (dropBtn) {
      /*
        Индекс всегда последний сегмент, а область может содержать двоеточие
        (`ad:p_12`), поэтому режем по ПОСЛЕДНЕМУ двоеточию, а не по первому.
      */
      const raw = dropBtn.dataset.attachDrop;
      const sep = raw.lastIndexOf(':');
      dropShot(raw.slice(0, sep), Number(raw.slice(sep + 1)));
      return;
    }

    const newBtn = t.closest?.('[data-accounts-new]');
    if (newBtn) {
      state.composing = true;
      state.editing = null;
      paint();
      host.querySelector('[data-accounts-form] input[name="title"]')?.focus({ preventScroll: true });
      return;
    }

    const cancelBtn = t.closest?.('[data-accounts-cancel]');
    if (cancelBtn) {
      state.composing = false;
      state.editing = null;
      paint();
      return;
    }

    const sortBtn = t.closest?.('[data-accounts-sort]');
    if (sortBtn) {
      const next = sortBtn.dataset.accountsSort;
      if (!ACCOUNT_SORTS.some((item) => item.id === next) || next === state.sort) return;
      state.sort = next;
      writeSearch();
      await loadPage(true);
      return;
    }

    const editBtn = t.closest?.('[data-accounts-edit]');
    if (editBtn) {
      const post = state.posts.find((p) => p.id === editBtn.dataset.accountsEdit);
      if (!post) return;
      state.editing = editSeed(post);
      state.composing = true;
      paint();
      return;
    }

    /*
      Продано — или вернули на доску. Отметка живёт у темы, поэтому право на неё
      решает RLS темы, а тема остаётся с ответами: под объявлением могли
      торговаться другие.
    */
    const closeBtn = t.closest?.('[data-accounts-close]');
    if (closeBtn) {
      const id = closeBtn.dataset.accountsClose;
      const sold = closeBtn.dataset.accountsSold === '1';
      closeBtn.disabled = true;
      try {
        const updated = await forum.closeAccountOffer(id, sold);
        if (updated) {
          const i = state.posts.findIndex((p) => p.id === id);
          if (i >= 0) state.posts[i] = updated;
        }
        paint();
      } catch (err) {
        state.error = `Отметку снять не удалось: ${String(err?.message ?? err)}`;
        paint();
      }
      return;
    }

    const moreBtn = t.closest?.('[data-accounts-more]');
    if (moreBtn) {
      moreBtn.disabled = true;
      await loadPage(false);
    }
  });

  host.addEventListener('submit', (e) => {
    const form = e.target?.closest?.('[data-accounts-form]');
    if (!form || !host?.contains(form)) return;
    e.preventDefault();
    const box = form.querySelector('[data-accounts-error]');
    if (box) { box.textContent = ''; box.hidden = true; }
    submitForm(form, form.querySelector('[data-accounts-submit]'));
  });

  /*
    Файлы приходят событием change, а не click: поле выбора картинки отдаёт их
    только так. Область проверяем на принадлежность доске: тот же атрибут стоит
    в композере темы и в форме гайда, а слушатель висит на этой вкладке —
    чужие поля трогать незачем.
  */
  host.addEventListener('change', (e) => {
    const input = e.target?.closest?.('[data-attach-input]');
    if (!input || !host?.contains(input)) return;
    addShots(input.files ?? []);
    /*
      Поле очищаем: иначе второй выбор тех же файлов не дал бы события, и
      человек решил бы, что кнопка сломалась.
    */
    input.value = '';
  });

  /*
    Галочка «показывать проданные» ничего не запрашивает: объявление уже лежит
    в прочитанной странице, и прятать его или показывать — решение вида, а не
    данных. Перезапрос стоил бы человеку прокрутки и секунды ради одного
    переключателя.
  */
  host.addEventListener('change', (e) => {
    const box = e.target?.closest?.('input[name="show_sold"]');
    if (!box || !host?.contains(box)) return;
    state.showSold = box.checked;
    writeSearch();
    paint();
  });

  /*
    Поиск перезапрашивает доску, поэтому не мгновенно: на каждый символ
    ходить в базу — значит то и дело показывать список наполовину набранного
    слова. Пауза в полсекунды та же, что у поиска форума.
  */
  host.addEventListener('input', (e) => {
    const input = e.target?.closest?.('input[name="q"]');
    if (!input || !host?.contains(input)) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const next = String(input.value ?? '').trim();
      if (next === state.query) return;
      state.query = next;
      writeSearch();
      loadPage(true);
    }, 500);
  });
}

export async function mountAccounts(container, search = '') {
  host = container;
  mountToken++;
  readSearch(search);
  state.posts = [];
  state.total = 0;
  state.more = false;
  state.error = '';
  state.loading = true;
  state.composing = false;
  state.editing = null;
  paint();
  wire();

  try {
    state.ready = await forum.isReady();
  } catch {
    state.ready = false;
  }
  if (!state.ready) {
    state.loading = false;
    state.error = 'Форум ещё не подключён — доски с объявлениями нет.';
    paint();
    return;
  }

  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }

  /*
    Намерение «создать объявление» приходит из адреса: старый ссылочный путь
    `#/forum?new=accounts` главный модуль перенаправляет сюда, и человек,
    кинувший в чат эту ссылку месяц назад, должен попасть в открытую форму, а
    не в ленту. Раскрываем её только вошедшему и снимаем ключ из адреса, чтобы
    перезагрузка не открывала ящик заново.
  */
  const intent = new URLSearchParams(String(search ?? '')).get('new');
  if (intent === 'accounts' && state.me) {
    state.composing = true;
    history.replaceState(null, '', location.hash.replace(/[?&]new=accounts/, '').replace(/\?$/, ''));
  }

  await loadPage(true);
  if (state.composing) {
    host.querySelector('[data-accounts-form] input[name="title"]')?.focus({ preventScroll: true });
  }
}

export function unmountAccounts() {
  host = null;
  mountToken++;
  clearTimeout(searchTimer);
  /*
    Ссылки на выбранные картинки освобождаем обязательно: иначе браузер держит
    файлы в памяти до перезагрузки, а на телефоне это несколько мегабайт за
    каждую брошенную форму.
  */
  clearAllShots();
  state.posts = [];
  state.total = 0;
  state.more = false;
  state.error = '';
  state.ready = null;
  state.me = null;
  state.composing = false;
  state.editing = null;
}
