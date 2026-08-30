/**
 * js/ui/components.js — Pure render helpers for Quest Track, Player Grid, Proposal Tracker, Timer, etc.
 * Each export is a function (publicState, dispatch) => HTML string or DOM helper.
 * No state mutation, no side effects beyond string generation.
 * Updated for Table Party blended lobby + extra roles.
 */

import { ALLEGIANCE, EXTRA_ROLES, getEffectiveExtraRoles, getRoleList, allegianceOf } from '../config.js';

// ——— Quest Track ———
export function renderQuestTrack(pub) {
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] backdrop-blur-xl p-4 sm:p-5 shadow-xl">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-display font-bold text-[13px] tracking-[0.14em] text-white">QUEST PROGRESS</h3>
        <span class="text-xs font-medium text-stone-400">${pub.quests.filter(q=>q.status!=='PENDING').length}/5 completed</span>
      </div>
      <div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-thin pb-2">
        ${pub.quests.map((q,i) => `
          <div class="contents">
            ${renderSingleNode(q, i, pub)}
          </div>
        `).join('')}
      </div>
      <div class="mt-3 flex items-center gap-2 text-[11px]">
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-good"></span> Good</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-evil"></span> Evil</span>
        <span class="ml-auto text-stone-500 hidden sm:inline">Quest 4 with 7+ needs 2 fails</span>
      </div>
    </div>
  `;
}

function renderSingleNode(q, i, pub) {
  const isActive = i === pub.currentQuest && pub.phase !== 'GAME_OVER' && pub.phase !== 'ASSASSINATION';
  const statusCls = q.status === 'SUCCESS' ? 'success' : q.status === 'FAIL' ? 'fail' : 'bg-white/[0.04] border-white/[0.08]';
  const activeCls = isActive ? 'active' : '';
  const label = q.status === 'PENDING' ? `${q.size}` : q.status === 'SUCCESS' ? '✓' : '✕';
  const failBadge = q.failsRequired > 1 ? `<span class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 text-obsidian text-[10px] font-extrabold flex items-center justify-center border border-white/20">2×</span>` : '';
  return `
    <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
      <div class="quest-node ${statusCls} ${activeCls} border-2 relative w-[74px] sm:w-[84px] h-[88px] sm:h-[92px] rounded-2xl flex flex-col items-center justify-center gap-1">
        ${failBadge}
        <span class="text-[10px] font-bold tracking-[0.14em] ${q.status==='PENDING' ? 'text-stone-400' : 'text-white/80'}">QUEST ${i+1}</span>
        <span class="w-9 h-9 rounded-xl ${q.status==='PENDING' ? 'bg-white/[0.06] border border-white/[0.08]' : 'bg-white/20 border border-white/30'} flex items-center justify-center font-display font-extrabold text-[16px] text-white">${label}</span>
        <span class="text-[11px] font-medium ${q.status==='FAIL' ? 'text-white/80' : q.status==='SUCCESS' ? 'text-white/70' : 'text-stone-500'}">${q.failCount!=null ? `${q.failCount} fail` : `${q.size} req`}</span>
        ${isActive ? '<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-gold"></span>' : ''}
      </div>
      ${i < 4 ? `<div class="w-3 sm:w-5 h-1 rounded-full ${q.status==='SUCCESS' ? 'bg-good/60' : q.status==='FAIL' ? 'bg-evil/60' : 'bg-white/10'}"></div>` : ''}
    </div>
  `;
}

// ——— Proposal Tracker ———
export function renderProposalTracker(pub) {
  const dots = Array.from({ length: 5 }, (_, i) => {
    const filled = i < pub.proposalTracker;
    return `<div class="tracker-dot ${filled ? 'filled' : 'pending'} w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-bold ${filled ? 'text-white' : 'text-stone-500'}">${filled ? '✕' : i+1}</div>`;
  }).join('');
  const danger = pub.proposalTracker >= 3;
  return `
    <div class="rounded-2xl ${danger ? 'bg-evil/10 border-evil/30' : 'bg-white/[0.04] border-white/[0.08]'} border p-3 sm:p-4 backdrop-blur">
      <div class="flex items-center justify-between">
        <h4 class="font-bold text-[11px] tracking-[0.14em] ${danger ? 'text-evil' : 'text-stone-400'}">PROPOSAL TRACKER</h4>
        <span class="text-xs font-mono font-bold ${danger ? 'text-evil' : 'text-stone-300'}">${pub.proposalTracker}/5</span>
      </div>
      <div class="flex items-center gap-1.5 mt-3">${dots}</div>
      <p class="text-[11px] ${danger ? 'text-evil/80' : 'text-stone-500'} mt-2 leading-snug">${danger ? '⚠️ One more reject and Evil wins by deadlock!' : '5 rejected proposals → Evil wins. Resets after each quest.'}</p>
    </div>
  `;
}

