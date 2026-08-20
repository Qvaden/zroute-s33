/**
 * АДМИН-ПАНЕЛЬ.
 *
 * Отдельная точка входа, а не раздел сайта. Причины две: посетитель не должен
 * грузить код панели, и попасть в неё случайно из меню тоже не должен.
 *
 * Фаза 1 доказала главное: api.github.com достаётся из сети редактора, а значит
 * бесплатная панель без сервера работает. Фаза 2 добавляет ввод недели
 * и публикацию одним коммитом.
 *
 * ТРИ ПРАВИЛА ПУБЛИКАЦИИ, которые здесь соблюдаются буквально:
 *
 * 1. Каждое нажатие сразу в черновик. Кнопки «сохранить» нет, потому что
 *    забыть её нажать — самый частый способ потерять полчаса работы.
 * 2. Перед коммитом данные проходят валидатор сайта. Панель физически
 *    не может опубликовать то, на чём сайт откроется пустым.
 * 3. Коммит всегда с версией прочитанного файла. Если файл успели изменить,
 *    GitHub откажет, и мы объясним — вместо того чтобы затереть чужую работу.
 */
import { CONFIG } from '../../config.js';
import { esc, safeUrl } from '../ui/helpers.js';
import { mapDataset } from '../data/adapters/_map.js';
import { byWeekStartDesc, findCurrentWeek } from '../data/week-order.js';
import { validateDataset } from '../data/contract.js';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  weeksUpToLastData,
} from '../logic/standings.js';
import { renderHome } from '../pages/home.js';
import { hasToken, clearToken, setToken } from './auth.js';
import { whoAmI, repoInfo, readDataFile, lastCommit, writeDataFile, uploadImageFile } from './repo.js';
import { prepareImage, uploadPath } from './image.js';
import {
  applyMarks,
  applyEvents,
  applyAlliances,
  marksFromRaw,
  diffMarks,
  commitMessage,
  eventsFromRaw,
  eventsDiff,
  eventsCommitMessage,
  eventProblems,
  blankEvent,
  nextEventId,
  alliancesFromRaw,
  alliancesDiff,
  alliancesCommitMessage,
  allianceProblems,
  allianceResultsCount,
  blankAlliance,
  nextAllianceId,
  textsFromRaw,
  applyTexts,
  textsDiff,
  textsCommitMessage,
  textProblems,
  blankText,
  serialize,
} from './edit.js';
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
} from './draft.js';
import { renderShell } from './shell.js';
import { renderLogin } from './login.js';
import { renderOverview } from './screens/overview.js';
import { renderWeek, describe } from './screens/week.js';
import { renderAlliances } from './screens/alliances.js';
import { renderEvents } from './screens/events.js';
import { renderGuideRoles, guideFromTexts } from './screens/guide-roles.js';
import { serializeGuidePage, blankGuideRole } from '../logic/guide-roles.js';
import { renderQuarter } from './screens/quarter.js';

const SCREENS = [
  { id: 'overview', label: 'Обзор', render: renderOverview },
  { id: 'week', label: 'Неделя', render: renderWeek },
  { id: 'quarter', label: 'Кварт', render: renderQuarter },
  { id: 'alliances', label: 'Альянсы', render: renderAlliances },
  { id: 'events', label: 'Хронология', render: renderEvents },
  { id: 'guidePage', label: 'Малым алам', render: renderGuideRoles },
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
    view.canPush = Boolean(view.repo?.canPush);
  }

  if (screen.id === 'events') {
    // Черновик летописи живёт списком целиком — правят её пачкой, а не по полю.
    view.events = view.events ?? getEventsDraft() ?? eventsFromRaw(view.raw);
    view.eventsSaved = eventsDraftSavedAt();
    view.canPush = Boolean(view.repo?.canPush);
  }

  if (screen.id === 'alliances') {
    // Тот же приём, что и у летописи: черновик — весь список альянсов целиком.
    view.alliances = view.alliances ?? getAlliancesDraft() ?? alliancesFromRaw(view.raw);
    view.alliancesSaved = alliancesDraftSavedAt();
    view.canPush = Boolean(view.repo?.canPush);
  }

  if (screen.id === 'guidePage') {
    // Общий черновик: роли лежат в том же безопасном массиве texts, но имеют отдельный удобный редактор.
    view.texts = view.texts ?? getTextsDraft() ?? textsFromRaw(view.raw);
    view.textsSaved = textsDraftSavedAt();
    view.guideDraft = view.guideDraft ?? guideFromTexts(view.texts);
    view.canPush = Boolean(view.repo?.canPush);
  }

  root.innerHTML = renderShell({
    screens: SCREENS,
    activeId: screen.id,
    inner: screen.render(view, param),
    login: view.user?.login ?? '',
    canPush: Boolean(view.repo?.canPush),
    weekIds: view.data.weeks.map((w) => w.id),
  });

  window.scrollTo(0, 0);
}

