/**
 * АДМИН-ПАНЕЛЬ.
 *
 * Отдельная точка входа, а не раздел сайта. Причины две: посетитель не должен
 * грузить код панели, и попасть в неё случайно из меню тоже не должен.
 *
 * ПОЧЕМУ У КАЖДОГО ИМПОРТА СТОИТ ?v=N.
 *
 * GitHub Pages отдаёт файлы с указанием «хранить десять минут», и браузер
 * слушается: обновление страницы, даже с Ctrl+Shift+R, перезапрашивает
 * саму страницу и main.js, но вложенные модули берёт из кэша.
 *
 * Это уже стоило одной поломки. Обзор переписали под базу, main.js обновился,
 * а screens/overview.js остался прежним — тот, что читал поля репозитория.
 * Панель падала с «Cannot read properties of undefined (reading fullName)»
 * на исправленном коде, и понять это было нельзя: файл на диске правильный.
 *
 * Номер в адресе делает файл другим файлом для кэша. Поднимать его надо
 * ВМЕСТЕ с версией в admin.html — иначе смысл теряется: страница придёт
 * свежая, а модули старые.
 *
 * ТРИ ПРАВИЛА ПУБЛИКАЦИИ, которые здесь соблюдаются буквально:
 *
 * 1. Каждое нажатие сразу в черновик. Кнопки «сохранить» нет, потому что
 *    забыть её нажать — самый частый способ потерять полчаса работы.
 * 2. Перед записью данные проходят валидатор сайта. Панель физически
 *    не может опубликовать то, на чём сайт откроется пустым.
 * 3. В базу уходит только разница. Отправлять всё целиком значило бы
 *    затирать работу второго редактора, который в это же время вносит
 *    другую неделю.
 */
import { CONFIG } from '../../config.js?v=14';
import { esc } from '../ui/helpers.js?v=14';
import { mapDataset } from '../data/adapters/_map.js?v=14';
import { byWeekStartDesc, findCurrentWeek } from '../data/week-order.js?v=14';
import { validateDataset } from '../data/contract.js?v=14';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  weeksUpToLastData,
} from '../logic/standings.js?v=14';
import { renderHome } from '../pages/home.js?v=14';
/*
  ВХОД И ХРАНИЛИЩЕ ПАНЕЛИ ПОСЛЕ ПЕРЕЕЗДА С GITHUB.

  Здесь стояли auth.js (токен GitHub) и repo.js (запись в репозиторий). Теперь
  учётная запись общая с форумом, а данные лежат в базе:

    db/account.js   — кто вошёл и что ему можно;
    admin/store.js  — единственное место, которое пишет данные сайта;
    admin/publish.js — что именно изменилось (в базу уходит только разница).

  repo.js оставлен в проекте до конца переезда: пока история не перенесена
  и не проверена, возможность прочитать старый data/live.json через API
  GitHub — единственный путь назад. Панель его не использует.
*/
import {
  currentAccount, signIn, signOut, canEditSite, canModerate, canManagePeople, isConfigured,
} from '../db/account.js?v=14';
import {
  readDataset, recentChanges, uploadPhoto, setModerator,
} from './store.js?v=14';
import { diffDataset, applyChanges, describeChanges } from './publish.js?v=14';
import { roleLabel } from '../forum/roles.js?v=14';
import { prepareImage, uploadPath } from './image.js?v=14';
import {
  applyMarks,
  applyEvents,
  applyAlliances,
  marksFromRaw,
  diffMarks,
  eventsFromRaw,
  eventsDiff,
  eventProblems,
  blankEvent,
  nextEventId,
  alliancesFromRaw,
  alliancesDiff,
  allianceProblems,
  allianceResultsCount,
  blankAlliance,
  nextAllianceId,
  textsFromRaw,
  applyTexts,
  textsDiff,
  textProblems,
  blankText,
} from './edit.js?v=14';
import {
  getDraft,
  saveDraft,
  dropDraft,
  draftSavedAt,
  getEventsDraft,
  saveEventsDraft,
  dropEventsDraft,
  eventsDraftSavedAt,
  getAlliancesDraft,
  saveAlliancesDraft,
  dropAlliancesDraft,
  alliancesDraftSavedAt,
  getTextsDraft,
  saveTextsDraft,
  dropTextsDraft,
  textsDraftSavedAt,
} from './draft.js?v=14';
import { renderShell } from './shell.js?v=14';
import { renderLogin } from './login.js?v=14';
import { renderOverview } from './screens/overview.js?v=14';
import { renderWeek, describe } from './screens/week.js?v=14';
import { renderAlliances } from './screens/alliances.js?v=14';
import { renderEvents } from './screens/events.js?v=14';
import { renderGuideRoles, guideFromTexts } from './screens/guide-roles.js?v=14';
import { serializeGuidePage, blankGuideRole } from '../logic/guide-roles.js?v=14';
import { PRESIDENT_BOARD_KEY, presidentBoardFromTexts, serializePresidentBoard } from '../logic/president-board.js?v=14';
import { renderQuarter } from './screens/quarter.js?v=14';
import { renderPresident } from './screens/president.js?v=14';
import { renderPlayers } from './screens/players.js?v=14';
import { renderModeration } from './screens/moderation.js?v=14';
import { forum } from '../forum/index.js?v=14';
import { deletionReason } from '../forum/rules.js?v=14';

const SCREENS = [
  { id: 'overview', label: 'Обзор', render: renderOverview },
  { id: 'week', label: 'Неделя', render: renderWeek },
  { id: 'quarter', label: 'Кварт', render: renderQuarter },
  { id: 'alliances', label: 'Альянсы', render: renderAlliances },
  { id: 'events', label: 'Хронология', render: renderEvents },
  { id: 'guidePage', label: 'Малым алам', render: renderGuideRoles },
  { id: 'president', label: 'Президент', render: renderPresident },
  /*
    Два экрана форума. Они стоят особняком от всех остальных: те правят
    data/live.json через GitHub, а эти разговаривают с базой форума. Токен
    GitHub над форумом не властен вообще — права там проверяет сама база.
  */
  { id: 'moderation', label: 'Жалобы', render: renderModeration },
  { id: 'players', label: 'Игроки', render: renderPlayers },
];

const root = document.getElementById('admin');

/** @type {any} */
let view = null;

