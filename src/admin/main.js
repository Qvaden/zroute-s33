/**
 * АДМИН-ПАНЕЛЬ. ФАЗА 1: ТОЛЬКО ЧТЕНИЕ.
 *
 * Отдельная точка входа, а не раздел сайта. Причины две: посетитель не должен
 * грузить код панели, и попасть в неё случайно из меню тоже не должен.
 *
 * Почему фаза 1 вообще существует отдельно. Всё построение упирается в один
 * непроверенный факт: достанется ли api.github.com из сети редактора. Если нет,
 * весь замысел бесплатной панели рушится — и узнать это надо до того, как
 * написан экран ввода. Поэтому первая фаза сознательно ничего не пишет:
 * она доказывает, что связь есть, и показывает данные так, как их видит сайт.
 *
 * Кнопок, меняющих данные, здесь нет физически, а не спрятаны.
 */
import { mapDataset } from '../data/adapters/_map.js';
import { validateDataset } from '../data/contract.js';
import { hasToken, clearToken, setToken } from './auth.js';
import { whoAmI, repoInfo, readDataFile, lastCommit } from './repo.js';
import { renderShell } from './shell.js';
import { renderLogin } from './login.js';
import { renderOverview } from './screens/overview.js';
import { renderWeek } from './screens/week.js';
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

function render() {
  if (!view) return;
  const { id, param } = parseHash();
  const screen = SCREENS.find((s) => s.id === id) ?? SCREENS[0];

  root.innerHTML = renderShell({
    screens: SCREENS,
    activeId: screen.id,
    inner: screen.render(view, param),
    login: view.user?.login ?? '',
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
        <p class="adm-error">${message}</p>
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
  }
});

window.addEventListener('hashchange', render);
boot();