// ——— Timer (circular, view-only) ———
export function renderTimer(pub, remainingSec, totalSec) {
  const pct = totalSec > 0 ? remainingSec / totalSec : 0;
  const dash = 2 * Math.PI * 22;
  const offset = dash * (1 - pct);
  const warn = remainingSec <= 15;
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-4 flex items-center gap-4 backdrop-blur">
      <div class="relative w-14 h-14 shrink-0">
        <svg width="56" height="56" viewBox="0 0 56 56" class="w-14 h-14">
          <circle cx="28" cy="28" r="22" fill="none" stroke-width="4" class="timer-ring-bg"/>
          <circle cx="28" cy="28" r="22" fill="none" stroke-width="4" stroke-linecap="round"
            class="timer-ring-fg ${warn ? 'warn' : ''} timer-ring"
            stroke-dasharray="${dash}" stroke-dashoffset="${offset}" />
        </svg>
        <span class="absolute inset-0 flex items-center justify-center font-mono font-bold text-sm ${warn ? 'text-evil' : 'text-white'}">${remainingSec}s</span>
      </div>
      <div class="min-w-0">
        <p class="text-[11px] font-bold tracking-[0.14em] text-stone-400">TURN TIMER</p>
        <p class="text-sm font-medium text-white leading-tight">${timerLabel(pub.phase)}</p>
        <p class="text-xs text-stone-500">View-only • auto-advances on expiry</p>
      </div>
    </div>
  `;
}

function timerLabel(phase) {
  if (phase === 'TEAM_PROPOSAL') return 'Leader is choosing team';
  if (phase === 'TEAM_VOTE') return 'Voting on team';
  if (phase === 'QUEST_VOTE') return 'Quest voting (secret)';
  if (phase === 'ASSASSINATION') return 'Assassin is deciding';
  return 'Waiting';
}

// ——— Player Grid ———
export function renderPlayerGrid(pub, selectedIds = []) {
  const cards = pub.players.map(p => {
    const isLeader = p.isLeader;
    const isSelected = selectedIds.includes(p.id);
    const onTeam = pub.proposal.teamIds.includes(p.id);
    const vote = pub.proposal.revealed ? pub.proposal.votes[p.id] : null;
    const voteBadge = vote ? `<span class="vote-badge absolute -top-2 -right-2 px-2 py-1 rounded-full text-[11px] font-extrabold border ${vote==='APPROVE' ? 'bg-good text-obsidian border-good' : 'bg-evil text-white border-evil'} shadow">${vote==='APPROVE' ? '✓ APPROVE' : '✕ REJECT'}</span>` : '';
    const teamBadge = onTeam ? `<span class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-cyan-500 text-white text-[11px] font-bold border border-white/20 shadow">ON TEAM</span>` : '';
    return `
      <div data-player-id="${p.id}" class="player-card relative rounded-2xl bg-white/[0.05] border ${isSelected ? 'border-gold' : isLeader ? 'border-gold/40' : 'border-white/[0.08]'} p-3 sm:p-4 flex flex-col items-center text-center gap-2.5 ${isSelected ? 'selected' : ''} ${isLeader ? 'leader' : ''} ${onTeam ? 'on-team' : ''} cursor-pointer select-none">
        ${voteBadge}
        <div class="relative">
          <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 flex items-center justify-center font-display font-extrabold text-lg text-white shadow-inner">
            ${escape(p.name[0] || '?')}
          </div>
          ${isLeader ? '<span class="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-gold text-obsidian flex items-center justify-center text-[13px] shadow shadow-gold/30 border border-white/20">👑</span>' : ''}
          ${p.isBot ? '<span class="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold tracking-wide text-stone-300">BOT</span>' : ''}
        </div>
        <div class="min-w-0 w-full">
          <p class="font-semibold text-sm text-white truncate-name" title="${escape(p.name)}">${escape(p.name)}</p>
          <p class="text-[11px] font-medium tracking-wide ${isLeader ? 'text-gold' : 'text-stone-500'}">${isLeader ? 'LEADER' : p.isBot ? 'AI Player' : 'Human'}</p>
        </div>
        ${teamBadge}
      </div>
    `;
  }).join('');

  return `
    <div class="rounded-2xl bg-[#0f172a]/60 border border-white/[0.06] p-4 sm:p-5 backdrop-blur">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-display font-bold text-[13px] tracking-[0.14em] text-white">ROUND TABLE</h3>
        <span class="text-xs text-stone-500">${pub.players.length} players • Leader picks ${pub.quests[pub.currentQuest]?.size ?? '?'} </span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-3.5">
        ${cards}
      </div>
    </div>
  `;
}

