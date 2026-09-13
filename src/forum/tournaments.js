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
};

let host = null;
let wired = false;

function paint() {
  if (!host) return;
  host.innerHTML = renderTournaments(state);
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
      const form = rand.closest('[data-tour-create]');
      const opts = [...form.querySelectorAll('select[name="allyA"] option')];
      if (opts.length < 2) return;
      const i = Math.floor(Math.random() * opts.length);
      let j = Math.floor(Math.random() * (opts.length - 1));
      if (j >= i) j += 1;
      form.elements.allyA.value = opts[i].value;
      form.elements.allyB.value = opts[j].value;
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
    const a = form.elements.allyA.value;
    const b = form.elements.allyB.value;
    if (!a || !b || a === b) {
      if (err) { err.textContent = 'Выберите два разных альянса'; err.hidden = false; }
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await forum.createTournament(a, b, String(form.elements.title?.value ?? '').trim());
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
