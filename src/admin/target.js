/**
 * КАКОЙ СЕРВЕР ПАНЕЛЬ ПРАВИТ.
 *
 * До этого шага ответ давал `config.js`: панель читала и писала ровно тот
 * сервер, что в строке `server: 33`, и для одного сайта этого хватало.
 * Мультиаренда сделала вопрос живым: у модератора 44-го панель обязана править
 * 44-й, а у владельца — тот сервер, который он сам себе выбрал.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А ПОЛЕ В CONFIG.
 *   Число нужно четырём местам: чтению набора, каждой записи в `store.js`,
 *   путям фотографий и ключам черновиков. Разойдись они — панель начала бы
 *   показывать строки одного сервера, а сохранять их в другой, и глазами это не
 *   различить: интерфейс тот же, цифры те же, чужая история портится молча.
 *   Поэтому цель спрашивают у одного места, и там же она проверяется на право.
 *
 * ПОЧЕМУ ЦЕЛЬ НЕ СЛЕДУЕТ ЗА РЯДОМ В ШАПКЕ САЙТА.
 *   Ряд в шапке — выбор зрителя: он меняется щелчком и живёт, пока его не
 *   перещёлкнули. У цели панели цена ошибки другая. Умей она брать тот же
 *   номер — ссылка, брошенная в чат («смотри, что у нас на 44-м»), открытая
 *   редактором, молча перенаправила бы его правку в чужой набор, а следующий
 *   «Опубликовать» ушёл бы туда же. Поэтому у панели своя память
 *   (`zr33.admin.server`), свой ряд выбора и список серверов, где право есть:
 *   цель меняется только руками редактора и только на разрешённое.
 *
 * ПОРЯДОК ВЫБОРА.
 *   Память, если она называет разрешённый сервер; затем сервер сайта, если он
 *   разрешён; затем любой разрешённый. Второй член нужен владельцу: он правит
 *   все серверы, и панель по умолчанию обязана открываться на том же наборе,
 *   что и до мультиаренды, — иначе первый же вход после пуша привёл бы его в
 *   чужую историю.
 *
 * ПРАВА ЗДЕСЬ НЕТ. Право держит база
 *   (`supabase/20261005-site-server-rights.sql`), а панель читает карту
 *   `forum_my_server_roles()`, чтобы человек не заполнял неделю сервера, куда
 *   его не пустят. Отказ базы всё равно был бы точнее — но после работы, а не
 *   до неё.
 */
import { siteServer } from '../data/server.js';

const KEY = 'zr33.admin.server';

/** Роль вошедшего в каждом сервере: карта `forum_my_server_roles()` или null. */
let roles = null;

/** Сервер, цель панели. null — значит права ещё не прочитаны. */
let target = null;

/** Подписи серверов из `listServers()` — нужны ряду выбора. */
let titles = {};

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null || raw === '' || raw === 'null') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStored(server) {
  try {
    localStorage.setItem(KEY, String(server));
  } catch {
    /* Память недоступна — приватный режим. Цель проживёт до перезагрузки вкладки. */
  }
}

function isSiteStaff(account) {
  return Boolean(account) && (account.role === 'admin' || account.role === 'moderator');
}

function titleOf(id) {
  return titles[id] || `Сервер ${id}`;
}

/**
 * Есть ли у вошедшего право на этот сервер.
 *
 * `roles === null` означает «карты прав нет» — панель ведёт себя как до шага:
 * право ровно там, где оно было, у модерации сайта и только на сервер сайта.
 * Пустая карта — это «нигде», и путать её с «не проверяли» нельзя: на пустой
 * карте панель закрыта, на null — открыта владельцу.
 *
 * Забаненный не правит ничьим сервером, даже когда карта называет его
 * модератором: карта отвечает по списку участия, а бан смотрит база.
 */
export function canEditServer(server, account) {
  if (!Number.isInteger(server) || !account || account.banned) return false;
  if (roles === null) return isSiteStaff(account) && server === siteServer();
  return roles[String(server)] === 'moderator';
}