function showLogin(error) {
  view = null;
  root.innerHTML = renderLogin({ error });
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

async function load() {
  root.innerHTML = '<div class="loading">Читаем данные из репозитория…</div>';

  const [user, repo, file] = await Promise.all([whoAmI(), repoInfo(), readDataFile()]);

  /*
    История правок — приятная, но не критичная деталь: если именно этот
    запрос не прошёл, панель обязана открыться всё равно.
  */
  let commit = null;
  try {
    commit = await lastCommit();
  } catch {
    commit = null;
  }

  const data = mapDataset(file.raw);

  view = {
    user,
    repo,
    file: { path: file.path, size: file.size, sha: file.sha },
    commit,
    raw: file.raw,
    data,
    weeks: data.weeks,
    canPush: Boolean(repo.canPush),
    // Тот же валидатор, которым проверяется сайт: панель не должна судить
    // о данных по своим правилам, иначе «в панели всё хорошо, а сайт пустой».
    problems: validateDataset(data),
  };

  render();
}

async function boot() {
  if (!hasToken()) {
    showLogin();
    return;
  }
  try {
    await load();
  } catch (err) {
    const message = String(err?.message ?? err);
    // Плохой токен возвращает на вход, всё остальное — на экран ошибки
    // с кнопкой повтора: сеть у аудитории отваливается регулярно.
    if (/Токен не принят/.test(message)) {
      clearToken();
      showLogin(message);
    } else {
      showError(message);
    }
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

/** Публикация: проверить, закоммитить, перечитать. */
async function publish() {
  const week = view.data.weeks.find((w) => w.id === view.weekId);
  if (!week) return;

  const button = root.querySelector('[data-publish]');
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
    const candidate = candidateRaw();

    /*
      Проверка ровно тем валидатором, которым проверяется сайт. Без неё панель
      могла бы опубликовать формально корректный JSON, на котором сайт откроется
      пустым, — и обнаружилось бы это у посетителей, а не здесь.
    */
    const problems = validateDataset(mapDataset(candidate));
    if (problems.length) {
      /*
        Сообщения валидатора экранируем: они собраны ИЗ данных и содержат
        их куски — «недопустимый serverOutcome «...»». Вставить их в разметку
        как есть означало бы дать данным исполняться в панели, где живёт токен.
      */
      showPublishResult(
        `<b>Публикация отменена: данные не проходят проверку.</b>
         <ul>${problems.slice(0, 8).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <p class="muted">Черновик сохранён, ничего не потеряно.</p>`,
        'bad'
      );
      restore();
      return;
    }

    const result = await writeDataFile({
      text: serialize(candidate),
      sha: view.file.sha,
      message: commitMessage(week, view.marks),
    });

    // Опубликовано — черновик больше не нужен, иначе он навсегда останется
    // «незаконченным вводом» и будет пугать значком в шапке.
    dropDraft(week.id);
    await load();

    showPublishResult(
      `<b>Опубликовано.</b>
       ${
         safeUrl(result.commitUrl)
           ? `<a href="${esc(safeUrl(result.commitUrl))}" target="_blank" rel="noopener noreferrer">Коммит ${esc(result.commitSha)}</a>`
           : `Коммит ${esc(result.commitSha)}`
       }
       <p class="muted">Сайт обновится в течение минуты — GitHub Pages пересобирает страницы после коммита.</p>`,
      'ok'
    );
  } catch (err) {
    const message = String(err?.message ?? err);
    showPublishResult(
      `<b>Не опубликовано.</b> ${esc(message)}`,
      err?.conflict ? 'warn' : 'bad'
    );
    restore();
  }
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
        uploaded.push(await uploadImageFile({
          path: uploadPath('jpg'),
          bytes,
          message: `хронология: фото для записи ${ev.id}`,
        }));
      }
      revokePendingImages(ev);

      const { _pendingImages, ...rest } = ev;
      const existing = Array.isArray(ev.imageUrls) ? ev.imageUrls : (ev.imageUrl ? [ev.imageUrl] : []);
      view.events = view.events.map((e, j) => (j === i ? { ...rest, imageUrls: [...existing, ...uploaded] } : e));
      saveEventsDraft(stripTransient(view.events));
    }
    if (button) button.textContent = 'Публикуем…';

    const candidate = applyEvents(view.raw, view.events);

    const problems = validateDataset(mapDataset(candidate));
    if (problems.length) {
      showEventsResult(
        `<b>Публикация отменена: данные не проходят проверку.</b>
         <ul>${problems.slice(0, 8).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <p class="muted">Черновик сохранён, ничего не потеряно.</p>`,
        'bad'
      );
      restore();
      return;
    }

    const result = await writeDataFile({
      text: serialize(candidate),
      sha: view.file.sha,
      message: eventsCommitMessage(eventsDiff(view.raw, view.events)),
    });

    dropEventsDraft();
    view.events = null;
    view.eventDraft = null;
    await load();

    showEventsResult(
      `<b>Опубликовано.</b>
       ${
         safeUrl(result.commitUrl)
           ? `<a href="${esc(safeUrl(result.commitUrl))}" target="_blank" rel="noopener noreferrer">Коммит ${esc(result.commitSha)}</a>`
           : `Коммит ${esc(result.commitSha)}`
       }
       <p class="muted">Сайт обновится в течение минуты.</p>`,
      'ok'
    );
  } catch (err) {
    showEventsResult(`<b>Не опубликовано.</b> ${esc(String(err?.message ?? err))}`, err?.conflict ? 'warn' : 'bad');
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
  const button = root.querySelector('[data-alliances-publish]');
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
    const candidate = applyAlliances(view.raw, view.alliances);

    const problems = validateDataset(mapDataset(candidate));
    if (problems.length) {
      showAlliancesResult(
        `<b>Публикация отменена: данные не проходят проверку.</b>
         <ul>${problems.slice(0, 8).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <p class="muted">Черновик сохранён, ничего не потеряно.</p>`,
        'bad'
      );
      restore();
      return;
    }

    const result = await writeDataFile({
      text: serialize(candidate),
      sha: view.file.sha,
      message: alliancesCommitMessage(alliancesDiff(view.raw, view.alliances)),
    });

    dropAlliancesDraft();
    view.alliances = null;
    view.allianceDraft = null;
    await load();

    showAlliancesResult(
      `<b>Опубликовано.</b>
       ${
         safeUrl(result.commitUrl)
           ? `<a href="${esc(safeUrl(result.commitUrl))}" target="_blank" rel="noopener noreferrer">Коммит ${esc(result.commitSha)}</a>`
           : `Коммит ${esc(result.commitSha)}`
       }
       <p class="muted">Сайт обновится в течение минуты.</p>`,
      'ok'
    );
  } catch (err) {
    showAlliancesResult(`<b>Не опубликовано.</b> ${esc(String(err?.message ?? err))}`, err?.conflict ? 'warn' : 'bad');
    restore();
  }
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

