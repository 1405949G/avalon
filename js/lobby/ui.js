/**
 * js/lobby/ui.js — Generic Table Party lobby shell
 * Renders invite card, avatar row, player count. Delegates game-specific options to game module.
 */
import { EXTRA_ROLES } from '../games/avalon/config.js'; // fallback, real per-game via registry

export function renderLobbyShell(ctx) {
  // ctx: { roomCode, playersDraft, extraRoles, myName, myId, inviteLink, isJoiner, joinedName, gameId, gameOptions, renderGameOptions }
  // This is the generic shell — game-specific options are injected via ctx.renderGameOptions()
  const roomCode = ctx.roomCode || '----';
  const players = ctx.playersDraft || [];
  const extra = ctx.extraRoles || ctx.gameOptions || {};
  const need = Math.max(0, 5 - players.length);
  const canStart = !ctx.isJoiner && players.length >= 5 && players.length <= 10;
  const inviteLink = ctx.inviteLink || '';
  const isJoiner = !!ctx.isJoiner;

  // Use generic avatar rendering — same as before but now id-aware
  const avatars = players.map((p, i) => {
    const isYou = isJoiner ? (p.id ? p.id===ctx.myId : p.name===ctx.joinedName) : (p.id ? p.id===ctx.myId : i===0);
    const color = isYou ? 'border-emerald-400' : 'border-white/15';
    const bg = isYou ? 'bg-gradient-to-br from-amber-200 to-orange-100' : 'bg-gradient-to-br from-slate-600 to-slate-700';
    const botBadge = p.isBot ? '<span class="absolute -bottom-1 -right-1 px-1 py-0 rounded-full bg-white/90 text-[8px] font-extrabold text-black border border-white">BOT</span>' : '';
    const canKick = !isJoiner && players.length > 1 && !isYou;
    const canEdit = isJoiner ? (p.id ? p.id===ctx.myId : p.name===ctx.joinedName) : (p.isBot || isYou);
    const editAttr = canEdit ? `data-edit-idx="${i}"` : '';
    const kickBtn = canKick ? `<button data-kick-idx="${i}" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 hover:bg-evil border border-white/20 flex items-center justify-center text-white text-[9px] leading-none opacity-90 hover:opacity-100 transition-opacity" title="Kick">✕</button>` : '';
    return `
      <div class="flex flex-col items-center gap-1.5 relative group">
        <div ${editAttr} class="relative w-[56px] h-[56px] sm:w-[60px] sm:h-[60px] rounded-full border-2 ${color} ${bg} flex items-center justify-center text-lg font-extrabold ${isYou ? 'text-[#0a1e2e]' : 'text-white'} shadow-md ${canEdit?'cursor-pointer hover:scale-105':'cursor-default'} transition-transform">
          ${p.name ? escape(p.name[0].toUpperCase()) : '?'}
          ${botBadge}
          ${kickBtn}
        </div>
        <div class="flex flex-col items-center leading-none">
          <span class="text-xs font-bold text-white truncate max-w-[64px] text-center">${escape(p.name || 'Player')}</span>
          ${isYou?'<span class="mt-1 px-2 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[8px] font-black tracking-wide leading-none border border-[#0a1e2e]/10">YOU</span>':''}
        </div>
        ${isYou ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-0 right-1 border-2 border-[#0e2533]"></span>' : ''}
      </div>
    `;
  }).join('');

  const waitingSlots = Math.max(0, Math.min(10, Math.max(1, 5 - players.length)));
  const waiting = Array.from({length: waitingSlots}, () => `
    <div class="flex flex-col items-center gap-1.5">
      <div class="w-[56px] h-[56px] sm:w-[60px] sm:h-[60px] rounded-full border-2 border-dashed border-white/25 bg-white/[0.03] flex items-center justify-center">
        <span class="w-6 h-0.5 bg-white/20 rounded-full"></span>
      </div>
      <span class="text-xs font-medium text-stone-500">Waiting...</span>
    </div>
  `).join('');

  const bottomText = isJoiner ? `Waiting for host to start` : (need > 0 ? `Needs ${need} more player${need!==1?'s':''}` : (players.length>10 ? 'Too many players' : 'Ready to quest!'));

  // Game picker — host can change game without remaking lobby
  const gamePicker = !isJoiner ? `
    <div class="mt-4 rounded-2xl bg-[#0e2231]/80 border border-white/10 p-4">
      <div class="flex items-center justify-between">
        <span class="font-extrabold text-white text-sm">Game</span>
        <select id="select-game" class="px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-white text-xs font-bold">
          <option value="quest-of-shadows" ${ctx.gameId==='quest-of-shadows'?'selected':''}>Quest of Shadows</option>
          <!-- future games injected via registry -->
        </select>
      </div>
      <div id="game-options-slot" class="mt-3">${ctx.renderGameOptions ? ctx.renderGameOptions() : ''}</div>
    </div>
  ` : `
    <div class="mt-4 rounded-2xl bg-[#0e2231]/80 border border-white/10 p-4">
      <div class="flex items-center justify-between">
        <span class="font-extrabold text-white text-sm">Game</span>
        <span class="px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-white text-xs font-bold">${ctx.gameId || 'quest-of-shadows'}</span>
      </div>
      <div id="game-options-slot" class="mt-3 opacity-60">${ctx.renderGameOptions ? ctx.renderGameOptions() : ''}</div>
    </div>
  `;

  return `
    <div class="max-w-[480px] mx-auto px-4 sm:px-0">
      <div class="flex items-center justify-between pt-2">
        <button id="btn-lobby-back" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/70">‹</button>
        <div class="flex flex-col items-center">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-sky-300 to-blue-600 border-2 border-white/20 flex items-center justify-center shadow-lg">🗡️</div>
        </div>
        <button id="btn-lobby-help" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/70">?</button>
      </div>
      <div class="text-center -mt-1">
        <h1 class="font-display font-extrabold text-[22px] tracking-wide text-[#f0e8d0]">Quest of Shadows</h1>
        <p class="text-sm text-white/60 -mt-1 font-medium">Invite your friends</p>
      </div>
      <div class="mt-5 rounded-[24px] bg-[#29546c] border border-white/10 shadow-xl p-6 sm:p-7 text-center relative overflow-hidden">
        <div class="absolute inset-0 opacity-20" style="background: radial-gradient(ellipse at top, rgba(255,255,255,0.15), transparent 60%);"></div>
        <div class="relative">
          <div class="font-display font-black text-[42px] sm:text-[52px] leading-none tracking-[0.18em] text-[#f3ecd8]" style="text-shadow: 0 2px 0 rgba(0,0,0,0.25), 0 8px 24px rgba(0,0,0,0.3);">${escape(roomCode)}</div>
          <p class="text-[13px] text-white/70 mt-2 leading-snug">Friends open <span class="text-white font-semibold">Table Party</span> and tap <span class="text-white font-bold">Join a friend’s game</span></p>
          <button id="btn-share-link" data-link="${escape(inviteLink)}" class="mt-4 px-5 py-2.5 rounded-full bg-[#f3ecd8] hover:bg-white text-[#14364d] text-sm font-extrabold tracking-wide shadow-md transition-colors">Share invite link</button>
          <p class="text-[11px] text-white/40 mt-2 font-mono break-all">${escape(inviteLink)}</p>
        </div>
      </div>
      <div class="mt-5 flex flex-wrap gap-3 sm:gap-4 justify-center">
        ${avatars}
        ${waiting}
      </div>
      ${isJoiner ? `
        <div class="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
          <p class="text-sm font-bold text-emerald-300">You’re in — waiting for host</p>
          <p class="text-xs text-white/50 mt-1">Host will see you appear and can start when 5+ are ready. Tap your avatar to change your name.</p>
        </div>
      ` : `
        <div class="mt-3 flex gap-2">
          <input id="input-add-player" maxlength="16" placeholder="Bot name" class="flex-1 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 text-sm font-medium outline-none focus:border-[#3aa8d6] focus:bg-white/15" />
          <button id="btn-add-bot" class="px-4 py-2.5 rounded-xl bg-[#f3ecd8] hover:bg-white text-[#0e2533] text-sm font-bold">Add Bot</button>
        </div>
        <p class="text-xs text-white/40 mt-1.5 text-center">Tap avatar to edit or kick • Add up to 10 • Works on each player's own device</p>
      `}
      ${gamePicker}
      <div class="h-28"></div>
    </div>
    <div class="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-[#0a1e2e]/90 to-transparent backdrop-blur-sm pointer-events-none">
      <div class="max-w-[480px] mx-auto pointer-events-auto">
        ${canStart
          ? `<button id="btn-start" class="w-full py-4 rounded-full bg-[#f3ecd8] hover:bg-white text-[#0e2533] font-extrabold tracking-wide shadow-xl transition-colors">Start Quest — ${players.length} players</button>`
          : `<div class="w-full py-3.5 rounded-full bg-[#0f2231] border border-white/10 text-center text-white/50 font-bold text-sm shadow-xl">${bottomText}</div>`
        }
        <p class="text-center text-xs text-white/30 mt-2">Each player opens the link on their own device — roles stay private</p>
      </div>
    </div>
  `;
}
function escape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