/**
 * Чем панель может править: список для ряда выбора и для отказа на входе.
 *
 * Берётся из карты ролей целиком, а не из сервера сайта: модератор 44-го видит
 * один ряд — 44-й, владелец видит все строки `forum_servers`, и этот же список
 * объясняет владельцу, почему рядом с «33» появились другие числа.
 */
export function writableServers(account) {
  if (!account || account.banned) return [];
  if (roles === null) {
    const only = siteServer();
    return isSiteStaff(account) && only ? [{ id: only, title: titleOf(only) }] : [];
  }
  return Object.entries(roles)
    .filter(([, role]) => role === 'moderator')
    .map(([id]) => Number(id))
    .filter((id) => Number.isInteger(id))
    .sort((a, b) => a - b)
    .map((id) => ({ id, title: titleOf(id) }));
}

/**
 * Что панель прочитала о правах. Вызывается сразу после входа, до чтения
 * данных: цель нужна, чтобы знать, какой набор читать.
 *
 * @param {{account: any, roles: Record<string, string>|null, servers?: {id: number, title: string}[]}} opts
 * @returns {number|null} выбранная цель или null, если править нечем
 */
export function adoptRights({ account, roles: map, servers = [] }) {
  roles = map && typeof map === 'object' && !Array.isArray(map) ? map : null;
  titles = {};
  for (const row of servers) {
    const id = Number(row?.id);
    if (Number.isInteger(id)) titles[id] = row.title || titles[id];
  }

  const ids = writableServers(account).map((row) => row.id);
  if (!ids.length) {
    target = null;
    return null;
  }

  const stored = readStored();
  const home = siteServer();
  if (stored !== null && ids.includes(stored)) target = stored;
  else if (home !== null && ids.includes(home)) target = home;
  else target = ids[0];

  writeStored(target);
  return target;
}

/**
 * Сервер, который панель правит. Отказ здесь — не вежливость: без номера
 * запись ушла бы в строки без `server_id`, а удаление недели по одному id
 * снесло бы её у всех серверов.
 */
export function panelServer() {
  if (target !== null) return target;
  if (siteServer() === null) {
    throw new Error(
      'В config.js не заполнен server — панель не знает, данные какого сервера ' +
        'она правит. Число стоит в строке «server: 33».'
    );
  }
  throw new Error(
    'Править данные сайта нечем: нет ни одного сервера, где у вас есть право. ' +
      'Его даёт роль модератора сервера.'
  );
}

/**
 * Явная смена цели редактором. Чужой сервер не принимается: ряд показывает
 * только разрешённое, а проверка здесь держит дверь на месте, если список
 * устарел — например право сняли, пока вкладка была открыта.
 */
export function choosePanelServer(server, account) {
  const id = Number(server);
  if (!Number.isInteger(id) || id === target) return false;
  if (!canEditServer(id, account)) return false;
  target = id;
  writeStored(id);
  return true;
}

/**
 * Подпись сервера, который панель правит, — для сообщений человеку.
 *
 * «Опубликовано» без названия набора не отвечает на единственный вопрос,
 * который у мультиаренды и возникает: куда именно ушла правка. Подпись берётся
 * здесь, а не в вызывающем коде, — тот же порядок, что у самого номера: два
 * места с одним названием однажды разойдутся.
 */
export function panelServerTitle() {
  const id = target ?? siteServer();
  return id === null ? '' : titleOf(id);
}

/**
 * Сервер для папок черновиков — тот же, что у чтений и записей.
 *
 * В отличие от `panelServer()` отказа здесь нет: черновик читают и тогда, когда
 * цель ещё не выбрана (каркас панели в превью, старая вкладка после пуша), а
 * пустая папка для человека лучше сорванной отрисовки экрана. Пока цели нет,
 * это сервер сайта — ровно тот набор, чьи черновики лежали без папки до этого
 * шага.
 */
export function draftServer() {
  return target ?? siteServer();
}

/** Право прочитано и цель выбрана — кнопки записи имеют смысл. */
export function hasTarget() {
  return target !== null;
}

/** Выход из панели: чужие права не должны пережить чужой вход. */
export function forgetRights() {
  roles = null;
  target = null;
  titles = {};
}