function parseHash() {
  const [id, param] = location.hash.replace(/^#\/?/, '').split('/');
  return { id: id || 'overview', param: param ? decodeURIComponent(param) : null };
}

/**
 * Какую неделю показывать.
 *
 * Порядок предпочтений выстроен по цене ошибки, а не по удобству кода:
 *
 * 1. Неделя из адреса — человек попросил явно.
 * 2. Неделя с незаконченным черновиком. Потерять начатый ввод хуже всего,
 *    поэтому он перебивает даже «сегодня».
 * 3. Неделя, которая идёт сейчас. Раньше здесь стояла последняя ЗАВЕДЁННАЯ,
 *    и панель открывалась на неделе из будущего: недели заводят на месяц
 *    вперёд, а человек вносил результаты туда, куда его привели.
 */
function pickWeek(param) {
  const weeks = [...view.data.weeks].sort(byWeekStartDesc);
  if (!weeks.length) return null;

  const asked = weeks.find((w) => w.id === param);
  if (asked) return asked;

  const withDraft = weeks.find((w) => getDraft(w.id));
  if (withDraft) return withDraft;

  return findCurrentWeek(weeks) ?? weeks[0];
}

function render() {
  if (!view) return;
  const { id, param } = parseHash();
  const screen = SCREENS.find((s) => s.id === id) ?? SCREENS[0];

  // Неделя — единственный экран с состоянием, поэтому оно готовится здесь,
  // а сам экран остаётся чистой функцией от данных.
  if (screen.id === 'week') {
    const week = pickWeek(param);

    view.weekId = week?.id ?? null;
    view.marks = week ? getDraft(week.id) ?? marksFromRaw(view.raw, week.id) : {};
    view.draftSaved = week ? draftSavedAt(week.id) : null;
    view.canPush = canEditSite(account);
  }

  if (screen.id === 'events') {
    // Черновик летописи живёт списком целиком — правят её пачкой, а не по полю.
    view.events = view.events ?? getEventsDraft() ?? eventsFromRaw(view.raw);
    view.eventsSaved = eventsDraftSavedAt();
    view.canPush = canEditSite(account);
  }

  if (screen.id === 'alliances') {
    // Тот же приём, что и у летописи: черновик — весь список альянсов целиком.
    view.alliances = view.alliances ?? getAlliancesDraft() ?? alliancesFromRaw(view.raw);
    view.alliancesSaved = alliancesDraftSavedAt();
    view.canPush = canEditSite(account);
  }

  if (screen.id === 'guidePage' || screen.id === 'president') {
    view.texts = view.texts ?? getTextsDraft() ?? textsFromRaw(view.raw);
    view.textsSaved = textsDraftSavedAt();
    view.canPush = canEditSite(account);
  }
  if (screen.id === 'guidePage') {
    view.guideDraft = view.guideDraft ?? guideFromTexts(view.texts);
  }
  if (screen.id === 'president') {
    view.presidentDraft = view.presidentDraft ?? presidentBoardFromTexts(view.texts);
  }

  /*
    Экраны форума догружают своё сами: список игроков и жалобы лежат в базе,
    а не в data/live.json. Ждать их при каждой отрисовке нельзя — тогда любой
    переход по панели упирался бы в запрос к форуму, включая экраны, которые
    к форуму отношения не имеют.
  */
  if (screen.id === 'players' || screen.id === 'moderation') {
    loadForumScreen(screen.id);
  }

  root.innerHTML = renderShell({
    screens: SCREENS,
    activeId: screen.id,
    inner: screen.render(view, param),
    login: account?.nick ?? '',
    /*
      Раньше рядом с логином показывался хвост токена — чтобы человек убедился,
      что вошёл тем токеном, которым думал. Токенов больше нет, а полезный
      вопрос остался: «какими правами я сейчас работаю». Подпись роли отвечает
      на него прямо, и словарь для неё один на сайт и панель (forum/roles.js).
    */
    role: roleLabel(account),
    canPush: canEditSite(account),
    weekIds: view.data.weeks.map((w) => w.id),
  });

  window.scrollTo(0, 0);
}

function showLogin(error) {
  view = null;
  root.innerHTML = renderLogin({ error, configured: isConfigured() });
}

function showError(message) {
  root.innerHTML = `
    <div class="adm-login">
      <section class="adm-login__card">
        <h1 class="adm-h1">Не получилось</h1>
        <p class="adm-error">${esc(message)}</p>
        <div class="adm-login__form">
          <button type="button" class="adm-btn adm-btn--primary" data-retry>Попробовать снова</button>
          <button type="button" class="adm-btn" data-logout>Выйти</button>
        </div>
      </section>
    </div>`;
}

/**
 * Экран «прав не хватает».
 *
 * Отдельно от ошибки: человек вошёл правильно, просто ему не выдали роль.
 * Показывать здесь «не получилось» значило бы обвинить его в чужом решении —
 * и он полез бы проверять пароль, которого дело не касается.
 */
function showNoAccess(account) {
  root.innerHTML = `
    <div class="adm-login">
      <section class="adm-login__card">
        <span class="eyebrow">Панель · Сервер 33</span>
        <h1 class="adm-h1">Панель закрыта</h1>
        <p class="adm-lead">
          Вы вошли как <b>${esc(account.nick)}</b>, но править данные сайта пока
          не можете. Панель открыта владельцу и модераторам — роль выдаёт
          владелец на вкладке «Игроки», одним нажатием.
        </p>
        <p class="muted">Скажите ему свой ник: <code class="adm-mono">${esc(account.nick)}</code></p>
        <div class="adm-login__form">
          <a class="adm-btn adm-btn--primary" href="./index.html#/forum">Открыть форум</a>
          <button type="button" class="adm-btn" data-retry>Проверить снова</button>
          <button type="button" class="adm-btn" data-logout>Выйти</button>
        </div>
      </section>
    </div>`;
}

async function load() {
  root.innerHTML = '<div class="loading">Читаем данные…</div>';

  const raw = await readDataset();

  /*
    Журнал правок — приятная, но не критичная деталь: если именно этот запрос
    не прошёл, панель обязана открыться всё равно. То же было и с историей
    коммитов до переезда.
  */
  let changes = [];
  try {
    changes = await recentChanges(12);
  } catch {
    changes = [];
  }

  const data = mapDataset(raw);

  view = {
    account,
    user: { login: account?.nick ?? '' },
    /*
      Панель показывает, откуда данные и сколько их. Раньше это был путь
      к файлу и его размер; теперь размера файла нет, поэтому считаем объём
      набора — он отвечает на тот же вопрос «много ли уже накоплено».
    */
    file: { path: 'база данных', size: JSON.stringify(raw).length, sha: '' },
    changes,
    raw,
    /*
      Копия исходных данных: с ней сравнивается результат правки, чтобы
      в базу ушла только разница. Раньше эту роль играла версия файла (sha),
      которую GitHub сверял при записи.
    */
    baseRaw: structuredClone(raw),
    data,
    weeks: data.weeks,
    canPush: canEditSite(account),
    // Тот же валидатор, которым проверяется сайт: панель не должна судить
    // о данных по своим правилам, иначе «в панели всё хорошо, а сайт пустой».
    problems: validateDataset(data),
  };

  render();
}

/** Кто вошёл. Держится отдельно от view: нужен и до загрузки данных. */
let account = null;

async function boot() {
  if (!isConfigured()) {
    showLogin();
    return;
  }

  try {
    account = await currentAccount();
  } catch (err) {
    account = null;
    showError(String(err?.message ?? err));
    return;
  }

  if (!account) {
    showLogin();
    return;
  }

  /*
    Право проверяется здесь, а не только в базе. База всё равно откажет
    в записи, но человек узнал бы об этом лишь нажав «Опубликовать» —
    после того, как заполнил всю неделю. Отказ должен приходить до работы,
    а не после.
  */
  if (!canEditSite(account)) {
    showNoAccess(account);
    return;
  }

  try {
    await load();
  } catch (err) {
    showError(String(err?.message ?? err));
  }
}

/* ── Ввод недели ─────────────────────────────────────────────────────────── */

/**
 * Перерисовываем только то, что изменилось, а не всю страницу.
 *
 * Полная перерисовка на каждое нажатие сбрасывала бы прокрутку — а человек
 * идёт по списку сверху вниз и после каждой отметки оказывался бы снова
 * в начале. Тридцать два раза за неделю.
 */
function paintCell(allianceId) {
  const cell = root.querySelector(`[data-cell="${CSS.escape(allianceId)}"]`);
  if (!cell) return;

  const outcome = view.marks[allianceId] ?? null;
  cell.classList.toggle('adm-cell--win', outcome === 'win');
  cell.classList.toggle('adm-cell--loss', outcome === 'loss');
  cell.classList.toggle('adm-cell--empty', outcome === null);

  for (const button of cell.querySelectorAll('[data-mark]')) {
    button.classList.toggle('is-on', button.dataset.mark === outcome);
  }
}

function paintProgress() {
  const form = root.querySelector('[data-week-form]');
  if (!form) return;

  const values = Object.values(view.marks).filter((o) => o === 'win' || o === 'loss');
  const total = form.querySelectorAll('[data-cell]').length;
  const pct = total ? Math.round((values.length / total) * 100) : 0;

  const filled = form.querySelector('[data-week-filled]');
  const pctEl = form.querySelector('[data-week-pct]');
  const bar = form.querySelector('[data-week-bar]');
  if (filled) filled.textContent = String(values.length);
  if (pctEl) pctEl.textContent = String(pct);
  if (bar) bar.style.width = `${pct}%`;

  const diff = diffMarks(view.raw, view.weekId, view.marks);

  const state = form.querySelector('[data-publish-state]');
  if (state) state.innerHTML = describe(diff, draftSavedAt(view.weekId));

  for (const selector of ['[data-publish]', '[data-draft-reset]', '[data-preview-toggle]']) {
    const button = form.querySelector(selector);
    if (!button) continue;
    const needsPush = selector === '[data-publish]';
    button.disabled = !diff.total || (needsPush && !view.canPush);
  }

  // Открытый предпросмотр после правки устаревает — закрываем, чтобы человек
  // не смотрел на прошлую версию, думая, что видит новую.
  const preview = form.querySelector('[data-preview]');
  if (preview && !preview.hidden) {
    preview.hidden = true;
    preview.innerHTML = '';
  }
}

/** Нажатие по П или Х. Повторное нажатие снимает отметку. */
function toggleMark(cell, mark) {
  const allianceId = cell.dataset.cell;
  if (!allianceId || !view.canPush) return;

  view.marks = { ...view.marks, [allianceId]: view.marks[allianceId] === mark ? null : mark };
  if (view.marks[allianceId] === null) delete view.marks[allianceId];

  saveDraft(view.weekId, view.marks);
  paintCell(allianceId);
  paintProgress();
}

/**
 * Предпросмотр: итоги недели, отрисованные настоящей главной страницей сайта.
 *
 * Не «похоже на сайт», а буквально renderHome на черновике — поэтому
 * расхождение между предпросмотром и результатом невозможно в принципе.
 */
function togglePreview() {
  const box = root.querySelector('[data-preview]');
  if (!box) return;

  if (!box.hidden) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const candidate = candidateRaw();
  const data = mapDataset(candidate);
  const weeks = weeksUpToLastData(data.weeks, data.results);
  const standings = computeStandings(
    data.alliances, weeks, data.results, CONFIG.scoring, CONFIG.formLength
  );

  box.innerHTML = `
    <div class="adm-preview__head">
      <span class="eyebrow">Так это будет выглядеть на сайте</span>
      <button type="button" class="adm-btn" data-preview-toggle>Закрыть</button>
    </div>
    <div class="adm-preview__body">
      ${renderHome({
        summary: computeWeekSummary(data.alliances, weeks, data.results),
        standings,
        movers: computeMovers(standings),
        weeks,
        allWeeks: data.weeks,
      })}
    </div>`;
  box.hidden = false;
}

/** Данные, какими они станут после публикации недели. */
function candidateRaw() {
  return applyMarks(view.raw, view.weekId, view.marks);
}

function showPublishResult(html, kind) {
  const box = root.querySelector('[data-publish-result]');
  if (!box) return;
  box.className = `adm-result adm-result--${kind}`;
  box.innerHTML = html;
  box.hidden = false;
}

/**
 * ОБЩАЯ ПУБЛИКАЦИЯ ДЛЯ ВСЕХ ЭКРАНОВ.
 *
 * До переезда каждый экран публиковал по-своему: собирал весь файл заново,
 * складывал своё сообщение коммита и отправлял в GitHub. Четыре почти
 * одинаковых функции — четыре места, где можно забыть проверку валидатором
 * или сброс черновика.
 *
 * Теперь публикация одна: сравнить с тем, что в базе, и записать разницу.
 * Экранам остаётся сказать, что они изменили и куда показать результат.
 *
 * @param {{
 *   candidate: any,          Данные после правки.
 *   resultBox: string,       Куда писать отчёт.
 *   onDone?: () => void,     Что сбросить после успеха (черновики).
 *   button?: HTMLElement,
 * }} opts
 */
async function publishDataset({ candidate, resultBox, onDone, button }) {
  const show = (html, kind) => {
    const box = root.querySelector(resultBox);
    if (!box) return;
    box.className = `adm-result adm-result--${kind}`;
    box.innerHTML = html;
    box.hidden = false;
  };

  const label = button?.dataset.restoreLabel || button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Публикуем…';
  }
  const restore = () => {
    if (button && button.isConnected) {
      button.textContent = label;
      button.disabled = false;
    }
  };

  try {
    /*
      Проверка ровно тем валидатором, которым проверяется сайт. Без неё панель
      могла бы записать формально корректные данные, на которых сайт откроется
      пустым, — и обнаружилось бы это у посетителей, а не здесь.
    */
    const problems = validateDataset(mapDataset(candidate));
    if (problems.length) {
      /*
        Сообщения валидатора экранируем: они собраны ИЗ данных и содержат их
        куски — «недопустимый outcome «...»». Вставить их в разметку как есть
        означало бы дать данным исполняться в панели.
      */
      show(
        `<b>Публикация отменена: данные не проходят проверку.</b>
         <ul>${problems.slice(0, 8).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <p class="muted">Черновик сохранён, ничего не потеряно.</p>`,
        'bad'
      );
      restore();
      return;
    }

    /*
      В базу уходит ТОЛЬКО разница. Отправлять всё целиком значило бы забить
      журнал правок мусором («каждая публикация трогает всё») и затирать
      работу второго редактора, который в это же время вносит другую неделю.
    */
    const changes = diffDataset(view.baseRaw, candidate);
    if (!changes.length) {
      show('<b>Изменений нет</b> — публиковать нечего.', 'warn');
      restore();
      return;
    }

    const { done, failed } = await applyChanges(changes);

    if (failed.length) {
      /*
        Часть записалась, часть нет. Молчать об этом нельзя: человек решит,
        что сохранилось всё. Черновик при этом НЕ сбрасываем — повторное
        нажатие допишет остальное.
      */
      show(
        `<b>Записано частично: ${done} из ${changes.length}.</b>
         <ul>${failed.slice(0, 5).map((f) => `<li>${esc(f.change.entity)} ${esc(f.change.id)}: ${esc(f.error)}</li>`).join('')}</ul>
         <p class="muted">Черновик сохранён. Нажмите «Опубликовать» ещё раз — допишется остальное.</p>`,
        'bad'
      );
      restore();
      return;
    }

    onDone?.();
    await load();

    show(
      `<b>Опубликовано.</b> ${esc(describeChanges(changes))}
       <p class="muted">Сайт покажет изменения сразу — данные читаются из базы.</p>`,
      'ok'
    );
  } catch (err) {
    show(`<b>Не опубликовано.</b> ${esc(String(err?.message ?? err))}`, 'bad');
    restore();
  }
}

