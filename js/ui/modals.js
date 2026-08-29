/**
 * js/ui/modals.js — Secure overlay modal system (anti-leakage L2)
 * All modals are created then DOM-removed on hide (not display:none).
 * Role cards are ephemeral — never persisted as data-attributes.
 */

import { ROLES } from '../config.js';

/**
 * Create a full-screen modal portal element.
 * Returns { el, close } — caller must append to #modal-root and call close() to remove.
 */
function createPortal(html) {
  const root = document.getElementById('modal-root');
  const wrapper = document.createElement('div');
  wrapper.className = 'fixed inset-0 z-[50] flex items-center justify-center p-4';
  wrapper.innerHTML = `
    <div class="absolute inset-0 bg-obsidian/85 backdrop-blur-md" data-close></div>
    <div class="relative w-full max-w-[520px] animate-[slideUp_0.3s_ease-out]">${html}</div>
  `;
  // Prevent background scroll leak (risk mitigation)
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  root.appendChild(wrapper);
  function close() {
    wrapper.remove();
    document.body.style.overflow = prevOverflow;
  }
  wrapper.querySelector('[data-close]')?.addEventListener('click', close);
  // ESC handling
  function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } }
  document.addEventListener('keydown', onKey);
  wrapper._cleanup = () => document.removeEventListener('keydown', onKey);
  const origClose = close;
  wrapper.close = () => { wrapper._cleanup(); origClose(); };
  return { el: wrapper, close: wrapper.close };
}

/**
 * Secure role discovery modal (Pass the device).
 * Shows cover → tap to reveal → hide & pass.
 * Calls onHide when user confirms hide.
 */