// ——— NEW: Table Party Lobby (screenshot-faithful, blended) ———
export function renderLobby(ctx) {
  // ctx: { roomCode, playersDraft, extraRoles, myName, inviteLink, viewMode }
  const roomCode = ctx.roomCode || '----';
  const players = ctx.playersDraft || [];
  const extra = ctx.extraRoles || {};
  const myName = ctx.myName || players[0]?.name || 'YOU';
  const myId = ctx.myId || null;
  const isJoiner = !!ctx.isJoiner;
  const joinedName = ctx.joinedName || myName;
  const joinedId = ctx.joinedId || ctx.myId || null;
  const need = Math.max(0, 5 - players.length);
  const canStart = !isJoiner && players.length >= 5 && players.length <= 10;
  const inviteLink = ctx.inviteLink || '';

  // Avatar bubbles — show up to 10, with YOU badge on first human, plus dashed waiting slots
  const maxShow = 10;
  const avatars = players.map((p, i) => {
    const isYou = isJoiner ? (p.id ? p.id===joinedId : p.name===joinedName) : (p.id ? p.id===myId : i===0);
    const color = isYou ? 'border-emerald-400' : 'border-white/15';
    const bg = isYou ? 'bg-gradient-to-br from-amber-200 to-orange-100' : 'bg-gradient-to-br from-slate-600 to-slate-700';
    const botBadge = p.isBot ? '<span class="absolute -bottom-1 -right-1 px-1 py-0 rounded-full bg-white/90 text-[8px] font-extrabold text-black border border-white">BOT</span>' : '';
    const youBadge = isYou ? '<span class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[9px] font-extrabold tracking-widest">YOU</span>' : '';
    const canKick = !isJoiner && players.length > 1 && !isYou;
    const canEdit = isJoiner ? (p.id ? p.id===joinedId : p.name===joinedName) : (p.isBot || isYou);
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

  // Extra roles toggles — enforce evil cap by player count
  const maxEvil = (()=>{ try{ const p = players.length; if(p<=6) return 1; if(p<=8) return 2; return 3; }catch(_){return 3}})();
  const enabledEvil = ['morgana','mordred','oberon'].filter(k=> !!extra[k]).length;
  const roleButtons = EXTRA_ROLES.map(r => {
    const active = !!extra[r.key];
    const isEvil = r.side==='EVIL';
    const wouldExceed = !active && isEvil && enabledEvil >= maxEvil;
    const bg = active ? 'bg-[#3aa8d6] border-[#3aa8d6] text-white' : (wouldExceed ? 'bg-white/[0.03] border-white/10 text-white/30' : 'bg-white/[0.06] border-white/15 text-stone-300' + (isJoiner ? '' : ' hover:bg-white/10'));
    const sideColor = r.side === 'GOOD' ? 'text-cyan-200' : 'text-rose-200';
    const extraAttr = isJoiner ? '' : `data-extra="${r.key}"`;
    const disabled = isJoiner ? 'disabled opacity-60 cursor-not-allowed' : (wouldExceed ? 'disabled opacity-40 cursor-not-allowed' : '');
    const title = wouldExceed ? `Max ${maxEvil} evil extra for ${players.length} players` : '';
    return `
      <button ${extraAttr} ${disabled} title="${title}" class="text-left rounded-full px-3.5 py-2.5 border flex flex-col leading-none ${bg} transition-colors">
        <span class="text-[13px] font-extrabold tracking-wide ${active ? 'text-white' : wouldExceed ? 'text-white/40' : 'text-white'}">${r.label}</span>
        <span class="text-[10px] font-bold tracking-[0.14em] ${active ? 'text-white/80' : wouldExceed ? 'text-white/30' : sideColor}">${r.side}${wouldExceed?' • MAX':''}</span>
      </button>
    `;
  }).join('');

  // Bottom bar text
  const bottomText = isJoiner ? `Waiting for host to start` : (need > 0 ? `Needs ${need} more player${need!==1?'s':''}` : (players.length>10 ? 'Too many players' : 'Ready to quest!'));

  return `
    <div class="max-w-[480px] mx-auto px-4 sm:px-0">
      <!-- Top bar like screenshot -->
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

      <!-- Invite Code Card — screenshot teal -->
      <div class="mt-5 rounded-[24px] bg-[#29546c] border border-white/10 shadow-xl p-6 sm:p-7 text-center relative overflow-hidden">
        <div class="absolute inset-0 opacity-20" style="background: radial-gradient(ellipse at top, rgba(255,255,255,0.15), transparent 60%);"></div>
        <div class="relative">
          <div class="font-display font-black text-[42px] sm:text-[52px] leading-none tracking-[0.18em] text-[#f3ecd8]" style="text-shadow: 0 2px 0 rgba(0,0,0,0.25), 0 8px 24px rgba(0,0,0,0.3);">${escape(roomCode)}</div>
          <p class="text-[13px] text-white/70 mt-2 leading-snug">Friends open <span class="text-white font-semibold">Table Party</span> and tap <span class="text-white font-bold">Join a friend’s game</span></p>
          <button id="btn-share-link" data-link="${escape(inviteLink)}" class="mt-4 px-5 py-2.5 rounded-full bg-[#f3ecd8] hover:bg-white text-[#14364d] text-sm font-extrabold tracking-wide shadow-md transition-colors">
            Share invite link
          </button>
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
          <p class="text-xs text-white/50 mt-1">Host will start when 5+ are ready. Tap your avatar to change your name.</p>
        </div>
      ` : `
        <div class="mt-3 flex gap-2">
          <input id="input-add-player" maxlength="16" placeholder="Bot name"
            class="flex-1 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 text-sm font-medium outline-none focus:border-[#3aa8d6] focus:bg-white/15" />
          <button id="btn-add-bot" class="px-4 py-2.5 rounded-xl bg-[#f3ecd8] hover:bg-white text-[#0e2533] text-sm font-bold">Add Bot</button>
        </div>
        <p class="text-xs text-white/40 mt-1.5 text-center">Tap avatar to edit or kick • Add up to 10 • Works on each player's own device</p>
      `}

      <div class="mt-4 rounded-2xl bg-[#0e2231]/80 border border-white/10 backdrop-blur p-4 shadow-xl">
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-white text-sm">Game options</span>
        </div>
        <div id="panel-extra-roles" class="mt-4 pt-4 border-t border-white/10">
          <h4 class="font-extrabold text-white text-sm">Extra roles</h4>
          <p class="text-xs text-white/50 mt-1 leading-snug">Merlin and the Assassin are always dealt. Tap to add the rest.</p>
          <div class="grid grid-cols-2 gap-2.5 mt-3">
            ${roleButtons}
          </div>
          <div class="mt-3 rounded-xl bg-amber-400/10 border border-amber-400/20 p-2.5 flex gap-2.5">
            <span class="text-amber-300 text-xs mt-0.5">ⓘ</span>
            <p class="text-xs leading-snug text-amber-100/80"><span class="font-bold text-amber-200">Heads up:</span> Percival sees Merlin (Morgana fools him). Mordred hides from Merlin. Oberon is isolated — evil don’t know him.</p>
          </div>
          <div class="mt-4 flex items-center justify-between">
            <span class="text-xs font-bold tracking-widest text-white/60">${players.length}/10 players</span>
            <span class="text-xs text-white/30">Tap avatar ✕ to kick</span>
          </div>
        </div>
      </div>

      <!-- Blend: show quest track preview in lobby (small) -->
      <div class="mt-4 rounded-2xl bg-[#0f172a]/40 border border-white/10 p-3">
        <p class="text-xs font-bold tracking-widest text-white/60">QUEST PREVIEW</p>
        <p class="text-xs text-white/40 mt-1">5 quests • Fail threshold: 1 (Quest 4 needs 2 with 7+)</p>
        <div class="mt-2 flex gap-1.5 justify-center">
          ${[2,3,2,3,3].map((s,i)=>`<span class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold text-white/70">${s}</span>`).join('')}
        </div>
      </div>

      <div class="h-28"></div>
    </div>

    <!-- Bottom sticky bar — like screenshot -->
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

export function renderPrivateRole(pub, myId) {
  // Per-device private role view — replaces Pass & Play
  const me = pub.players.find(p=>p.id===myId) || pub.players[0];
  // This will be handled by modals, but we provide an inline card for the waiting room
  const isRevealed = me ? pub.revealed[pub.players.findIndex(p=>p.id===myId)] : false;
  const allRevealed = pub.revealed.every(Boolean);
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-6 text-center shadow-xl max-w-[560px] mx-auto">
      <div class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-2xl">🛡️</div>
      <h2 class="font-display font-extrabold text-xl text-white mt-3">YOUR ROLE IS SECURE</h2>
      <p class="text-sm text-stone-400 mt-2">On your device, tap to reveal. No one else can see it — even the host.</p>
      <div class="mt-5 rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
        <p class="text-xs tracking-widest font-bold text-stone-500">YOU ARE</p>
        <p class="font-display font-extrabold text-2xl text-white mt-1">${escape(me?.name || 'You')}</p>
        <p class="text-sm ${isRevealed ? 'text-emerald-400' : 'text-amber-300'} mt-1">${isRevealed ? '✓ You have viewed' : 'Tap below to reveal privately'}</p>
      </div>
      <button id="btn-private-reveal" data-myid="${me?.id || ''}" class="mt-4 w-full py-3.5 rounded-xl bg-gold text-obsidian font-extrabold hover:bg-amber-300 shadow-lg shadow-gold/20">
        ${isRevealed ? 'VIEW AGAIN (private)' : 'TAP TO REVEAL YOUR ROLE'}
      </button>
      <p class="text-xs text-stone-500 mt-2">${pub.revealed.filter(Boolean).length}/${pub.players.length} players have viewed</p>
      ${allRevealed ? '<p class="text-emerald-300 text-sm font-bold mt-3">All viewed — quest will begin automatically</p>' : '<p class="text-stone-500 text-xs mt-3">Waiting for others on their devices…</p>'}
    </div>
  `;
}

export function renderRoleReveal(pub) {
  // Kept for backward compat — now delegates to private view for first player
  const current = pub.players[pub.revealIndex];
  const viewed = pub.revealed[pub.revealIndex];
  const progress = pub.revealed.filter(Boolean).length;
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] backdrop-blur-xl p-6 sm:p-8 text-center shadow-xl">
      <h2 class="font-display font-extrabold text-xl text-white">ROLE DISCOVERY (distributed)</h2>
      <p class="text-sm text-stone-400 mt-2">Each player now reveals on their own device. Use the View As switcher to preview.</p>
      <div class="mt-6 rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 max-w-[420px] mx-auto">
        <p class="text-xs tracking-[0.14em] font-bold text-stone-500">PROGRESS</p>
        <p class="text-sm text-stone-300 mt-1">${progress}/${pub.players.length} viewed</p>
        <div class="mt-3 flex items-center justify-center gap-1.5">
          ${pub.players.map((_,i)=>`<span class="h-1.5 rounded-full transition-all ${pub.revealed[i] ? 'w-6 bg-good' : 'w-4 bg-white/15'}"></span>`).join('')}
        </div>
      </div>
      <div class="mt-6 flex justify-center">
        <button id="btn-view-role" class="px-6 py-3.5 rounded-xl bg-gold text-obsidian font-extrabold">View as ${escape(current?.name || '')}</button>
      </div>
    </div>
  `;
}

function escape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ——— EXACT TABLE PARTY REPLICATION ———

export function renderExactHeader(current, total) {
  return `
    <div class="flex items-center justify-between px-1">
      <button id="btn-exact-back" class="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/70 text-lg">‹</button>
      <h1 class="font-display font-bold text-white text-[15px] tracking-wide">Quest of Shadows</h1>
      <div class="flex gap-2 items-center">
        <span class="px-3 py-1 rounded-full bg-[#1e4a62] border border-white/15 text-[#7ec8e6] text-xs font-bold">${current}/${total}</span>
        <button id="btn-exact-rules" class="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/70">?</button>
      </div>
    </div>
  `;
}

export function renderExactQuestTrack(pub) {
  const sizes = pub.quests.map(q=> q.size);
  // For lobby preview, sizes are [2,3,2,3,3] etc. For in-game, use pub.quests
  const currentQuest = pub.currentQuest;
  const circles = sizes.map((s,i)=>{
    const isCurrent = i===currentQuest;
    const status = pub.quests[i]?.status;
    let bg = 'bg-white/5 border-white/15 text-white/60';
    if (status==='SUCCESS') bg='bg-emerald-500 border-emerald-400 text-white';
    else if (status==='FAIL') bg='bg-rose-500 border-rose-400 text-white';
    else if (isCurrent) bg='bg-[#3aa8d6]/20 border-[#3aa8d6] text-white ring-2 ring-[#3aa8d6]/40';
    return `<div class="w-9 h-9 rounded-full border-2 ${bg} flex items-center justify-center text-sm font-black">${s}</div>`;
  }).join('');
  const rejectedDots = Array.from({length:5}, (_,i)=>{
    const filled = i < pub.proposalTracker;
    return `<span class="w-2 h-2 rounded-full ${filled?'bg-rose-500':'bg-white/20'} border border-white/10"></span>`;
  }).join('');
  const label = pub.proposalTracker>=5 ? 'FAILED' : pub.proposalTracker>0 ? 'REJECTED' : 'REJECTED';
  return `
    <div class="rounded-2xl bg-[#0f2231]/60 border border-white/10 p-3">
      <div class="flex justify-center gap-2">${circles}</div>
      <div class="flex justify-center items-center gap-1.5 mt-2">
        <span class="text-xs font-bold tracking-widest text-white/40">${label}</span>
        <span class="flex gap-1">${rejectedDots}</span>
      </div>
    </div>
  `;
}

export function renderExactAllegiance(pub, myId, opts={}) {
  // opts may contain actual private role/allegiance from state (since pub has no role for anti-leakage)
  let role = opts.role || 'LOYAL';
  let allegiance = opts.allegiance || 'GOOD';
  if (!opts.role) {
    const me = pub.players.find(p=> p.id===myId);
    if (me && me.role) { role = me.role; allegiance = me.allegiance || allegiance; }
  }
  const isEvil = allegiance === 'EVIL' || ['ASSASSIN','MORGANA','MORDRED','OBERON','MINION'].includes(role);
  const allegianceLabel = isEvil ? 'Sworn to evil' : 'Loyal to Arthur';
  const allegianceColor = isEvil ? 'text-[#ff6b6b]' : 'text-[#5eead4]';
  const roleLabel = {
    'MERLIN':'Merlin',
    'PERCIVAL':'Percival',
    'LOYAL':'Loyal Servant',
    'ASSASSIN':'The Assassin',
    'MORGANA':'Morgana',
    'MORDRED':'Mordred',
    'OBERON':'Oberon',
    'MINION':'Minion'
  }[role] || role;
  const roleDesc = {
    'MERLIN':'You see the servants of evil. Guide Arthur without being found.',
    'PERCIVAL':'You see Merlin. Protect him, but Morgana may fool you.',
    'LOYAL':'Nobody told you anything. Everything you learn, you learn at this table.',
    'ASSASSIN':'If good takes three quests, you get one shot at naming Merlin.',
    'MORGANA':'To Percival you look exactly like Merlin. Be worth believing.',
    'MORDRED':'You are hidden from Merlin. Stay in the shadows.',
    'OBERON':'You see no one, and no one sees you.',
    'MINION':'You know your fellow evil. Sabotage from within.'
  }[role] || '';
  return `
    <div class="rounded-2xl bg-[#142a3d]/80 border border-white/10 p-5 text-center">
      <p class="text-xs font-bold tracking-[0.18em] text-[#7ec8e6]">YOUR ALLEGIANCE</p>
      <p class="font-display font-black text-[28px] leading-none ${allegianceColor} mt-1">${escape(allegianceLabel)}</p>
      <div class="w-12 h-0.5 bg-white/10 mx-auto my-3"></div>
      <h2 class="font-display font-bold text-[22px] text-white leading-none">${escape(roleLabel)}</h2>
      <p class="text-sm text-white/60 mt-1.5 leading-snug max-w-[320px] mx-auto">${escape(roleDesc)}</p>
    </div>
  `;
}

export function renderExactVision(pub, myId) {
  // For exact, we need vision info — caller will provide via getVision
  // This is a placeholder that app.js will fill with actual names
  // We keep it generic here and let app.js pass HTML
  return ``;
}

export function renderExactTableSummary(pub) {
  const total = pub.players.length;
  const effective = getEffectiveExtraRoles(total, pub.extraRoles || {});
  let roles = [];
  try { roles = getRoleList(total, effective); } catch(_) { roles = []; }
  const good = roles.filter(r=> allegianceOf(r)==='GOOD').length || (total - Math.ceil(total*0.4));
  const evil = roles.length ? roles.length - good : Math.ceil(total*0.4);
  // For display, loyal = total good (includes Merlin/Percival) as per screenshot wording
  const loyal = good;
  // Pill list should reflect effective roles (capped)
  const pills = [];
  if (true) pills.push('Merlin');
  if (effective.percival) pills.push('Percival');
  pills.push('The Assassin');
  if (effective.morgana) pills.push('Morgana');
  if (effective.mordred) pills.push('Mordred');
  if (effective.oberon) pills.push('Oberon');
  return `
    <div class="text-center mt-3">
      <p class="text-sm text-white/70">${total} at the table — ${loyal} loyal, ${evil} sworn to evil.</p>
      <div class="flex flex-wrap justify-center gap-1.5 mt-2">
        ${pills.map(p=> `<span class="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs font-bold text-white/70">${escape(p)}</span>`).join('')}
      </div>
    </div>
  `;
}

export function renderExactAvatarRow(pub, myId, statusMap) {
  // statusMap: {playerId: 'READY'|'READING'}
  const avatars = pub.players.map(p=>{
    const isYou = p.id===myId;
    const status = statusMap ? (statusMap[p.id] || (pub.revealed && pub.revealed[pub.players.findIndex(x=>x.id===p.id)] ? 'READY' : 'READING')) : 'READY';
    const isReady = status==='READY';
    const bg = isYou ? 'bg-[#f3ecd8] text-black' : (p.isBot ? 'bg-[#ff6b6b] text-black' : 'bg-[#2a3a4a] text-white/60');
    const initials = escape((p.name||'??').slice(0,2).toUpperCase());
    const border = isReady ? 'border-emerald-400' : 'border-white/15';
    const dot = isReady ? '<span class="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#0a1e2e] flex items-center justify-center text-[10px] text-white">✓</span>' : '';
    return `
      <div class="flex flex-col items-center gap-1 min-w-[56px]">
        <div class="relative w-12 h-12 rounded-full ${bg} border-2 ${border} flex items-center justify-center font-black text-sm">
          ${initials}
          ${dot}
        </div>
        <div class="flex flex-col items-center leading-none">
          <span class="text-xs font-bold ${isYou?'text-white':'text-white/70'} truncate max-w-[72px] text-center">${escape(p.name)}</span>
          ${isYou?'<span class="mt-1 px-2 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[8px] font-black leading-none tracking-wide border border-[#0a1e2e]/10">YOU</span>':''}
        </div>
        <span class="text-[10px] font-black tracking-widest ${isReady?'text-emerald-400':'text-white/30'}">${status}</span>
      </div>
    `;
  }).join('');
  return `<div class="flex gap-3 overflow-x-auto scrollbar-thin pb-1 justify-start sm:justify-center">${avatars}</div>`;
}

export function renderExactBottomButton(text, id, opts={}) {
  const variant = opts.variant || 'primary'; // primary = light blue, danger = red, ghost
  let cls = 'w-full py-4 rounded-full bg-[#7ec8e6] hover:bg-[#a0d8ef] text-[#0a1e2e] font-black tracking-wide shadow-xl';
  if (variant==='danger') cls='w-full py-4 rounded-full bg-[#1a2a3a] border border-rose-400/50 text-rose-300 font-bold';
  if (variant==='ghost') cls='w-full py-4 rounded-full bg-white/5 border border-white/10 text-white/70 font-bold';
  const disabled = opts.disabled ? 'disabled opacity-50 cursor-not-allowed' : '';
  return `<button id="${id}" ${disabled} class="${cls} transition-colors">${escape(text)}</button>`;
}

// ——— TABLE PARTY HOME (Pick a game) ———
export const HOME_GAMES = [
  { id:'quest-of-shadows', title:'Quest of Shadows', subtitle:'Good outnumbers evil, but evil knows...', desc:'Good outnumbers evil, but evil knows exactly who everyone is. Merlin knows too — and has to spend the whole game making sure nobody works out that he does.', inspired:'Inspired by The Resistance: Avalon', icon:'🗡️', iconBg:'bg-[#2a4a5a]', players:'5-10', time:'15-25', type:'Deduction', enabled:true },
  { id:'fake-answers', title:'Fake Answers', subtitle:'Inspired by Psych!', players:'3-12', time:'10 min', icon:'🔥', iconBg:'bg-[#3a2a1a]', enabled:false },
  { id:'boggle', title:'Boggle', subtitle:'Shake. Hunt. Don\'t match.', players:'1-12', time:'10 min', icon:'🎲', iconBg:'bg-[#2a3a1a]', enabled:false },
  { id:'quip', title:'Quip Battle', subtitle:'Inspired by Quiplash', players:'3-12', time:'15 min', icon:'💬', iconBg:'bg-[#1a3a4a]', enabled:false },
];

export function renderHome(searchQuery='') {
  const q = (searchQuery||'').toLowerCase().trim();
  const filtered = !q ? HOME_GAMES : HOME_GAMES.filter(g=> g.title.toLowerCase().includes(q) || g.subtitle.toLowerCase().includes(q));
  const gamesCount = filtered.length;
  return `
    <div class="min-h-screen bg-[#0f0a1a] -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 sm:-mt-8">
      <div class="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <!-- TableParty header -->
        <div class="text-center pt-2">
          <p class="font-display font-bold text-xs tracking-[0.18em] text-white/60">Table Party</p>
          <h1 class="font-display font-extrabold text-[36px] sm:text-[48px] leading-none text-[#f5f0e8] mt-1">Pick a game</h1>
          <p class="text-sm text-white/60 mt-1">Good games. Great people.</p>
        </div>
        <!-- Join a friend banner -->
        <button id="btn-home-join-banner" class="mt-6 w-full flex items-center justify-between px-4 sm:px-5 py-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.08] border border-white/10 text-left transition-colors">
          <span class="font-bold text-white text-sm sm:text-base">Join a friend's game</span>
          <span class="text-xs text-white/50 flex items-center gap-1">Have a code? Walk right in <span class="text-sm">›</span></span>
        </button>
        <!-- Search -->
        <div class="mt-4 flex gap-2">
          <div class="flex-1 relative">
            <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30">⌕</span>
            <input id="input-home-search" value="${escape(searchQuery)}" placeholder="Search games" class="w-full pl-9 pr-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white placeholder:text-white/30 text-sm outline-none focus:border-white/20 focus:bg-white/[0.08]" />
          </div>
          <button class="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/40 hover:text-white/60">⚙</button>
        </div>
        <!-- All games header -->
        <div class="mt-6 flex items-center justify-between">
          <h2 class="font-bold text-white text-sm">All games</h2>
          <span class="text-xs text-white/30">${gamesCount} games</span>
        </div>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${filtered.map(g=> `
            <button data-game-id="${g.id}" ${g.enabled?'':'disabled'} class="text-left rounded-2xl bg-white/[0.04] hover:${g.enabled?'bg-white/[0.08]':'bg-white/[0.04]'} border border-white/[0.06] p-3 flex items-center gap-3 ${g.enabled?'cursor-pointer':'opacity-60 cursor-not-allowed'} transition-colors">
              <div class="w-12 h-12 rounded-xl ${g.iconBg} border border-white/10 flex items-center justify-center text-xl shrink-0">${g.icon}</div>
              <div class="min-w-0 flex-1">
                <p class="font-bold text-white text-sm leading-none">${escape(g.title)}</p>
                <p class="text-xs ${g.enabled?'text-[#7ec8e6]':'text-white/40'} mt-0.5 truncate">${escape(g.subtitle)}</p>
                <p class="text-xs text-white/30 mt-0.5">${g.players} players · ${g.time} min</p>
              </div>
              <span class="text-white/20 text-sm">›</span>
            </button>
          `).join('')}
        </div>
        ${filtered.length===0 ? `<p class="text-center text-sm text-white/30 mt-8">No games match "${escape(searchQuery)}"</p>` : ''}
      </div>
    </div>
  `;
}

export function renderGamePopup(hostName='') {
  return `
    <div id="game-popup-overlay" class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="relative w-full max-w-[420px] rounded-[28px] bg-[#1e1a2e] border border-white/10 shadow-2xl overflow-hidden p-6 text-center">
        <button id="btn-popup-close" class="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/60">✕</button>
        <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#2a4a6a] to-[#1a3a5a] border border-white/10 flex items-center justify-center text-3xl">🗡️</div>
        <h2 class="font-display font-extrabold text-[22px] text-white mt-3 leading-none">Quest of Shadows</h2>
        <p class="text-sm text-white/70 mt-2 leading-snug">Good outnumbers evil, but evil knows exactly who everyone is. Merlin knows too — and has to spend the whole game making sure nobody works out that he does.</p>
        <p class="text-xs italic text-white/30 mt-2">Inspired by The Resistance: Avalon</p>
        <div class="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded-2xl bg-black/20 border border-white/5 py-3">
          <div class="text-center">
            <p class="font-black text-white text-sm">5-10</p>
            <p class="text-[10px] tracking-widest font-bold text-white/40">PLAYERS</p>
          </div>
          <div class="text-center">
            <p class="font-black text-white text-sm">15-25</p>
            <p class="text-[10px] tracking-widest font-bold text-white/40">MINUTES</p>
          </div>
          <div class="text-center">
            <p class="font-black text-white text-sm">Deduction</p>
            <p class="text-[10px] tracking-widest font-bold text-white/40">TYPE</p>
          </div>
        </div>
        <div class="mt-4">
          <input id="popup-host-name" maxlength="16" placeholder="Your name (host)" value="${escape(hostName)}" class="w-full px-3.5 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 text-sm font-medium outline-none focus:border-[#7ec8e6] text-center" />
          <p class="text-xs text-white/30 mt-1">You can change this and add bots in the lobby</p>
        </div>
        <button id="btn-popup-play" class="mt-4 w-full py-3.5 rounded-full bg-gradient-to-b from-[#a0d8f0] to-[#7ec8e6] hover:from-[#b0e0f5] hover:to-[#8ed0ea] text-[#0a1e2e] font-black tracking-wide shadow-lg">Play now</button>
        <button id="btn-popup-howto" class="mt-3 w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.08] border border-white/10 text-left">
          <span class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full bg-[#7ec8e6] flex items-center justify-center text-[#0a1e2e] text-xs">▶</span>
            <span>
              <p class="font-bold text-white text-sm leading-none">How to play</p>
              <p class="text-xs text-white/40">4 animated steps</p>
            </span>
          </span>
          <span class="text-white/30">›</span>
        </button>
        <button id="btn-popup-join" class="mt-3 w-full py-3.5 rounded-full bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white font-bold">Join a friend's game</button>
      </div>
    </div>
  `;
}

export function renderJoinCodeScreen(code='') {
  const clean = (code||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
  const display = (clean + '----').slice(0,4).split('').map(ch=> ch==='-' ? '<span class="text-white/20">—</span>' : escape(ch)).join('<span class="w-2"></span>');
  const canEnter = clean.length===4;
  return `
    <div class="min-h-[80vh] flex flex-col bg-[#0f0a1a] -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 sm:-mt-8">
      <div class="max-w-[600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 flex-1 flex flex-col">
        <div class="flex items-center justify-between">
          <button id="btn-join-back" class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/60">‹</button>
          <p class="font-display font-bold text-sm tracking-wide text-white/80">Table Party</p>
          <div class="w-9"></div>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center text-center">
          <h1 class="font-display font-black text-[32px] text-white leading-none">Join a friend</h1>
          <p class="text-sm text-white/50 mt-2">Ask them for their four-letter game code.</p>
          <div class="mt-6 relative">
            <div id="join-code-display" class="w-[280px] h-[64px] rounded-2xl bg-black/20 border border-white/10 flex items-center justify-center gap-2 text-[28px] font-black tracking-[0.4em] text-white">
              ${clean ? clean.split('').map(ch=> `<span>${escape(ch)}</span>`).join('<span class="w-1"></span>') : '<span class="text-white/20 tracking-[0.6em]">----</span>'}
            </div>
            <input id="input-join-code" maxlength="4" value="${escape(clean)}" placeholder="" class="absolute inset-0 opacity-0 w-full h-full text-center uppercase tracking-[0.5em] text-transparent caret-transparent" autocomplete="off" autocapitalize="characters" />
          </div>
          <p id="join-code-error" class="text-xs text-rose-400 mt-3 h-4"></p>
        </div>
        <button id="btn-join-enter" ${canEnter?'':'disabled'} class="w-full py-4 rounded-full ${canEnter?'bg-emerald-500 hover:bg-emerald-400 text-white font-black border border-emerald-500 cursor-pointer':'bg-white/10 text-white/30 font-bold cursor-not-allowed border border-white/5'} transition-colors">Enter the code</button>
      </div>
    </div>
  `;
}