/** Публикация текстов — тот же путь, что у альянсов и хронологии: проверка, версия, коммит. */
async function publishTexts() {
  const button = root.querySelector('[data-texts-publish]');
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
    const candidate = applyTexts(view.raw, view.texts);

    const problems = validateDataset(mapDataset(candidate));
    if (problems.length) {
      showTextsResult(
        `<b>Публикация отменена: данные не проходят проверку.</b>
         <ul>${problems.slice(0, 8).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <p class="muted">Черновик сохранён, ничего не потеряно.</p>`,
        'bad'
      );
      restore();
      return;
    }

    const result = await writeDataFile({
      text: serialize(candidate),
      sha: view.file.sha,
      message: textsCommitMessage(textsDiff(view.raw, view.texts)),
    });

    dropTextsDraft();
    view.texts = null;
    view.textDraft = null;
    await load();

    showTextsResult(
      `<b>Опубликовано.</b>
       ${
         safeUrl(result.commitUrl)
           ? `<a href="${esc(safeUrl(result.commitUrl))}" target="_blank" rel="noopener noreferrer">Коммит ${esc(result.commitSha)}</a>`
           : `Коммит ${esc(result.commitSha)}`
       }
       <p class="muted">Сайт обновится в течение минуты.</p>`,
      'ok'
    );
  } catch (err) {
    showTextsResult(`<b>Не опубликовано.</b> ${esc(String(err?.message ?? err))}`, err?.conflict ? 'warn' : 'bad');
    restore();
  }
}