export function showRoleReveal({ playerName, role, allegiance, visionIds, allPlayers, onHide, onNext, isLast }) {
  const roleMap = {
    [ROLES.MERLIN]: 'MERLIN',
    [ROLES.PERCIVAL]: 'PERCIVAL',
    [ROLES.LOYAL]: 'LOYAL SERVANT',
    [ROLES.ASSASSIN]: 'ASSASSIN',
    [ROLES.MORGANA]: 'MORGANA',
    [ROLES.MORDRED]: 'MORDRED',
    [ROLES.OBERON]: 'OBERON',
    [ROLES.MINION]: 'MINION',
  };
  const roleLabel = roleMap[role] || role;
  const allegianceLabel = allegiance === 'GOOD'
    ? (role===ROLES.PERCIVAL ? 'Percival — Sees Merlin' : role===ROLES.MERLIN ? 'Merlin — Sees Evil' : 'Loyal Servant of Arthur')
    : (role===ROLES.MORGANA ? 'Morgana — Fools Percival' : role===ROLES.MORDRED ? 'Mordred — Hidden from Merlin' : role===ROLES.OBERON ? 'Oberon — Isolated Evil' : 'Minion of Mordred');
  const isGood = allegiance === 'GOOD';
  const visionNames = visionIds.map(id => allPlayers.find(p => p.id === id)?.name || id);

  let revealed = false;
  const html = `
    <div class="rounded-[20px] overflow-hidden border border-white/10 shadow-2xl bg-[#111827]">
      <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-white/[0.06] to-transparent">
        <div>
          <p class="text-[11px] tracking-[0.16em] font-semibold text-stone-400">YOUR PRIVATE ROLE — ${escape(roleLabel)}</p>
          <h2 class="font-display font-extrabold text-[18px] leading-none text-white mt-1">${escape(playerName)}</h2>
          <p class="text-xs text-stone-500">Only your device shows this</p>
        </div>
        <div class="w-9 h-9 rounded-xl bg-gold text-obsidian flex items-center justify-center font-display font-extrabold">?</div>
      </div>
      <div class="p-6">
        <!-- Cover state -->
        <div id="reveal-cover" class="text-center py-8">
          <div class="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center text-3xl shadow-inner">🛡️</div>
          <p class="mt-4 text-sm text-stone-300">This is visible only on <span class="text-white font-semibold">${escape(playerName)}</span>’s phone.</p>
          <p class="text-xs text-stone-500 mt-1">No passing needed — each player reveals on their own device.</p>
          <button id="btn-reveal" class="mt-5 w-full py-3.5 rounded-xl bg-gold text-obsidian font-bold tracking-wide hover:bg-amber-300 transition-colors shadow-lg shadow-gold/20">
            TAP TO REVEAL ROLE
          </button>
          <p class="mt-3 text-xs text-stone-500">Auto-hides in 10s • Don’t screenshot</p>
        </div>
        <!-- Revealed state (hidden initially, created here but not leaked via data-attrs) -->
        <div id="reveal-card" class="hidden">
          <div class="rounded-2xl p-[1px] bg-gradient-to-br ${isGood ? 'from-cyan-400/60 to-blue-500/40' : 'from-rose-400/60 to-red-600/40'}">
            <div class="rounded-[15px] bg-[#0f172a] p-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-[11px] tracking-[0.16em] font-bold ${isGood ? 'text-good' : 'text-evil'}">${escape(allegianceLabel).toUpperCase()}</p>
                  <h3 class="font-display font-extrabold text-2xl leading-none text-white mt-1">${escape(roleLabel)}</h3>
                  <p class="text-sm text-stone-400 mt-1">${roleDesc(role)}</p>
                </div>
                <div class="shrink-0 w-14 h-14 rounded-xl ${isGood ? 'bg-good/15 border-good/30 text-good' : 'bg-evil/15 border-evil/30 text-evil'} border flex items-center justify-center text-2xl">
                  ${isGood ? '⚔️' : '🗡️'}
                </div>
              </div>
              ${visionNames.length ? `
                <div class="mt-5 rounded-xl ${role===ROLES.MERLIN ? 'bg-good/10 border-good/20' : role===ROLES.PERCIVAL ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-evil/10 border-evil/20'} border p-3.5">
                  <p class="text-[11px] font-bold tracking-[0.14em] ${role===ROLES.MERLIN ? 'text-good' : role===ROLES.PERCIVAL ? 'text-cyan-300' : 'text-evil'}">
                    ${role===ROLES.MERLIN ? 'YOU SEE EVIL' : role===ROLES.PERCIVAL ? 'YOU SEE MERLIN' : 'YOUR FELLOW EVIL'}
                  </p>
                  <p class="text-sm text-white font-medium mt-1.5 flex flex-wrap gap-1.5">
                    ${visionNames.map(n => `<span class="px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-xs">${escape(n)}${role===ROLES.PERCIVAL ? '<span class="ml-1 text-[10px] text-white/60">?</span>' : ''}</span>`).join('')}
                  </p>
                  <p class="text-xs text-stone-400 mt-2">${role===ROLES.MERLIN ? 'Mordred is hidden from you. Oberon appears.' : role===ROLES.PERCIVAL ? 'One is Merlin, one may be Morgana. Choose who to trust.' : role===ROLES.OBERON ? 'You are isolated — no one knows you.' : 'Coordinate, but don’t be obvious.'}</p>
                </div>
              ` : `
                <div class="mt-5 rounded-xl bg-white/[0.04] border border-white/[0.06] p-3.5">
                  <p class="text-xs text-stone-400">${role===ROLES.OBERON ? 'You are isolated Evil — you see no one and no one sees you.' : 'You have no special vision. Watch votes and proposals to deduce Evil.'}</p>
                </div>
              `}
            </div>
          </div>
           <button id="btn-hide" class="mt-5 w-full py-3.5 rounded-xl bg-white text-obsidian font-bold hover:bg-stone-100 transition-colors">
            HIDE ROLE
          </button>
          <p class="mt-2 text-center text-xs text-stone-500">Your role is hidden again. Check the board on your phone.</p>
        </div>
      </div>
    </div>
  `;
  const { close } = createPortal(html);
  const cover = document.getElementById('reveal-cover');
  const card = document.getElementById('reveal-card');
  const btnReveal = document.getElementById('btn-reveal');
  const btnHide = document.getElementById('btn-hide');

  let autoHideTimer = null;
  function doReveal() {
    if (revealed) return;
    revealed = true;
    cover.classList.add('hidden');
    card.classList.remove('hidden');
    // Auto-hide after 10s (secure)
    autoHideTimer = setTimeout(() => doHide(), 10000);
  }
  function doHide() {
    clearTimeout(autoHideTimer);
    close();
    onHide?.();
    // If not last, caller will advance revealIndex and re-open next
    if (isLast) onNext?.();
    else onNext?.();
  }
  btnReveal.addEventListener('click', doReveal);
  btnHide.addEventListener('click', doHide);
  return { close };
}

function roleDesc(role) {
  if (role === ROLES.MERLIN) return 'You see all Evil except Mordred. Guide Good without being found.';
  if (role === ROLES.PERCIVAL) return 'You see Merlin (Morgana appears as Merlin). Protect the real one.';
  if (role === ROLES.ASSASSIN) return 'You know evil (except Oberon). Find and kill Merlin at the end.';
  if (role === ROLES.MORGANA) return 'You appear as Merlin to Percival. Deceive him.';
  if (role === ROLES.MORDRED) return 'You are hidden from Merlin. Stay covert.';
  if (role === ROLES.OBERON) return 'You are isolated Evil — you see no one, no one sees you.';
  if (role === ROLES.LOYAL) return 'Find Evil through voting and quests.';
  return 'Sabotage quests. Hide among Good. Protect the Assassin.';
}

/**
 * Quest vote modal — secret Success/Fail selection for team members.
 * Good sees only Success (Fail disabled with tooltip).
 */
