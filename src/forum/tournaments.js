/**
 * ТУРНИРЫ — поведение.
 *
 * Состояние в одном объекте, разметку возвращает строкой pages/tournaments.js.
 * Живое поведение: жребий, создание, засчёт раунда.
 */
import { forum } from './index.js';
import { renderTournaments } from '../pages/tournaments.js';

const state = {
  me: null,
  alliances: [],
  tournaments: [],
  loading: true,
  drawn: null,
};

let host = null;
let wired = false;

function paint() {
  if (!host) return;
  host.innerHTML = renderTournaments(state);
  syncDraw();
}

/*
  ЖРЕБИЙ. Пара выпадает сама и закрепляется: селекты закрыты, меняет её
  только 🎲. Выпавшее живёт в state.drawn — перерисовка после засчёта раунда
  не должна тайком подсовывать новую пару там, где лидер собирался создать
  турнир тем же составом.
*/
function syncDraw() {
  const form = host?.querySelector('[data-tour-create]');
  if (!form) return;
  const opts = [...form.querySelectorAll('select[name="allyA"] option')];
  if (opts.length < 2) return;
  const alive = (id) => opts.some((o) => o.value === id);
  if (!state.drawn || !alive(state.drawn.a) || !alive(state.drawn.b) || state.drawn.a === state.drawn.b) {
    const i = Math.floor(Math.random() * opts.length);
    let j = Math.floor(Math.random() * (opts.length - 1));
    if (j >= i) j += 1;
    state.drawn = { a: opts[i].value, b: opts[j].value };
  }
  form.elements.allyA.value = state.drawn.a;
  form.elements.allyB.value = state.drawn.b;
}

async function load() {
  try {
    state.me = await forum.currentUser();
  } catch { state.me = null; }
  try {
    state.tournaments = (await forum.listTournaments?.()) ?? [];
  } catch { state.tournaments = []; }
  state.loading = false;
  paint();
}

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;

    const rand = t.closest('[data-tour-random]');
    if (rand) {
      state.drawn = null;
      syncDraw();
      return;
    }

    const roundBtn = t.closest('[data-tour-round]');
    if (roundBtn && forum.addTournamentRound) {
      const [tournamentId, winner] = roundBtn.dataset.tourRound.split(':');
      roundBtn.disabled = true;
      try {
        await forum.addTournamentRound(tournamentId, winner || null);
        state.tournaments = await forum.listTournaments();
        paint();
      } catch {
        roundBtn.disabled = false;
      }
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-tour-create]');
    if (!form || !host?.contains(form)) return;
    e.preventDefault();
    const err = form.querySelector('[data-tour-error]');
    if (err) err.hidden = true;
    syncDraw();
    const a = state.drawn?.a;
    const b = state.drawn?.b;
    if (!a || !b || a === b) {
      if (err) { err.textContent = 'Жребий не задался — перебросьте 🎲'; err.hidden = false; }
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await forum.createTournament(a, b, String(form.elements.title?.value ?? '').trim());
      // Созданный турнир уходит в ленту, а форма остаётся — под него нужен
      // новый жребий, а не прежняя пара.
      state.drawn = null;
      state.tournaments = await forum.listTournaments();
      paint();
    } catch (ex) {
      if (err) { err.textContent = String(ex?.message ?? ex); err.hidden = false; }
      if (btn) btn.disabled = false;
    }
  });
}

export async function mountTournaments(container, alliances = []) {
  host = container;
  state.alliances = Array.isArray(alliances) ? alliances : [];
  state.loading = true;
  paint();
  wire();
  await load();
}

export function unmountTournaments() {
  host = null;
  state.tournaments = [];
}
