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
import { verdictText } from '../logic/server-outcome.js';
import { hasToken, clearToken, setToken } from './auth.js';
import { whoAmI, repoInfo, readDataFile, lastCommit, writeDataFile } from './repo.js';
import {
  applyMarks,
  applyOutcome,
  marksFromRaw,
  weekOutcomeOf,
  diffMarks,
  outcomeDiffers,
  commitMessage,
  serialize,
} from './edit.js';
import { getDraft, saveDraft, dropDraft, draftSavedAt } from './draft.js';
import { renderShell } from './shell.js';
import { renderLogin } from './login.js';
import { renderOverview } from './screens/overview.js';
import { renderWeek, describe } from './screens/week.js';
import { renderAlliances } from './screens/alliances.js';
import { renderEvents } from './screens/events.js';
import { renderTexts } from './screens/texts.js';

const SCREENS = [
  { id: 'overview', label: 'Обзор', render: renderOverview },
  { id: 'week', label: 'Неделя', render: renderWeek },
  { id: 'alliances', label: 'Альянсы', render: renderAlliances },
  { id: 'events', label: 'Хронология', render: renderEvents },
  { id: 'texts', label: 'Тексты', render: renderTexts },
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

/**
 * Состояние недели для показа: черновик, если он есть, иначе то, что в данных.
 * Отметки и итог сервера идут вместе — их и заполняют вместе.
 */
function stateFor(weekId) {
  const draft = getDraft(weekId);
  if (draft) {
    return {
      marks: draft.marks,
      server: { outcome: draft.outcome, serverNumber: draft.serverNumber },
    };
  }
  return {
    marks: marksFromRaw(view.raw, weekId),
    server: weekOutcomeOf(view.raw, weekId),
  };
}

/** Сохранить черновик текущей недели целиком. */
function persistDraft() {
  saveDraft(view.weekId, {
    marks: view.marks,
    outcome: view.server.outcome,
    serverNumber: view.server.serverNumber,
  });
}

function render() {
  if (!view) return;
  const { id, param } = parseHash();
  const screen = SCREENS.find((s) => s.id === id) ?? SCREENS[0];

  // Неделя — единственный экран с состоянием, поэтому оно готовится здесь,
  // а сам экран остаётся чистой функцией от данных.
  if (screen.id === 'week') {
    const week = pickWeek(param);
    const state = week ? stateFor(week.id) : { marks: {}, server: { outcome: null, serverNumber: null } };

    view.weekId = week?.id ?? null;
    view.marks = state.marks;
    view.server = state.server;
    view.draftSaved = week ? draftSavedAt(week.id) : null;
    view.canPush = Boolean(view.repo?.canPush);
  }

  root.innerHTML = renderShell({
    screens: SCREENS,
    activeId: screen.id,
    inner: screen.render(view, param),
    login: view.user?.login ?? '',
    canPush: Boolean(view.repo?.canPush),
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
  const serverChanged = outcomeDiffers(
    view.raw, view.weekId, view.server.outcome, view.server.serverNumber
  );

  const state = form.querySelector('[data-publish-state]');
  if (state) state.innerHTML = describe(diff, draftSavedAt(view.weekId), serverChanged);

  const hasChanges = diff.total > 0 || serverChanged;
  for (const selector of ['[data-publish]', '[data-draft-reset]', '[data-preview-toggle]']) {
    const button = form.querySelector(selector);
    if (!button) continue;
    const needsPush = selector === '[data-publish]';
    button.disabled = !hasChanges || (needsPush && !view.canPush);
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

  persistDraft();
  paintCell(allianceId);
  paintProgress();
}

/**
 * Нажатие по итогу недели. Повторное нажатие снимает — «не воевали»
 * должно возвращаться так же легко, как ставиться.
 */
function toggleOutcome(id) {
  if (!view.canPush) return;

  view.server = {
    outcome: view.server.outcome === id ? null : id,
    serverNumber: view.server.serverNumber,
  };
  // Снятый итог не должен таскать за собой номер сервера.
  if (!view.server.outcome) view.server.serverNumber = null;

  persistDraft();
  // Блок перерисовывается целиком: кнопки, поле номера и строка вердикта
  // меняются вместе, и собирать это по частям было бы дороже, чем честнее.
  repaintServerBlock();
  paintProgress();
}

function setServerNumber(value) {
  const trimmed = String(value ?? '').trim();
  view.server = {
    outcome: view.server.outcome,
    serverNumber: trimmed === '' ? null : Number(trimmed),
  };
  persistDraft();

  const verdict = root.querySelector('[data-server-verdict]');
  if (verdict && view.server.outcome) {
    verdict.textContent = verdictText(view.server.outcome, view.server.serverNumber, CONFIG.server);
  }
  paintProgress();
}

/** Перерисовать блок итога недели, сохранив фокус в поле номера. */
function repaintServerBlock() {
  const form = root.querySelector('[data-week-form]');
  const block = root.querySelector('[data-server-block]');
  if (!form || !block) return;

  const week = view.data.weeks.find((w) => w.id === view.weekId);
  if (!week) return;

  const fresh = document.createElement('div');
  fresh.innerHTML = renderWeek(view, view.weekId);

  const replacement = fresh.querySelector('[data-server-block]');
  if (replacement) block.replaceWith(replacement);
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

/**
 * Данные, какими они станут после публикации.
 *
 * Отметки и итог сервера применяются вместе и в одном месте: если бы каждая
 * кнопка собирала кандидата по-своему, предпросмотр однажды показал бы одно,
 * а коммит записал другое.
 */
function candidateRaw() {
  const withMarks = applyMarks(view.raw, view.weekId, view.marks);
  return applyOutcome(withMarks, view.weekId, view.server.outcome, view.server.serverNumber);
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
      message: commitMessage(week, view.marks, view.server),
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

/* ── События ─────────────────────────────────────────────────────────────── */

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

  const outcome = e.target.closest('[data-outcome]');
  if (outcome) {
    toggleOutcome(outcome.dataset.outcome);
    return;
  }

  if (e.target.closest('[data-preview-toggle]')) {
    togglePreview();
    return;
  }

  if (e.target.closest('[data-draft-reset]')) {
    dropDraft(view.weekId);
    view.marks = marksFromRaw(view.raw, view.weekId);
    view.server = weekOutcomeOf(view.raw, view.weekId);
    render();
    return;
  }

  if (e.target.closest('[data-publish]')) {
    publish();
  }
});

/*
  Номер сервера пишут руками, поэтому слушаем input, а не change: иначе
  человек введёт номер, нажмёт «Опубликовать» — и уйдёт коммит без номера,
  потому что поле не потеряло фокус.
*/
document.addEventListener('input', (e) => {
  if (!e.target.matches?.('[data-server-number]')) return;
  setServerNumber(e.target.value);
});

window.addEventListener('hashchange', render);
boot();
