/**
 * ПЕРЕКЛЮЧАТЕЛЬ СЕРВЕРА В ШАПКЕ САЙТА.
 *
 * Мультиаренда началась с форума: там ряд серверов стоит над лентой. С этого
 * шага выбор один на весь сайт — тот же номер у данных рейтинга, и переключать
 * его надо не внутри одной страницы, а там, где человек видит, каким сервером
 * он вообще ходит: в шапке.
 *
 * ПОЧЕМУ ОДИН РЯД НА ВЕСЬ САЙТ, А НЕ ПО СТРАНИЦЕ. Раздать страницы своими
 * переключателями — получить девять копий одного состояния и девять поводов им
 * разойтись. Ряд один, живёт в разметке страницы, а показывается только там,
 * где данные действительно меняются от выбора.
 *
 * ГДЕ ЕГО НЕТ, И ПОЧЕМУ.
 *   На форуме — не показываем: у ленты свой ряд над фильтрами, и два
 *   переключателя на одном экране спорили бы, кто главный.
 *   На страницах, которым перечитывать нечего: справочник и правила — текст
 *   игры, «Бот» и «О проекте» — про сайт, а не про сервер.
 *   Пока серверов в базе меньше двух, ряда нет вовсе: над одним набором
 *   переключатель — шум, а не выбор.
 *
 * ПОЧЕМУ МОЛЧИТ, КОГДА БАЗА НЕ ОТВЕТИЛА. Список серверов живёт в базе, и до её
 * ответа ряду неоткуда взяться. Это не пустой экран с кнопкой «никуда»:
 * человек читает сервер сайта, как читал до мультиаренды.
 */
import { forum } from '../forum/index.js';
import { siteServer, viewServer } from '../data/server.js';
import {
  putServerParam, serverInRange, writeServerChoice, serverTabTitle,
} from '../logic/server-choice.js';
import { esc } from './helpers.js';

const BASE_TITLE = document.title;

/*
  Страницы, которые перечитывают данные по выбору сервера. Живые разделы (чаты,
  календарь, гайды, обновления, форум) ходят в другую таблицу — в посты, — и
  ряд над ними обещал бы то, чего не делает.
*/
const DATA_PAGES = new Set(['home', 'quarter', 'ladder', 'timeline', 'guide', 'alliance']);

/** @type {Array<{id: number, title: string, enabled?: boolean}>} */
let servers = [];
let loaded = false;

/**
 * Список серверов базы — один запрос на страницу.
 *
 * Отказ проглочен в пустой список: таблица появилась вместе с миграцией, и у
 * сайта, который её ещё не прогнал, ряда просто нет. Повторной попытки не
 * делаем: ради строки в шапке не принято перезапрашивать базу при каждой
 * перерисовке.
 */
export async function loadServerSwitch() {
  if (typeof forum.listServers !== 'function') return;
  const rows = await Promise.resolve(forum.listServers()).catch(() => []);
  servers = Array.isArray(rows) ? rows : [];
  loaded = true;
  paint();
}

/** Ряд перерисован по текущему адресу и выбору. Зовёт main.js после отрисовки. */
export function syncServerSwitch() {
  if (loaded) paint();
}

/** Раздел по текущему адресу: `#/ladder?server=44` → `ladder`. */
function pageId() {
  return String(location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/')[0];
}

/**
 * Адрес этой же страницы с названным сервером: `#/ladder?server=44`.
 *
 * Дефолт в адрес не пишем — тем же правилом, что и на форуме: ссылка на свой
 * сервер не должна выглядеть как ссылка на выбранный. Остальные параметры
 * адреса остаются: здесь их пока нет, но адрес страницы — общее достояние, и
 * выкинуть чужой ключ из-за одного ряда значило бы сломать чужую ссылку.
 *
 * Путь берём целиком, а не только раздел: карточка альянса живёт по адресу
 * `#/alliance/404`, и ряд, который сохранил бы от неё слово «alliance»,
 * выбросил бы человека из карточки обратно в пустую страницу.
 */
function addressFor(server) {
  const path = String(location.hash || '').replace(/^#/, '').split('?')[0];
  const search = String(location.hash || '').split('?')[1] || '';
  const params = new URLSearchParams(search);
  putServerParam(params, server, siteServer());
  const query = params.toString().replace(/\+/g, '%20');
  return `#/${path.replace(/^\//, '')}${query ? `?${query}` : ''}`;
}

function paint() {
  const box = document.getElementById('server-switch');
  if (!box) return;

  const dataPage = DATA_PAGES.has(pageId());
  const show = dataPage && servers.length > 1;
  box.hidden = !show;

  if (!show) {
    box.innerHTML = '';
    /*
      Заголовок вкладки ряд трогает только на своих страницах: на форуме его
      ведёт лента, и вернуть название сайта из шапки значило бы стирать подпись
      сервера при каждой перерисовке форума.
    */
    if (dataPage) applyTitle(null);
    return;
  }

  const current = viewServer();
  box.innerHTML = `<div class="server-switch__inner">
    <span class="server-switch__label">Сервер</span>
    <div class="seg seg--server" role="group" aria-label="Игровой сервер">
      ${servers.map((srv) => {
        const on = Number(current) === Number(srv.id);
        return `<button type="button" class="seg__btn${on ? ' is-on' : ''}"
                data-site-server="${esc(srv.id)}" aria-pressed="${on ? 'true' : 'false'}"
                title="${esc(srv.title)}${srv.enabled === false ? ' — приём тем закрыт' : ''}">${esc(srv.title)}</button>`;
      }).join('')}
    </div>
  </div>`;
  applyTitle(servers.find((srv) => Number(srv.id) === Number(current))?.title);
}

/*
  Заголовок вкладки говорит, чей сервер открыт: он единственный, что видно при
  десяти открытых вкладках. Меняется только ведущая метка («Сервер 33»),
  название сайта остаётся как есть — правило живёт в serverTabTitle.
*/
function applyTitle(title) {
  document.title = serverTabTitle(BASE_TITLE, title);
}

/*
  Клик по ряду: выбор в память браузера и в адрес. Адрес важнее памяти — и сам
  факт, что он перезаписан, значит, что кинутая в чат ссылка откроет собеседнику
  ровно тот сервер, что видит тот, кто её дал.

  Адрес меняем через replaceState, а не через location.hash: смена хэша подняла
  бы hashchange, страница пересобралась бы заново, а данные попросились бы
  вторично, не дождавшись ответа первого запроса.
*/
document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-site-server]');
  if (!button) return;
  const server = serverInRange(button.dataset.siteServer);
  if (server == null || server === viewServer()) return;

  writeServerChoice(server);
  const hash = addressFor(server);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  paint();
  window.dispatchEvent(new CustomEvent('zr33:server-change', { detail: { server } }));
});
