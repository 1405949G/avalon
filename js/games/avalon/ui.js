/**
 * js/games/avalon/ui.js — Avalon-specific lobby options + in-game UI helpers
 */
import { EXTRA_ROLES, getMaxExtraEvil } from './config.js';

export function renderAvalonOptions(extraRoles, playerCount, isJoiner) {
  const maxEvil = getMaxExtraEvil(playerCount);
  const enabledEvil = ['morgana','mordred','oberon'].filter(k=> !!extraRoles[k]).length;
  const buttons = EXTRA_ROLES.map(r => {
    const active = !!extraRoles[r.key];
    const isEvil = r.side==='EVIL';
    const wouldExceed = !active && isEvil && enabledEvil >= maxEvil;
    const bg = active ? 'bg-[#3aa8d6] border-[#3aa8d6] text-white' : (wouldExceed ? 'bg-white/[0.03] border-white/10 text-white/30' : 'bg-white/[0.06] border-white/15 text-stone-300' + (isJoiner ? '' : ' hover:bg-white/10'));
    const sideColor = r.side === 'GOOD' ? 'text-cyan-200' : 'text-rose-200';
    const extraAttr = isJoiner ? '' : `data-extra="${r.key}"`;
    const disabled = isJoiner ? 'disabled opacity-60 cursor-not-allowed' : (wouldExceed ? 'disabled opacity-40 cursor-not-allowed' : '');
    const title = wouldExceed ? `Max ${maxEvil} evil extra for ${playerCount} players` : '';
    return `<button ${extraAttr} ${disabled} title="${title}" class="text-left rounded-full px-3.5 py-2.5 border flex flex-col leading-none ${bg} transition-colors"><span class="text-[13px] font-extrabold tracking-wide ${active ? 'text-white' : wouldExceed ? 'text-white/40' : 'text-white'}">${r.label}</span><span class="text-[10px] font-bold tracking-[0.14em] ${active ? 'text-white/80' : wouldExceed ? 'text-white/30' : sideColor}">${r.side}${wouldExceed?' • MAX':''}</span></button>`;
  }).join('');
  return `
    <div id="panel-extra-roles">
      <h4 class="font-extrabold text-white text-sm">Extra roles</h4>
      <p class="text-xs text-white/50 mt-1 leading-snug">Merlin and the Assassin are always dealt. Tap to add the rest. (${enabledEvil}/${maxEvil} evil max for ${playerCount}p)</p>
      <div class="grid grid-cols-2 gap-2.5 mt-3">${buttons}</div>
      <div class="mt-3 rounded-xl bg-amber-400/10 border border-amber-400/20 p-2.5 flex gap-2.5">
        <span class="text-amber-300 text-xs mt-0.5">ⓘ</span>
        <p class="text-xs leading-snug text-amber-100/80"><span class="font-bold text-amber-200">Heads up:</span> Percival sees Merlin (Morgana fools him). Mordred hides from Merlin. Oberon is isolated.</p>
      </div>
      <div class="mt-4 flex items-center justify-between">
        <span class="text-xs font-bold tracking-widest text-white/60">${playerCount}/10 players</span>
        <span class="text-xs text-white/30">Tap avatar ✕ to kick</span>
      </div>
    </div>
  `;
}
