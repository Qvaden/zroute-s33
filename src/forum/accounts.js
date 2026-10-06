/**
 * ДОСКА АККАУНТОВ — поведение.
 *
 * Разметка — в `src/pages/accounts.js`, здесь состояние, запросы и кнопки.
 * Тот же раздел, что у «Обновлений игры» и календаря: живой вкладке мало
 * вернуть строку, ей нужен свой запуск и своя остановка.
 *
 * ПОЧЕМУ СОСТОЯНИЕ ЖИВЁТ В АДРЕСЕ.
 *
 * `#/accounts?sort=talked&sold=1` — те же короткие ключи, что у ленты форума
 * (см. `feed-url.js`), по той же причине: ссылку на «что обсуждают на доске»
 * кидают в чат, а перезагрузка страницы и возврат «назад» из темы не должны
 * наказывать человека потерей выбранного вида.
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
import { renderAccounts, ACCOUNT_SORTS } from '../pages/accounts.js';
import { ACCOUNT_TAG_ID } from './rules.js';
import { CONFIG } from '../../config.js';

const DEFAULT_SORT = 'fresh';

/** @type {{sort: string, showSold: boolean, posts: any[], total: number, loading: boolean, more: boolean, error: string, ready: boolean|null}} */
const state = {
  sort: DEFAULT_SORT,
  showSold: false,
  posts: [],
  total: 0,
  loading: true,
  more: false,
  error: '',
  ready: null,
};

let host = null;
let wired = false;
/*
  Каждый уход со страницы поднимает токен, и ответ запроса, который ушёл до
  ухода, не рисует чужую вкладку: к тому моменту на экране уже другой раздел.
  Без этого шага человек, вернувшийся из темы, получал доску поверх форума.
*/
let mountToken = 0;

/** Адрес вида → состояние. Чужое значение — не ошибка, а обычный вид доски. */
function readSearch(search) {
  const params = new URLSearchParams(String(search ?? ''));
  const sort = params.get('sort');
  state.sort = ACCOUNT_SORTS.some((item) => item.id === sort) ? sort : DEFAULT_SORT;
  state.showSold = params.get('sold') === '1';
}

/** Состояние → адрес. Дефолт не пишем: «свежие, без проданных» — это #/accounts. */
function writeSearch() {
  const params = new URLSearchParams();
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.showSold) params.set('sold', '1');
  const query = params.toString();
  const hash = `#/accounts${query ? `?${query}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function paint() {
  if (!host) return;
  host.innerHTML = renderAccounts(state);
}

/**
 * Одна страница доски.
 *
 * `limit + 1` не просим: адаптер сам возвращает `total`, и «ещё» считается по
 * нему. Метку передаём ту же, что отмечена в теме, — витрина и есть лента,
 * только отфильтрованная.
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
    state.error = `Доску прочитать не удалось: ${String(err?.message ?? err)}`;
  }
  if (token !== mountToken) return;
  state.loading = false;
  paint();
}

function wire() {
  if (wired) return;
  wired = true;

  host.addEventListener('click', async (e) => {
    const t = e.target;
    if (!host?.contains(t)) return;

    const sortBtn = t.closest('[data-accounts-sort]');
    if (sortBtn) {
      const next = sortBtn.dataset.accountsSort;
      if (!ACCOUNT_SORTS.some((item) => item.id === next) || next === state.sort) return;
      state.sort = next;
      writeSearch();
      await loadPage(true);
      return;
    }

    const moreBtn = t.closest('[data-accounts-more]');
    if (moreBtn) {
      moreBtn.disabled = true;
      await loadPage(false);
    }
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
  await loadPage(true);
}

export function unmountAccounts() {
  host = null;
  mountToken++;
  state.posts = [];
  state.total = 0;
  state.more = false;
  state.error = '';
  state.ready = null;
}
