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
import { textOf } from './format.js';
import { editorFor, applyFormat, wireRichEditor } from './editor.js';
import { siteServer } from '../data/server.js';
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

/** Строка объявления в виде, котором её хочет видеть форма правки. */
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
      const i = state.posts.findIndex((p) => p.id === editing.id);
      if (i >= 0 && updated) state.posts[i] = updated;
      state.editing = null;
      state.composing = false;
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
        state.posts = [created, ...state.posts];
        /*
          Список не перечитывается — объявление уже в руках, и второй запрос
          ради одного слова был бы платным дважды. Но «на доске» берётся из
          `total` адаптера, и без шага здесь она показала бы 0 при одном
          видимом объявлении: число в шапке стало бы меньше экрана.
        */
        state.total += 1;
      }
      state.composing = false;
    }
    state.error = '';
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
  state.posts = [];
  state.total = 0;
  state.more = false;
  state.error = '';
  state.ready = null;
  state.me = null;
  state.composing = false;
  state.editing = null;
}