export function showQuestVote({ playerName, isEvil, onSubmit }) {
  const html = `
    <div class="rounded-[20px] overflow-hidden border border-white/10 shadow-2xl bg-[#111827]">
      <div class="px-6 py-4 border-b border-white/10">
        <p class="text-[11px] tracking-[0.16em] font-semibold text-stone-400">SECRET QUEST VOTE</p>
        <h2 class="font-display font-bold text-lg text-white mt-1">${escape(playerName)} — choose your card</h2>
        <p class="text-xs text-stone-500 mt-1">Only you can see this. Make your play, then pass.</p>
      </div>
      <div class="p-6">
        <div class="grid grid-cols-2 gap-4">
          <button data-vote="SUCCESS" class="quest-card success group relative rounded-2xl border-2 border-white/10 bg-gradient-to-br from-cyan-900/30 to-blue-900/30 p-5 text-center hover:border-good/50">
            <div class="w-12 h-12 mx-auto rounded-xl bg-good/20 border border-good/30 flex items-center justify-center text-xl">✓</div>
            <p class="font-display font-extrabold tracking-wide text-white mt-3">SUCCESS</p>
            <p class="text-xs text-stone-400 mt-1">Quest succeeds</p>
            <div class="absolute inset-0 rounded-2xl pointer-events-none group-[.selected]:ring-2 group-[.selected]:ring-good"></div>
          </button>
          <button data-vote="FAIL" ${isEvil ? '' : 'disabled'} class="quest-card fail group relative rounded-2xl border-2 border-white/10 ${isEvil ? 'bg-gradient-to-br from-rose-900/30 to-red-900/30 hover:border-evil/50' : 'bg-white/[0.03] opacity-50 cursor-not-allowed'} p-5 text-center">
            <div class="w-12 h-12 mx-auto rounded-xl ${isEvil ? 'bg-evil/20 border border-evil/30' : 'bg-white/10 border border-white/10'} flex items-center justify-center text-xl">✕</div>
            <p class="font-display font-extrabold tracking-wide ${isEvil ? 'text-white' : 'text-stone-500'} mt-3">FAIL</p>
            <p class="text-xs ${isEvil ? 'text-stone-400' : 'text-stone-600'} mt-1">${isEvil ? 'Sabotage quest' : 'Good must succeed'}</p>
          </button>
        </div>
        ${!isEvil ? '<p class="mt-3 text-center text-xs text-amber-300/80">Loyal servants must play Success.</p>' : '<p class="mt-3 text-center text-xs text-stone-500">Evil may play either. Choose wisely — you stay hidden.</p>'}
        <button id="btn-confirm-quest" disabled class="mt-5 w-full py-3.5 rounded-xl bg-white/10 text-stone-500 font-bold cursor-not-allowed transition-colors">Select a card</button>
      </div>
    </div>
  `;
  const { close } = createPortal(html);
  let selected = null;
  const btnConfirm = document.getElementById('btn-confirm-quest');
  const cards = document.querySelectorAll('.quest-card');
  cards.forEach(c => {
    c.addEventListener('click', () => {
      if (c.hasAttribute('disabled')) return;
      cards.forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      selected = c.dataset.vote;
      btnConfirm.disabled = false;
      btnConfirm.className = 'mt-5 w-full py-3.5 rounded-xl bg-gold text-obsidian font-bold hover:bg-amber-300 transition-colors shadow-lg shadow-gold/20';
      btnConfirm.textContent = `PLAY ${selected}`;
    });
  });
  btnConfirm.addEventListener('click', () => {
    if (!selected) return;
    close();
    onSubmit(selected);
  });
  return { close };
}

/**
 * Simple confirm modal for assassination, etc.
 */
export function showConfirm({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, variant = 'default' }) {
  const html = `
    <div class="rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#111827] p-6">
      <h3 class="font-display font-bold text-lg text-white">${escape(title)}</h3>
      <p class="text-sm text-stone-300 mt-2 leading-relaxed">${body}</p>
      <div class="flex gap-3 mt-6">
        <button data-cancel class="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold transition-colors">${escape(cancelText)}</button>
        <button data-confirm class="flex-1 py-3 rounded-xl ${variant==='danger' ? 'bg-evil hover:bg-rose-600 text-white' : 'bg-gold hover:bg-amber-300 text-obsidian'} font-bold transition-colors">${escape(confirmText)}</button>
      </div>
    </div>
  `;
  const { close } = createPortal(html);
  const portalEl = document.getElementById('modal-root').lastElementChild;
  portalEl.querySelector('[data-cancel]').addEventListener('click', close);
  portalEl.querySelector('[data-confirm]').addEventListener('click', () => { close(); onConfirm?.(); });
  return { close };
}

function escape(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