/* ── Роли руководства ───────────────────────────────────────────────────── */
function saveGuideToList() {
  if (!view?.canPush || !view.guideDraft) return;
  const entry = { key: 'guide-page', title: 'Малым алам — вся страница', body: serializeGuidePage(view.guideDraft) };
  const i = view.texts.findIndex((t) => t.key === entry.key);
  view.texts = i >= 0 ? view.texts.map((t) => (t.key === entry.key ? entry : t)) : [...view.texts, entry];
  saveTextsDraft(view.texts);
  const state = root.querySelector('[data-guide-state]');
  if (state) state.textContent = 'Черновик сохранён в браузере. Нажмите «Опубликовать», чтобы отправить изменения на сайт.';
}

function addGuideRole() {
  if (!view?.guideDraft || !view.canPush) return;
  view.guideDraft = { ...view.guideDraft, roles: [...view.guideDraft.roles, blankGuideRole()] };
  render();
}

function removeGuideRole(index) {
  if (!view?.guideDraft || !view.canPush) return;
  if (view.guideDraft.roles.length <= 1) return;
  view.guideDraft = { ...view.guideDraft, roles: view.guideDraft.roles.filter((_, i) => i !== index) };
  render();
}

/* ── События ── */

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-login]');
  if (!form) return;
  e.preventDefault();

  const input = form.querySelector('input[name="token"]');
  const token = String(input?.value ?? '').trim();
  if (!token) return;

  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Проверяем…';
  }

  try {
    /*
      Проверяем до сохранения, причём дважды и по-разному: /user отвечает
      на «токен вообще живой», а /repos — на «этот токен видит этот
      репозиторий». Второе без первого не проверить, а сохранить нерабочий
      токен значит запереть человека на экране ошибки.
    */
    await whoAmI(token);
    await repoInfo(token);
    setToken(token);
    await boot();
  } catch (err) {
    showLogin(String(err?.message ?? err));
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest) return;

  if (e.target.closest('[data-logout]')) {
    clearToken();
    showLogin();
    return;
  }
  if (e.target.closest('[data-refresh]') || e.target.closest('[data-retry]')) {
    boot();
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
    (view.events ?? []).forEach(revokePendingImage);
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

  /* ── Роли руководства ── */
  if (e.target.closest('[data-guide-add]')) { addGuideRole(); return; }
  if (e.target.closest('[data-guide-extra-add]')) {
    view.guideDraft = { ...view.guideDraft, extraBlocks: [...(view.guideDraft.extraBlocks ?? []), { title: 'Новый блок', body: '', tone: 'cyan' }] };
    render(); return;
  }
  const extraRemove = e.target.closest('[data-guide-extra-remove]');
  if (extraRemove) {
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

  const guideCredit = e.target.closest?.('[data-guide-credit]');
  if (guideCredit && view?.guideDraft) view.guideDraft.credit = e.target.value;

  const guideRole = e.target.closest?.('[data-guide-role]');
  const guideExtra = e.target.closest?.('[data-guide-extra]');
  const guideField = e.target.closest?.('[data-guide-field]');
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