/** Публикация недели. */
async function publish() {
  const week = view.data.weeks.find((w) => w.id === view.weekId);
  if (!week) return;

  await publishDataset({
    candidate: candidateRaw(),
    resultBox: '[data-publish-result]',
    button: root.querySelector('[data-publish]'),
    // Опубликовано — черновик больше не нужен, иначе он навсегда останется
    // «незаконченным вводом» и будет пугать значком в шапке.
    onDone: () => dropDraft(week.id),
  });
}

/* ── Хронология ──────────────────────────────────────────────────────────── */

/**
 * Служебные поля формы (_pendingImage, _imageBusy, _imageError) существуют
 * только в браузере и живут не дольше вкладки — картинка либо ещё
 * не загружена, либо уже загружена и превратилась в обычный imageUrl.
 * Класть их в localStorage нельзя: Blob не переживает JSON.stringify
 * (превратится в бессмысленный «{}»), а после перезагрузки страницы
 * такой огрызок читался бы как «картинка есть», хотя байтов уже нет.
 */
function stripTransient(list) {
  return (list ?? []).map((e) => {
    const clean = {};
    for (const [k, v] of Object.entries(e)) if (!k.startsWith('_')) clean[k] = v;
    return clean;
  });
}

/** Локальный адрес превью (URL.createObjectURL) не освобождён сам — отпускаем руками. */
function revokePendingImages(ev) {
  for (const item of ev?._pendingImages ?? []) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

/** Открыть форму: пустую для новой записи или заполненную для правки. */
function openEventForm(id) {
  const found = id ? view.events.find((e) => e.id === id) : null;
  view.eventDraft = found ? { ...found } : blankEvent();
  render();
}

function closeEventForm() {
  revokePendingImages(view.eventDraft);
  view.eventDraft = null;
  render();
}

function showEventProblems(problems) {
  const box = root.querySelector('[data-event-problems]');
  if (!box) return;
  box.innerHTML = `<b>Не сохранено.</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  box.hidden = false;
}

/**
 * Сохранить запись в рабочий список.
 *
 * В список, а не на сайт: публикация отдельным действием. Так можно поправить
 * три записи и отправить их одним коммитом, а не тремя.
 */
function saveEventToList() {
  const form = view.eventDraft;
  if (!form || !view.canPush) return;
  // Обработка картинки — доли секунды, но лучше не дать сохранить запись
  // ровно в этот момент, чем потом гадать, донеслась она до списка или нет.
  if (form._imageBusy) return;

  const problems = eventProblems(form);
  if (problems.length) {
    showEventProblems(problems);
    return;
  }

  const entry = {
    ...form,
    id: form.id ?? nextEventId(view.raw, view.events),
    title: String(form.title).trim(),
    summary: String(form.summary ?? '').trim(),
    body: String(form.body ?? '').trim(),
    imageUrl: String(form.imageUrl ?? '').trim(),
    imageUrls: Array.isArray(form.imageUrls) ? form.imageUrls.map((url) => String(url).trim()).filter(Boolean) : [],
    serverNumber: form.serverNumber === '' || form.serverNumber == null ? null : Number(form.serverNumber),
    durationDays: form.durationDays === '' || form.durationDays == null ? null : Number(form.durationDays),
  };

  const i = view.events.findIndex((e) => e.id === entry.id);
  view.events = i >= 0
    ? view.events.map((e) => (e.id === entry.id ? entry : e))
    : [entry, ...view.events];

  // Свежие сверху — так же, как их показывает сайт.
  view.events.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // В localStorage — без _pendingImage и прочих служебных полей: Blob туда
  // не кладут, а сама картинка на этом шаге ещё не покидала браузер.
  saveEventsDraft(stripTransient(view.events));
  view.eventDraft = null;
  render();
}

function deleteEventFromList(id) {
  if (!view.canPush) return;
  revokePendingImages(view.events.find((e) => e.id === id));
  view.events = view.events.filter((e) => e.id !== id);
  saveEventsDraft(stripTransient(view.events));
  // Если удалили ту запись, что была открыта в форме, форму тоже закрываем.
  if (view.eventDraft?.id === id) view.eventDraft = null;
  render();
}

function showEventsResult(html, kind) {
  const box = root.querySelector('[data-events-result]');
  if (!box) return;
  box.className = `adm-result adm-result--${kind}`;
  box.innerHTML = html;
  box.hidden = false;
}

/** Публикация летописи — тот же путь, что у недели: проверка, версия, коммит. */
async function publishEvents() {
  const button = root.querySelector('[data-events-publish]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Публикуем…';
  }
  const restore = () => {
    if (!button) return;
    button.textContent = 'Опубликовать';
    button.disabled = false;
  };

  try {
    /*
      Картинки, выбранные в форме, но ещё не загруженные, — грузим их первыми.
      До этой минуты в репозиторий не ушло ни байта: только черновик в браузере.
      Каждая уже загруженная картинка сразу сохраняется в список и в localStorage —
      если следующая оборвётся по сети, повторное «Опубликовать» не зальёт
      прежние картинки заново.
    */
    for (let i = 0; i < view.events.length; i++) {
      const ev = view.events[i];
      if (!ev._pendingImages?.length) continue;

      if (button) button.textContent = 'Загружаем фотографии…';
      const uploaded = [];
      for (const item of ev._pendingImages) {
        if (button) button.textContent = `Загружаем фото ${uploaded.length + 1}/${ev._pendingImages.length}…`;
        const bytes = await item.blob.arrayBuffer();
        uploaded.push(await uploadPhoto({
          path: uploadPath('jpg'),
          bytes,
          contentType: 'image/jpeg',
        }));
      }
      revokePendingImages(ev);

      const { _pendingImages, ...rest } = ev;
      const existing = Array.isArray(ev.imageUrls) ? ev.imageUrls : (ev.imageUrl ? [ev.imageUrl] : []);
      view.events = view.events.map((e, j) => (j === i ? { ...rest, imageUrls: [...existing, ...uploaded] } : e));
      saveEventsDraft(stripTransient(view.events));
    }
    if (button) button.textContent = 'Публикуем…';
    // publishDataset захватил бы уже занятую надпись «Публикуем…» и вернул бы
    // её кнопке после отмены. Говорим явно, во что возвращать.
    if (button) button.dataset.restoreLabel = 'Опубликовать';

    const candidate = applyEvents(view.raw, view.events);

    if (button) button.disabled = false;
    await publishDataset({
      candidate,
      resultBox: '[data-events-result]',
      button,
      onDone: () => {
        dropEventsDraft();
        view.events = null;
        view.eventDraft = null;
      },
    });
  } catch (err) {
    showEventsResult(`<b>Не опубликовано.</b> ${esc(String(err?.message ?? err))}`, 'bad');
    restore();
  }
}

/* ── Альянсы ─────────────────────────────────────────────────────────────── */

/** Открыть форму: пустую для нового альянса или заполненную для правки. */
function openAllianceForm(id) {
  const found = id ? view.alliances.find((a) => a.id === id) : null;
  view.allianceDraft = found ? { ...found } : blankAlliance();
  render();
}

function closeAllianceForm() {
  view.allianceDraft = null;
  render();
}

function showAllianceProblems(problems) {
  const box = root.querySelector('[data-alliance-problems]');
  if (!box) return;
  box.innerHTML = `<b>Не сохранено.</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  box.hidden = false;
}

/**
 * Сохранить альянс в рабочий список.
 *
 * В список, а не на сайт: публикация отдельным действием, как и в хронологии —
 * можно поправить несколько альянсов и отправить их одним коммитом.
 */
function saveAllianceToList() {
  const form = view.allianceDraft;
  if (!form || !view.canPush) return;

  const mergedInto = String(form.mergedInto ?? '').trim();
  const entry = {
    id: form.id ?? nextAllianceId(view.raw, view.alliances),
    tag: String(form.tag ?? '').trim(),
    name: String(form.name ?? '').trim(),
    color: String(form.color ?? '').trim(),
    // Слившийся альянс не может остаться «в игре» — та же защита, что и
    // в applyAlliances при публикации, только на шаг раньше.
    active: mergedInto ? false : Boolean(form.active),
    note: String(form.note ?? '').trim(),
    mergedInto,
  };

  const problems = allianceProblems(entry, view.alliances.filter((a) => a.id !== entry.id));
  if (problems.length) {
    showAllianceProblems(problems);
    return;
  }

  const i = view.alliances.findIndex((a) => a.id === entry.id);
  view.alliances = i >= 0
    ? view.alliances.map((a) => (a.id === entry.id ? entry : a))
    : [...view.alliances, entry];

  saveAlliancesDraft(view.alliances);
  view.allianceDraft = null;
  render();
}

/**
 * Удалить альянс из списка.
 *
 * Разрешено только когда за ним нет ни одного результата в истории — иначе
 * сайт не откроется: результат продолжит ссылаться на исчезнувший id.
 * Кнопка в разметке и так не показывается в этом случае (screens/alliances.js),
 * проверка здесь — вторая линия защиты, а не единственная.
 */
function deleteAllianceFromList(id) {
  if (!view.canPush) return;
  if (allianceResultsCount(view.raw, id) > 0) return;

  view.alliances = view.alliances.filter((a) => a.id !== id);
  saveAlliancesDraft(view.alliances);
  // Если удалили тот альянс, что был открыт в форме, форму тоже закрываем.
  if (view.allianceDraft?.id === id) view.allianceDraft = null;
  render();
}

/** Деактивировать или вернуть в игру — безопасная альтернатива удалению. */
function toggleAllianceActive(id) {
  if (!view.canPush) return;
  view.alliances = view.alliances.map((a) => (a.id === id ? { ...a, active: !a.active } : a));
  saveAlliancesDraft(view.alliances);
  render();
}

function showAlliancesResult(html, kind) {
  const box = root.querySelector('[data-alliances-result]');
  if (!box) return;
  box.className = `adm-result adm-result--${kind}`;
  box.innerHTML = html;
  box.hidden = false;
}

/** Публикация альянсов — тот же путь, что у недели и хронологии: проверка, версия, коммит. */
async function publishAlliances() {
  await publishDataset({
    candidate: applyAlliances(view.raw, view.alliances),
    resultBox: '[data-alliances-result]',
    button: root.querySelector('[data-alliances-publish]'),
    onDone: () => {
      dropAlliancesDraft();
      view.alliances = null;
      view.allianceDraft = null;
    },
  });
}

/* ── Тексты ──────────────────────────────────────────────────────────────── */

/**
 * Открыть форму: пустую для нового текста или заполненную для правки.
 *
 * `originalKey` — единственное, чего нет в самих данных: пока оно `null`,
 * форма считает текст новым и даёт набрать ключ руками; как только оно
 * заполнено, ключ показан, но недоступен для правки — см. edit.js.
 */
function openTextForm(key) {
  const found = key ? view.texts.find((t) => t.key === key) : null;
  view.textDraft = found ? { ...found, originalKey: found.key } : blankText();
  render();
}

function closeTextForm() {
  view.textDraft = null;
  render();
}

function showTextProblems(problems) {
  const box = root.querySelector('[data-text-problems]');
  if (!box) return;
  box.innerHTML = `<b>Не сохранено.</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  box.hidden = false;
}

/** Сохранить текст в рабочий список — публикация отдельным действием, как и везде. */
function saveTextToList() {
  const form = view.textDraft;
  if (!form || !view.canPush) return;

  const entry = {
    // Новый текст берёт ключ из поля, существующий — свой собственный:
    // поле показано, но недоступно для правки, а прочитать оттуда чужой
    // ввод означало бы позволить переименовать ключ через консоль браузера.
    key: form.originalKey ?? String(form.key ?? '').trim(),
    title: String(form.title ?? '').trim(),
    body: String(form.body ?? ''),
  };

  const problems = textProblems(entry, view.texts.filter((t) => t.key !== entry.key));
  if (problems.length) {
    showTextProblems(problems);
    return;
  }

  const i = view.texts.findIndex((t) => t.key === entry.key);
  view.texts = i >= 0
    ? view.texts.map((t) => (t.key === entry.key ? entry : t))
    : [...view.texts, entry];

  saveTextsDraft(view.texts);
  view.textDraft = null;
  render();
}

/** Удалить текст из списка. Безопасно всегда: пропавший блок сайт не сломает. */
function deleteTextFromList(key) {
  if (!view.canPush) return;

  view.texts = view.texts.filter((t) => t.key !== key);
  saveTextsDraft(view.texts);
  if (view.textDraft?.originalKey === key) view.textDraft = null;
  render();
}

function showTextsResult(html, kind) {
  const box = root.querySelector('[data-texts-result]');
  if (!box) return;
  box.className = `adm-result adm-result--${kind}`;
  box.innerHTML = html;
  box.hidden = false;
}

/** Публикация текстов — тот же путь, что у альянсов и хронологии. */
async function publishTexts() {
  /*
    Публикация должна брать последние введённые значения даже если человек
    не нажал отдельную кнопку «Сохранить черновик»: он набрал текст и жмёт
    «Опубликовать», а не «сохранить, потом опубликовать».
  */
  collectGuideDraftFromDom();
  syncGuideDraft();

  await publishDataset({
    candidate: applyTexts(view.raw, view.texts),
    resultBox: '[data-texts-result]',
    button: root.querySelector('[data-texts-publish]'),
    onDone: () => {
      dropTextsDraft();
      view.texts = null;
      view.textDraft = null;
    },
  });
}

/* ── Роли руководства ───────────────────────────────────────────────────── */
function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? '').trim());
}

function updateColorModalPreview(value) {
  const color = String(value ?? '').trim().toUpperCase();
  const modal = root.querySelector('[data-guide-color-modal]');
  if (!modal) return;
  const hex = modal.querySelector('[data-guide-color-modal-hex]');
  const orb = modal.querySelector('[data-guide-color-modal-orb]');
  if (hex) hex.textContent = color || '#------';
  if (orb && isHexColor(color)) orb.style.setProperty('--modal-color', color);
}

function openGuideColorModal(trigger) {
  const modal = root.querySelector('[data-guide-color-modal]');
  if (!modal) return;
  const container = trigger.closest('[data-guide-role], [data-guide-extra]');
  view.colorTarget = {
    kind: container?.matches('[data-guide-role]') ? 'role' : 'extra',
    index: Number(container?.dataset.guideRole ?? container?.dataset.guideExtra ?? 0),
    key: trigger.dataset.guideColorOpen,
  };
  view.colorDraft = trigger.dataset.guideColorValue || '#63F5E5';
  const input = modal.querySelector('[data-guide-color-hex]');
  if (input) input.value = view.colorDraft.toUpperCase();
  updateColorModalPreview(view.colorDraft);
  view.colorScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${view.colorScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.classList.add('guide-color-modal-open');
  modal.hidden = false;
  input?.focus({ preventScroll: true });
}

function closeGuideColorModal() {
  const modal = root.querySelector('[data-guide-color-modal]');
  if (modal) modal.hidden = true;
  const scrollY = view?.colorScrollY ?? 0;
  document.body.classList.remove('guide-color-modal-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  view.colorTarget = null;
  view.colorDraft = null;
  window.scrollTo(0, scrollY);
}

function applyGuideColor() {
  const color = String(view.colorDraft ?? '').trim().toLowerCase();
  const target = view.colorTarget;
  if (!target || !isHexColor(color)) {
    const error = root.querySelector('[data-guide-color-error]');
    if (error) error.hidden = false;
    return;
  }
  const page = view.guideDraft;
  if (target.kind === 'role' && page.roles[target.index]) page.roles[target.index] = { ...page.roles[target.index], [target.key]: color };
  if (target.kind === 'extra' && page.extraBlocks?.[target.index]) page.extraBlocks[target.index] = { ...page.extraBlocks[target.index], [target.key]: color };
  const container = root.querySelector(`[data-guide-${target.kind}="${target.index}"]`);
  const trigger = container?.querySelector('[data-guide-color-open]');
  const output = container?.querySelector('[data-guide-color-output]');
  if (trigger) { trigger.dataset.guideColorValue = color; trigger.style.setProperty('--picker-color', color); }
  if (output) { output.textContent = color; output.style.setProperty('--picker-color', color); }
  closeGuideColorModal();
  syncGuideDraft();
}

function collectGuideDraftFromDom() {
  const editor = root.querySelector('[data-guide-editor]');
  if (!editor || !view?.guideDraft) return;
  const next = JSON.parse(JSON.stringify(view.guideDraft));
  editor.querySelectorAll('[data-guide-role]').forEach((roleEl) => {
    const index = Number(roleEl.dataset.guideRole);
    if (!next.roles[index]) return;
    roleEl.querySelectorAll('[data-guide-field]').forEach((field) => {
      const key = field.dataset.guideField;
      next.roles[index][key] = field.type === 'checkbox'
        ? field.checked
        : key === 'items'
          ? field.value.split(/\n/).map((item) => item.trim()).filter(Boolean)
          : field.value;
    });
  });
  editor.querySelectorAll('[data-guide-extra]').forEach((blockEl) => {
    const index = Number(blockEl.dataset.guideExtra);
    if (!next.extraBlocks?.[index]) return;
    blockEl.querySelectorAll('[data-guide-field]').forEach((field) => {
      next.extraBlocks[index][field.dataset.guideField] = field.value;
    });
  });
  editor.querySelectorAll('[data-guide-field]').forEach((field) => {
    if (field.closest('[data-guide-role], [data-guide-extra]')) return;
    next[field.dataset.guideField] = field.value;
  });
  view.guideDraft = next;
}

function collectPresidentFromDom() {
  const editor = root.querySelector('[data-president-editor]');
  if (!editor || !view?.presidentDraft) return;
  const next = { ...view.presidentDraft };
  editor.querySelectorAll('[data-president-field]').forEach((field) => {
    next[field.dataset.presidentField] = field.type === 'checkbox' ? field.checked : field.value;
  });
  view.presidentDraft = next;
}

function savePresidentToList() {
  if (!view?.canPush || !view.presidentDraft) return false;
  collectPresidentFromDom();
  const entry = { key: PRESIDENT_BOARD_KEY, title: 'Президент сервера', body: serializePresidentBoard(view.presidentDraft) };
  const i = view.texts.findIndex((text) => text.key === PRESIDENT_BOARD_KEY);
  view.texts = i >= 0 ? view.texts.map((text) => (text.key === PRESIDENT_BOARD_KEY ? entry : text)) : [...view.texts, entry];
  saveTextsDraft(view.texts);
  const state = root.querySelector('[data-president-state]');
  if (state) state.textContent = 'Черновик доски сохранён в браузере. Нажмите «Опубликовать доску», чтобы отправить его на сайт.';
  return true;
}

function saveGuideToList() {
  if (!view?.canPush || !view.guideDraft) return false;
  collectGuideDraftFromDom();
  const entry = { key: 'guide-page', title: 'Малым алам — вся страница', body: serializeGuidePage(view.guideDraft) };
  const i = view.texts.findIndex((t) => t.key === entry.key);
  view.texts = i >= 0 ? view.texts.map((t) => (t.key === entry.key ? entry : t)) : [...view.texts, entry];
  saveTextsDraft(view.texts);
  const state = root.querySelector('[data-guide-state]');
  if (state) state.textContent = 'Черновик сохранён в браузере. Нажмите «Опубликовать», чтобы отправить изменения на сайт.';
  return true;
}

function syncGuideDraft() {
  return saveGuideToList();
}

function addGuideRole() {
  if (!view?.guideDraft || !view.canPush) return;
  collectGuideDraftFromDom();
  saveGuideToList();
  view.guideDraft = { ...view.guideDraft, roles: [...view.guideDraft.roles, blankGuideRole()] };
  render();
}

function removeGuideRole(index) {
  if (!view?.guideDraft || !view.canPush) return;
  collectGuideDraftFromDom();
  if (view.guideDraft.roles.length <= 1) return;
  view.guideDraft = { ...view.guideDraft, roles: view.guideDraft.roles.filter((_, i) => i !== index) };
  render();
}

/* ── Форум: игроки и жалобы ──────────────────────────────────────────────── */

/**
 * ЭКРАНЫ ФОРУМА В ПАНЕЛИ.
 *
 * После переезда учётная запись одна, поэтому «вы вошли в панель, но на форуме
 * не администратор» больше не бывает: вошедший здесь — тот же человек, что
 * и на форуме, и роль у него одна.
 *
 * Но разделение прав осталось, и это осознанно: право править данные сайта
 * (can_edit_site) и право модерации (role) — разные. Редактор, вносящий итоги
 * VS, не обязан разбирать жалобы, поэтому вкладки «Жалобы» и «Игроки» могут
 * оказаться ему недоступны. Отказ приходит из базы; проверки ниже нужны
 * только чтобы не показывать кнопку, которая заведомо откажет.
 */
async function loadForumScreen(screenId) {
  // Уже загружено — второй запрос при каждой перерисовке не нужен.
  if (view.forum?.loadedFor === screenId) return;

  view.forum = { configured: isConfigured(), loadedFor: screenId, me: account };

  if (!view.forum.configured) {
    render();
    return;
  }

  try {
    if (screenId === 'players') {
      // Игроки — вкладка владельца: только он управляет людьми. Модератору
      // тащить весь список бессмысленно — ему он всё равно не покажется.
      if (canManagePeople(account)) view.forum.users = await forum.listUsers();
    } else if (canModerate(account)) {
      view.forum.reports = await forum.listReports();
    }
  } catch (err) {
    view.forum.error = String(err?.message ?? err);
  }

  render();
}

/** Сообщение о результате рядом с тем действием, которое его вызвало. */
function showForumResult(selector, html, kind = 'ok') {
  const box = root.querySelector(selector);
  if (!box) return;
  box.className = `adm-result adm-result--${kind}`;
  box.innerHTML = html;
  box.hidden = false;
}

function openPlayerModal(selector, nick, targetId, extra = {}) {
  const modal = root.querySelector(selector);
  if (!modal) return;

  modal.dataset.playerId = targetId;
  const nickBox = modal.querySelector('[data-reset-nick], [data-restrict-nick], [data-delete-nick]');
  if (nickBox) nickBox.textContent = nick;

  for (const [key, value] of Object.entries(extra)) modal.dataset[key] = value;
  modal.hidden = false;
}

function closePlayerModal(selector) {
  const modal = root.querySelector(selector);
  if (!modal) return;
  modal.hidden = true;
  modal.querySelector('form')?.reset();
  modal.querySelectorAll('.adm-result').forEach((b) => { b.hidden = true; });
}

/**
 * Пароль, который не стыдно передать голосом.
 *
 * Собран из слогов, а не из случайных байтов: «xK7#pQ2z» человек будет
 * набирать в игре с телефона по одному символу и трижды опечатается.
 * Стойкость даёт длина, а не набор символов — тот же довод, что в rules.js.
 */
function suggestPassword() {
  const parts = ['вер', 'кам', 'лис', 'тор', 'сад', 'нор', 'дым', 'рек', 'зов', 'пик', 'мост', 'клён'];
  const pick = () => parts[Math.floor(Math.random() * parts.length)];
  const digits = String(Math.floor(Math.random() * 90) + 10);
  return `${pick()}-${pick()}-${digits}`;
}

/** Жалоба разобрана: пометить и убрать из списка. */
async function resolveReport(reportId) {
  try {
    await forum.resolveReport(reportId);
    view.forum.loadedFor = null;
    render();
  } catch (err) {
    showForumResult('[data-moderation-result]', esc(String(err?.message ?? err)), 'err');
  }
}

/**
 * Удаление по жалобе: сначала запись, потом отметка «разобрано».
 *
 * Порядок важен. Если сначала закрыть жалобу, а удаление не пройдёт (сеть,
 * права), нарушение останется на сайте, а жалоба на него исчезнет из списка —
 * то есть о нём больше никто не узнает.
 */
async function deleteByReport({ reportId, ruleId, targetType, targetId }) {
  try {
    const reason = deletionReason(ruleId);
    if (targetType === 'post') await forum.deletePost(targetId, reason);
    else await forum.deleteComment(targetId, reason);

    await forum.resolveReport(reportId);

    view.forum.loadedFor = null;
    render();
  } catch (err) {
    showForumResult('[data-moderation-result]', esc(String(err?.message ?? err)), 'err');
  }
}

/* ── События ── */

document.addEventListener('submit', async (e) => {
  /* ── Форум: сброс пароля ── */
  const resetForm = e.target.closest('[data-reset-form]');
  if (resetForm) {
    e.preventDefault();
    const modal = resetForm.closest('[data-reset-modal]');
    const password = String(resetForm.password.value ?? '');

    if (password.length < 8) {
      showForumResult('[data-reset-error]', 'Пароль короче 8 символов', 'err');
      return;
    }

    try {
      await forum.resetPassword(modal.dataset.playerId, password);
      const nick = modal.querySelector('[data-reset-nick]')?.textContent ?? '';
      closePlayerModal('[data-reset-modal]');
      /*
        Пароль показываем здесь и только один раз: сохранённого пароля
        не существует — база держит необратимый отпечаток, а не сам пароль.
        Подсмотреть его позже нельзя даже администратору, поэтому передать
        человеку надо сейчас.
      */
      showForumResult(
        '[data-players-result]',
        `Пароль для <b>${esc(nick)}</b> изменён. Новый пароль: <code>${esc(password)}</code> — передайте его сами, второй раз он не покажется.`,
        'ok'
      );
    } catch (err) {
      showForumResult('[data-reset-error]', esc(String(err?.message ?? err)), 'err');
    }
    return;
  }

  /* ── Форум: запрет писать ── */
  const restrictForm = e.target.closest('[data-restrict-form]');
  if (restrictForm) {
    e.preventDefault();
    const modal = restrictForm.closest('[data-restrict-modal]');
    const userId = modal.dataset.playerId;
    const duration = restrictForm.duration.value;
    const ruleId = restrictForm.ruleId.value;
    const note = String(restrictForm.note.value ?? '');

    try {
      // Пункт правил нужен, только когда мера что-то ограничивает.
      // «Снять все ограничения» обходится и без него.
      if (duration !== 'none' && !ruleId) {
        throw new Error('Выберите пункт правил: игрок должен знать причину');
      }

      if (duration === 'none') {
        await forum.setRestriction(userId, { banned: false, mutedUntil: null, reason: '' });
      } else if (duration === 'ban') {
        await forum.setRestriction(userId, {
          banned: true,
          mutedUntil: null,
          reason: deletionReason(ruleId, note),
        });
      } else {
        const until = new Date(Date.now() + Number(duration) * 86400000);
        await forum.setRestriction(userId, {
          banned: false,
          mutedUntil: until,
          reason: deletionReason(ruleId, note),
        });
      }

      closePlayerModal('[data-restrict-modal]');
      view.forum.loadedFor = null;
      render();
    } catch (err) {
      showForumResult('[data-restrict-error]', esc(String(err?.message ?? err)), 'err');
    }
    return;
  }

  /* ── Форум: удаление аккаунта ── */
  const deleteForm = e.target.closest('[data-delete-player-form]');
  if (deleteForm) {
    e.preventDefault();
    const modal = deleteForm.closest('[data-delete-modal]');
    const nick = modal.querySelector('[data-delete-nick]')?.textContent ?? '';
    const confirm = String(deleteForm.elements.confirm?.value ?? '').trim();

    if (confirm !== nick) {
      showForumResult('[data-delete-error]', 'Ник не совпадает — ничего не удалено', 'err');
      return;
    }

    try {
      await forum.adminDeleteUser(modal.dataset.playerId);
      closePlayerModal('[data-delete-modal]');
      view.forum.loadedFor = null;
      render();
      showForumResult(
        '[data-players-result]',
        `Аккаунт <b>${esc(nick)}</b> удалён навсегда. Его посты и комментарии остались на форуме — ник в них сохранён копией.`,
        'ok'
      );
    } catch (err) {
      showForumResult('[data-delete-error]', esc(String(err?.message ?? err)), 'err');
    }
    return;
  }

  const form = e.target.closest('[data-login]');
  if (!form) return;
  e.preventDefault();

  const nick = String(form.nick?.value ?? '').trim();
  const password = String(form.password?.value ?? '');
  if (!nick || !password) return;

  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Проверяем…';
  }

  try {
    account = await signIn(nick, password);
    await boot();
  } catch (err) {
    showLogin(String(err?.message ?? err));
  }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest) return;

  if (e.target.closest('[data-logout]')) {
    /*
      Выход из панели выкидывает и с форума: учётная запись одна. Раньше это
      были разные вещи — здесь отзывался токен GitHub, а сессия форума жила
      своей жизнью.
    */
    await signOut();
    account = null;
    showLogin();
    return;
  }
  if (e.target.closest('[data-refresh]') || e.target.closest('[data-retry]')) {
    boot();
    return;
  }

  /* ── Форум: игроки и жалобы ── */

  if (e.target.closest('[data-forum-reload]')) {
    // Сбрасываем метку загрузки, иначе экран решит, что данные уже есть.
    if (view?.forum) view.forum.loadedFor = null;
    render();
    return;
  }

  const resetBtn = e.target.closest('[data-player-reset]');
  if (resetBtn) {
    openPlayerModal('[data-reset-modal]', resetBtn.dataset.playerNick, resetBtn.dataset.playerReset);
    return;
  }
  if (e.target.closest('[data-reset-cancel]')) {
    closePlayerModal('[data-reset-modal]');
    return;
  }
  if (e.target.closest('[data-reset-suggest]')) {
    const input = root.querySelector('[data-reset-form] input[name="password"]');
    if (input) input.value = suggestPassword();
    return;
  }

  const restrictBtn = e.target.closest('[data-player-restrict]');
  if (restrictBtn) {
    openPlayerModal('[data-restrict-modal]', restrictBtn.dataset.playerNick, restrictBtn.dataset.playerRestrict);
    return;
  }
  if (e.target.closest('[data-restrict-cancel]')) {
    closePlayerModal('[data-restrict-modal]');
    return;
  }

  const deleteBtn = e.target.closest('[data-player-delete]');
  if (deleteBtn) {
    openPlayerModal('[data-delete-modal]', deleteBtn.dataset.playerNick, deleteBtn.dataset.playerDelete);
    return;
  }
  if (e.target.closest('[data-delete-player-cancel]')) {
    closePlayerModal('[data-delete-modal]');
    return;
  }

  /*
    Роль модератора — без окна и без подтверждения. Действие обратимо одним
    нажатием той же кнопки, поэтому спрашивать «вы уверены» значило бы просить
    подтверждение у того, кто и так может отменить.
  */
  const modBtn = e.target.closest('[data-player-moderator]');
  if (modBtn) {
    const nick = modBtn.dataset.playerModerator;
    const allow = modBtn.dataset.playerAllow === '1';

    modBtn.disabled = true;
    modBtn.textContent = allow ? 'Назначаем…' : 'Снимаем…';

    try {
      await setModerator(nick, allow);
      view.forum.loadedFor = null;
      render();
      showForumResult(
        '[data-players-result]',
        allow
          ? `<b>${esc(nick)} теперь модератор.</b> Может разбирать жалобы, удалять чужие записи и править данные сайта. GitHub для этого не нужен.`
          : `<b>${esc(nick)} больше не модератор.</b> Права закроются при следующем входе.`,
        'ok'
      );
    } catch (err) {
      if (modBtn.isConnected) {
        modBtn.disabled = false;
        modBtn.textContent = allow ? 'Сделать модератором' : 'Снять модератора';
      }
      showForumResult('[data-players-result]', esc(String(err?.message ?? err)), 'err');
    }
    return;
  }

  const dismiss = e.target.closest('[data-report-dismiss]');
  if (dismiss) {
    resolveReport(dismiss.dataset.reportDismiss);
    return;
  }

  const reportDelete = e.target.closest('[data-report-delete]');
  if (reportDelete) {
    const [targetType, targetId] = reportDelete.dataset.reportTarget.split(':');
    deleteByReport({
      reportId: reportDelete.dataset.reportDelete,
      ruleId: reportDelete.dataset.reportRule,
      targetType,
      targetId,
    });
    return;
  }

  const mark = e.target.closest('[data-mark]');
  if (mark) {
    const cell = mark.closest('[data-cell]');
    if (cell) toggleMark(cell, mark.dataset.mark);
    return;
  }

  if (e.target.closest('[data-preview-toggle]')) {
    togglePreview();
    return;
  }

  if (e.target.closest('[data-draft-reset]')) {
    dropDraft(view.weekId);
    view.marks = marksFromRaw(view.raw, view.weekId);
    render();
    return;
  }

  if (e.target.closest('[data-publish]')) {
    publish();
    return;
  }

  /* ── Хронология ── */

  if (e.target.closest('[data-event-new]')) {
    openEventForm(null);
    return;
  }

  const editBtn = e.target.closest('[data-event-edit]');
  if (editBtn) {
    openEventForm(editBtn.dataset.eventEdit);
    return;
  }

  const delBtn = e.target.closest('[data-event-delete]');
  if (delBtn) {
    deleteEventFromList(delBtn.dataset.eventDelete);
    return;
  }

  const typeBtn = e.target.closest('[data-event-type]');
  if (typeBtn && view.eventDraft) {
    view.eventDraft = { ...view.eventDraft, type: typeBtn.dataset.eventType };
    render();
    return;
  }

  if (e.target.closest('[data-event-image-clear]') && view.eventDraft) {
    // «Убрать» всегда значит «картинки не будет»: и невыгруженный выбор,
    // и уже опубликованную ссылку снимаем одной и той же кнопкой.
    revokePendingImages(view.eventDraft);
    view.eventDraft = { ...view.eventDraft, _pendingImages: [], _imageError: null, imageUrl: '', imageUrls: [] };
    render();
    return;
  }

  if (e.target.closest('[data-event-cancel]')) {
    closeEventForm();
    return;
  }

  if (e.target.closest('[data-event-save]')) {
    saveEventToList();
    return;
  }

  if (e.target.closest('[data-events-reset]')) {
    (view.events ?? []).forEach(revokePendingImages);
    dropEventsDraft();
    view.events = eventsFromRaw(view.raw);
    view.eventDraft = null;
    render();
    return;
  }

  if (e.target.closest('[data-events-publish]')) {
    publishEvents();
    return;
  }

  /* ── Альянсы ── */

  if (e.target.closest('[data-alliance-new]')) {
    openAllianceForm(null);
    return;
  }

  const allyEditBtn = e.target.closest('[data-alliance-edit]');
  if (allyEditBtn) {
    openAllianceForm(allyEditBtn.dataset.allianceEdit);
    return;
  }

  const allyDelBtn = e.target.closest('[data-alliance-delete]');
  if (allyDelBtn) {
    deleteAllianceFromList(allyDelBtn.dataset.allianceDelete);
    return;
  }

  const allyToggleBtn = e.target.closest('[data-alliance-toggle]');
  if (allyToggleBtn) {
    toggleAllianceActive(allyToggleBtn.dataset.allianceToggle);
    return;
  }

  const allyActiveChoice = e.target.closest('[data-alliance-active-choice]');
  if (allyActiveChoice && view.allianceDraft) {
    view.allianceDraft = {
      ...view.allianceDraft,
      active: allyActiveChoice.dataset.allianceActiveChoice === 'true',
    };
    render();
    return;
  }

  if (e.target.closest('[data-alliance-cancel]')) {
    closeAllianceForm();
    return;
  }

  if (e.target.closest('[data-alliance-save]')) {
    saveAllianceToList();
    return;
  }

  if (e.target.closest('[data-alliances-reset]')) {
    dropAlliancesDraft();
    view.alliances = alliancesFromRaw(view.raw);
    view.allianceDraft = null;
    render();
    return;
  }

  if (e.target.closest('[data-alliances-publish]')) {
    publishAlliances();
    return;
  }

  /* ── Президентская доска ── */
  if (e.target.closest('[data-president-save]')) { savePresidentToList(); return; }
  if (e.target.closest('[data-president-reset]')) {
    dropTextsDraft(); view.texts = textsFromRaw(view.raw); view.presidentDraft = presidentBoardFromTexts(view.texts); render(); return;
  }
  if (e.target.closest('[data-president-publish]')) { savePresidentToList(); publishTexts(); return; }

  /* ── Роли руководства ── */
  const colorOpen = e.target.closest('[data-guide-color-open]');
  if (colorOpen) { openGuideColorModal(colorOpen); return; }
  const modalColor = e.target.closest('[data-guide-modal-color]');
  if (modalColor) {
    view.colorDraft = modalColor.dataset.guideModalColor;
    const input = root.querySelector('[data-guide-color-hex]');
    if (input) input.value = view.colorDraft.toUpperCase();
    updateColorModalPreview(view.colorDraft);
    return;
  }
  if (e.target.closest('[data-guide-color-close]')) { closeGuideColorModal(); return; }
  if (e.target.closest('[data-guide-color-apply]')) { applyGuideColor(); return; }
  if (e.target.closest('[data-guide-add]')) { addGuideRole(); return; }
  if (e.target.closest('[data-guide-extra-add]')) {
    collectGuideDraftFromDom();
    saveGuideToList();
    view.guideDraft = { ...view.guideDraft, extraBlocks: [...(view.guideDraft.extraBlocks ?? []), { title: 'Новый блок', body: '', tone: 'cyan' }] };
    render(); return;
  }
  const extraRemove = e.target.closest('[data-guide-extra-remove]');
  if (extraRemove) {
    collectGuideDraftFromDom();
    const index = Number(extraRemove.dataset.guideExtraRemove);
    view.guideDraft = { ...view.guideDraft, extraBlocks: (view.guideDraft.extraBlocks ?? []).filter((_, i) => i !== index) };
    render(); return;
  }
  const guideRemove = e.target.closest('[data-guide-remove]');
  if (guideRemove) { removeGuideRole(Number(guideRemove.dataset.guideRemove)); return; }
  if (e.target.closest('[data-guide-save]')) { saveGuideToList(); return; }
  if (e.target.closest('[data-guide-reset]')) {
    dropTextsDraft(); view.texts = textsFromRaw(view.raw); view.guideDraft = guideFromTexts(view.texts); render(); return;
  }

  /* ── Тексты ── */

  if (e.target.closest('[data-text-new]')) {
    openTextForm(null);
    return;
  }

  const textEditBtn = e.target.closest('[data-text-edit]');
  if (textEditBtn) {
    openTextForm(textEditBtn.dataset.textEdit);
    return;
  }

  const textDelBtn = e.target.closest('[data-text-delete]');
  if (textDelBtn) {
    deleteTextFromList(textDelBtn.dataset.textDelete);
    return;
  }

  if (e.target.closest('[data-text-cancel]')) {
    closeTextForm();
    return;
  }

  if (e.target.closest('[data-text-save]')) {
    saveTextToList();
    return;
  }

  if (e.target.closest('[data-texts-reset]')) {
    dropTextsDraft();
    view.texts = textsFromRaw(view.raw);
    view.textDraft = null;
    render();
    return;
  }

  if (e.target.closest('[data-texts-publish]')) {
    publishTexts();
    return;
  }
});

/*
  Номер сервера пишут руками, поэтому слушаем input, а не change: иначе
  человек введёт номер, нажмёт «Опубликовать» — и уйдёт коммит без номера,
  потому что поле не потеряло фокус.
*/
document.addEventListener('input', (e) => {
  const presidentField = e.target.closest?.('[data-president-field]');
  if (presidentField && view?.presidentDraft) { collectPresidentFromDom(); savePresidentToList(); return; }
  /*
    Поля формы события пишем в состояние на каждый ввод и НЕ перерисовываем:
    перерисовка на каждую букву уносила бы курсор в конец строки.
  */
  const field = e.target.closest?.('[data-event-field]');
  if (field && view?.eventDraft) {
    view.eventDraft = { ...view.eventDraft, [field.dataset.eventField]: e.target.value };
  }

  // Поля формы альянса — тег, название, цвет, заметка. Цвет тоже сюда:
  // нативный `<input type="color">` шлёт те же события input/change.
  const allyField = e.target.closest?.('[data-alliance-field]');
  if (allyField && view?.allianceDraft) {
    const key = allyField.dataset.allianceField;
    view.allianceDraft = { ...view.allianceDraft, [key]: e.target.value };

    /*
      «Слился с» — выбор из списка, а не набор текста, поэтому курсору
      здесь ничего не грозит и перерисовку можно не бояться, в отличие от
      остальных полей формы. А отражать выбор нужно сразу: иначе чипсы
      «В игре» / «Распался» разойдутся с тем, что реально уйдёт в данные.
    */
    if (key === 'mergedInto') {
      if (e.target.value) view.allianceDraft.active = false;
      render();
    }
  }

  const guideRole = e.target.closest?.('[data-guide-role]');
  const guideExtra = e.target.closest?.('[data-guide-extra]');
  const colorHex = e.target.closest?.('[data-guide-color-hex]');
  if (colorHex) {
    view.colorDraft = colorHex.value.trim();
    const error = root.querySelector('[data-guide-color-error]');
    if (error) error.hidden = !colorHex.value || isHexColor(colorHex.value);
    updateColorModalPreview(colorHex.value);
  }

  const guideField = e.target.closest?.('[data-guide-field]');
  if (guideField && guideField.type === 'color') {
    const picker = guideField.closest('[data-guide-color-picker]');
    const output = picker?.querySelector('[data-guide-color-output]');
    if (output) { output.textContent = guideField.value; output.style.setProperty('--picker-color', guideField.value); }
  }
  if (guideField && guideExtra && view?.guideDraft) {
    const index = Number(guideExtra.dataset.guideExtra);
    const block = view.guideDraft.extraBlocks?.[index];
    if (block) view.guideDraft = { ...view.guideDraft, extraBlocks: view.guideDraft.extraBlocks.map((item, i) => i === index ? { ...item, [guideField.dataset.guideField]: guideField.value } : item) };
  } else if (guideField && view?.guideDraft) {
    if (guideRole) {
      const index = Number(guideRole.dataset.guideRole);
      const role = view.guideDraft.roles[index];
      if (role) {
        const key = guideField.dataset.guideField;
        role[key] = key === 'items'
          ? guideField.value.split(/\n/).map((item) => item.trim()).filter(Boolean)
          : guideField.type === 'checkbox' ? guideField.checked : guideField.value;
      }
    } else {
      const key = guideField.dataset.guideField;
      view.guideDraft = { ...view.guideDraft, [key]: guideField.value };
    }
    // Не теряем длинный ввод при переходе между экранами или перезагрузке.
    syncGuideDraft();
  }

  // Поля формы текста — ключ (только у нового), заголовок, тело.
  const textField = e.target.closest?.('[data-text-field]');
  if (textField && view?.textDraft) {
    view.textDraft = { ...view.textDraft, [textField.dataset.textField]: e.target.value };
  }
});

/*
  Выбор картинки. Обработка (сжатие) идёт сразу — она локальная, сети не
  трогает, и без неё поле показало бы либо ничего, либо тяжеленный оригинал.
  Сама загрузка в репозиторий отложена до «Опубликовать» (см. publishEvents):
  до этой кнопки ни один байт никуда не уходит.
*/
async function processEventFiles(files) {
  if (!view?.eventDraft || view.eventDraft._imageBusy) return;
  const validFiles = [...files].filter((file) => file?.type?.startsWith('image/'));
  if (!validFiles.length) return;

  // Новая партия добавляется к уже выбранным фото, а не заменяет их.
  const previousItems = view.eventDraft._pendingImages ?? [];
  const busyForm = { ...view.eventDraft, _imageBusy: true, _imageError: null, _pendingImages: previousItems };
  view.eventDraft = busyForm;
  render();

  let patch;
  try {
    const items = await Promise.all(validFiles.map(async (file) => {
      const blob = await prepareImage(file);
      return { blob, previewUrl: URL.createObjectURL(blob) };
    }));
    patch = { _imageBusy: false, _pendingImages: [...previousItems, ...items] };
  } catch (err) {
    patch = { _imageBusy: false, _imageError: String(err?.message ?? err) };
  }

  if (view.eventDraft !== busyForm) return;
  view.eventDraft = { ...view.eventDraft, ...patch };
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && root.querySelector('[data-guide-color-modal]:not([hidden])')) closeGuideColorModal();
});

document.addEventListener('change', (e) => {
  const input = e.target.closest?.('[data-event-image-input]');
  if (!input) return;
  processEventFiles(input.files ?? []);
  // Позволяет повторно выбрать тот же файл после удаления или дозагрузки.
  input.value = '';
});

document.addEventListener('dragover', (e) => {
  const drop = e.target.closest?.('[data-event-image-drop]');
  if (!drop || view?.eventDraft?._imageBusy) return;
  e.preventDefault();
  drop.classList.add('is-drag');
});

document.addEventListener('dragleave', (e) => {
  const drop = e.target.closest?.('[data-event-image-drop]');
  if (drop && !drop.contains(e.relatedTarget)) drop.classList.remove('is-drag');
});

document.addEventListener('drop', (e) => {
  const drop = e.target.closest?.('[data-event-image-drop]');
  if (!drop) return;
  e.preventDefault();
  drop.classList.remove('is-drag');
  processEventFiles(e.dataTransfer?.files ?? []);
});

window.addEventListener('hashchange', render);
boot();

// Select и checkbox на некоторых мобильных браузерах не всегда дают input-событие.
// Дублируем фиксацию на change, чтобы такие поля не терялись.
document.addEventListener('change', (e) => {
  const field = e.target.closest?.('[data-guide-field]');
  if (!field || !view?.guideDraft) return;
  const roleEl = field.closest('[data-guide-role]');
  const extraEl = field.closest('[data-guide-extra]');
  if (roleEl) {
    const index = Number(roleEl.dataset.guideRole);
    const role = view.guideDraft.roles[index];
    if (role) role[field.dataset.guideField] = field.type === 'checkbox' ? field.checked : field.value;
  } else if (extraEl) {
    const index = Number(extraEl.dataset.guideExtra);
    view.guideDraft.extraBlocks[index] = { ...view.guideDraft.extraBlocks[index], [field.dataset.guideField]: field.value };
  } else {
    view.guideDraft = { ...view.guideDraft, [field.dataset.guideField]: field.value };
  }
  syncGuideDraft();
});
