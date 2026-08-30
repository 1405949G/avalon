/**
 * js/app.js — Core router (v3) — Distributed play (own devices) + Table Party lobby
 * Each player on own device sees private role, no passing.
 * Keeps pure reducer orchestration + backend abstraction via net.js
 */
import { PHASES, TIMER_SECONDS, REVEAL_ANIM_MS, generateRoomCode, isValidRoomCode, EXTRA_ROLES, getMaxExtraEvil, getEffectiveExtraRoles } from './config.js';
import { getGame } from './games/registry.js';
import { createInitialState, reducer, getPublicState, getPrivateState, getAIView, getVision } from './state.js';
import * as storage from './storage.js';
import * as net from './net.js';
import * as ai from './ai.js';
import { renderLog } from './ui/log.js';
import { renderQuestTrack, renderProposalTracker, renderTimer, renderPlayerGrid, renderPrivateRole, renderRoleReveal, renderExactHeader, renderExactQuestTrack, renderExactAllegiance, renderExactTableSummary, renderExactAvatarRow, renderExactBottomButton, renderHome, renderGamePopup, renderJoinCodeScreen } from './ui/components.js';
import { renderLobby } from './lobby/ui.js';
import { renderAvalonOptions } from './games/avalon/ui.js';
import { showRoleReveal, showQuestVote, showConfirm } from './ui/modals.js';

try { window.__AVALON_BOOTED__ = true; } catch(_) {}

let state = createInitialState();
let timerInterval = null;
let timerRemaining = TIMER_SECONDS;
let timerTotal = TIMER_SECONDS;
let selectedTeam = [];
let lobbyDraft = defaultLobby(); // { roomCode, players, extraRoles }
let renderQueued = false;
let myId = null; // local device's player id
let roomUnsub = null;
let lobbyRoomCache = null; // for joiner view
let lobbyPoll = null;
let isJoinerMode = false;
let hasJoined = false; // joiner has already called joinRoom — show waiting not input
let uiMode = 'HOME'; // HOME, JOIN_CODE, LOBBY
let showGamePopup = false;
let homeSearch = '';
let joinCodeInput = '';

function lobbyPlayerId() {
  return `lobby_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2,6)}`;
}
function ensureLobbyIds(players) {
  for (const p of players) {
    if (!p.id) p.id = lobbyPlayerId();
  }
}
function defaultLobby() {
  // Persist room code — don't generate new on every refresh
  let code = null;
  try {
    const last = localStorage.getItem('avalon:lastRoomCode');
    if (last && isValidRoomCode(last)) code = last;
  } catch(_) {}
  if (!code) {
    code = generateRoomCode();
    try { localStorage.setItem('avalon:lastRoomCode', code); } catch(_) {}
  }
  // Try to restore lobby draft for this code
  try {
    const raw = localStorage.getItem('avalon:lobby:' + code);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.players) && saved.extraRoles) {
        ensureLobbyIds(saved.players);
        return { roomCode: code, players: saved.players, extraRoles: saved.extraRoles, gameId: saved.gameId || 'quest-of-shadows' };
      }
    }
  } catch(_){}
  return {
    roomCode: code,
    players: [
      { id: lobbyPlayerId(), name: 'Lucky', isBot: false },
    ],
    extraRoles: { percival: true, morgana: true, mordred: false, oberon: false },
    gameId: 'quest-of-shadows',
  };
}

function persistLobbyCode(code) {
  try { localStorage.setItem('avalon:lastRoomCode', code); } catch(_) {}
}
function saveLobbyDraft() {
  try { ensureLobbyIds(lobbyDraft.players); localStorage.setItem('avalon:lobby:' + lobbyDraft.roomCode, JSON.stringify({ players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles, gameId: lobbyDraft.gameId })); } catch(_){}
}
async function syncLobbyToServer() {
  saveLobbyDraft();
  persistLobbyCode(lobbyDraft.roomCode);
  // Push to server for cross-device joiners — merge with server to avoid overwriting concurrent joins
  try {
    ensureLobbyIds(lobbyDraft.players);
    // Fetch latest to include any joiners that host hasn't yet polled
    let latest = null;
    try { latest = await net.getRoomAsync(lobbyDraft.roomCode); } catch(_){}
    if (latest && Array.isArray(latest.players)) {
      const localIds = new Set(lobbyDraft.players.map(p=>p.id));
      const localNames = new Set(lobbyDraft.players.map(p=>p.name));
      for (const p of latest.players) {
        if (p.id && localIds.has(p.id)) continue;
        if (!p.id && localNames.has(p.name)) continue;
        // New player from server — preserve its id
        lobbyDraft.players.push({ id: p.id || lobbyPlayerId(), name: p.name, isBot: !!p.isBot });
      }
      saveLobbyDraft();
    }
    const roomPlayers = lobbyDraft.players.map(p=> ({ id: p.id, name: p.name, isBot: !!p.isBot }));
    await net.pushRoom(lobbyDraft.roomCode, { players: roomPlayers, state: null, hostId: roomPlayers[0]?.id || null, extraRoles: lobbyDraft.extraRoles });
  } catch(e){ console.warn('[syncLobby]', e); }
}
async function syncExtraRolesToServer() {
  saveLobbyDraft();
  persistLobbyCode(lobbyDraft.roomCode);
  try {
    await net.pushRoom(lobbyDraft.roomCode, { extraRoles: lobbyDraft.extraRoles });
  } catch(e){ console.warn('[syncExtra]', e); }
}
function startLobbyPoll() {
  if (lobbyPoll) clearInterval(lobbyPoll);
  lobbyPoll = setInterval(async ()=>{
    if (state.phase !== PHASES.LOBBY) { clearInterval(lobbyPoll); lobbyPoll=null; return; }
    try {
      const room = await net.getRoomAsync(lobbyDraft.roomCode);
      if (!room) {
        if (isJoinerMode) {
          toast('Host left — room closed','error');
          isJoinerMode=false;
          hasJoined=false;
          history.replaceState(null,'',window.location.pathname);
          uiMode='HOME';
          showGamePopup=false;
          lobbyDraft=defaultLobby();
          if (roomUnsub) try{ roomUnsub(); }catch(_){}
          roomUnsub=null;
          stopLobbyPoll();
          queueRender();
        }
        return;
      }
      if (room && room.players) {
        // KV is single source of truth — check if joiner was kicked
        if (isJoinerMode && hasJoined) {
          let myId=null; try{ myId=localStorage.getItem('avalon:myId:'+lobbyDraft.roomCode); }catch(_){}
          let myName=null; try{ myName=localStorage.getItem('avalon:myName:'+lobbyDraft.roomCode); }catch(_){}
          const stillIn = myId ? room.players.some(p=>p.id===myId) : myName ? room.players.some(p=>p.name===myName) : false;
          if (!stillIn) {
            toast('You were kicked from lobby','error');
            hasJoined=false;
            isJoinerMode=false;
            try{ localStorage.removeItem('avalon:myName:'+lobbyDraft.roomCode); }catch(_){}
            try{ localStorage.removeItem('avalon:myId:'+lobbyDraft.roomCode); }catch(_){}
            history.replaceState(null,'',window.location.pathname);
            uiMode='HOME';
            showGamePopup=false;
            lobbyDraft=defaultLobby();
            if (roomUnsub) try{ roomUnsub(); }catch(_){}
            roomUnsub=null;
            stopLobbyPoll();
            queueRender();
            setTimeout(()=> showConfirm({ title:'Kicked', body:'You were kicked from the lobby by the host.', confirmText:'OK', onConfirm:()=>{} }), 300);
            return;
          }
        }
        // Single source of truth: KV room is authoritative
        lobbyRoomCache = room;
        // Auto-trim extra evil if player count now over limit (e.g., kicked down to 5)
        try {
          const maxEvil = getMaxExtraEvil((room.players||[]).length);
          const enabledEvil = ['morgana','mordred','oberon'].filter(k=> !!(room.extraRoles||{})[k]).length;
          if (enabledEvil > maxEvil) {
            const effective = getEffectiveExtraRoles(room.players.length, room.extraRoles);
            room.extraRoles = effective;
            lobbyRoomCache.extraRoles = effective;
            if (!isJoinerMode) {
              lobbyDraft.extraRoles = effective;
              saveLobbyDraft();
              try{ await net.pushRoom(lobbyDraft.roomCode, { extraRoles: effective }); }catch(_){}
              toast(`Trimmed evil extras to ${maxEvil} for ${room.players.length} players`,'default');
            } else {
              lobbyDraft.extraRoles = effective;
            }
          }
        } catch(_){}
        // Keep lobbyDraft in sync for host fallback / offline
        if (!isJoinerMode) {
          lobbyDraft.players = room.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
          lobbyDraft.extraRoles = room.extraRoles || lobbyDraft.extraRoles;
          saveLobbyDraft();
        } else {
          if (room.extraRoles) lobbyDraft.extraRoles = room.extraRoles;
        }
        const active = document.activeElement;
        const isTyping = active && (active.id==='input-add-player' || active.id==='input-join-name' || active.id==='input-home-search' || active.tagName==='INPUT');
        if (!isTyping) queueRender();
        // Also if room has state (game started), host should transition
        if (room.state && room.state.phase !== PHASES.LOBBY && state.phase === PHASES.LOBBY) {
          // Game started by host — joiner should load it
          const incoming = room.state;
          if (incoming && incoming.phase && PHASES[incoming.phase]) {
            state = incoming;
            storage.save(state);
            // Set myId for joiner — map by stored name, not stale lobbyDraft
            if (isJoinerMode) {
              let storedId = null; try{ storedId = localStorage.getItem('avalon:myId:' + lobbyDraft.roomCode); }catch(_){}
              let storedName = null; try{ storedName = localStorage.getItem('avalon:myName:' + lobbyDraft.roomCode); }catch(_){}
              const idValid = storedId && incoming.players.some(p=>p.id===storedId);
              if (idValid) {
                myId = storedId;
              } else if (storedName) {
                const found = incoming.players.find(p=> p.name===storedName);
                if (found) { myId = found.id; setMyId(lobbyDraft.roomCode, myId); }
                else if (!myId) myId = incoming.players[0]?.id;
              } else {
                const fallbackName = (()=>{ try{ const v = document.getElementById('input-join-name')?.value?.trim(); if(v) return v; }catch(_){} return null; })();
                if (fallbackName) {
                  const found = incoming.players.find(p=>p.name===fallbackName);
                  if (found) { myId = found.id; setMyId(lobbyDraft.roomCode, myId); }
                }
                if (!myId || !incoming.players.some(p=>p.id===myId)) {
                  myId = incoming.players[0]?.id;
                  if (myId) setMyId(lobbyDraft.roomCode, myId);
                }
              }
            }
            // Subscribe to game updates
            if (roomUnsub) roomUnsub();
            roomUnsub = net.subscribe(lobbyDraft.roomCode, (msg)=>{
              if (msg.type==='ROOM_DELETED') {
                toast('Host left — room closed','error');
                isJoinerMode=false; hasJoined=false; uiMode='HOME'; showGamePopup=false; lobbyDraft=defaultLobby();
                if (roomUnsub) try{ roomUnsub(); }catch(_){}
                roomUnsub=null; stopLobbyPoll(); state=createInitialState(); state={...state, roomCode:lobbyDraft.roomCode, extraRoles:lobbyDraft.extraRoles}; storage.clear(); queueRender(); return;
              }
              if (msg.state && JSON.stringify(msg.state) !== JSON.stringify(state)) {
                state = msg.state; storage.save(state); queueRender();
                if (state.phase===PHASES.TEAM_PROPOSAL) onEnterTeamProposal();
                if (state.phase===PHASES.TEAM_VOTE) onEnterTeamVote(state.voteGeneration);
                if (state.phase===PHASES.QUEST_VOTE) onEnterQuestVote();
              }
            });
            queueRender();
          }
        }
      }
    } catch(_){}
  }, 1500);
}
function stopLobbyPoll(){ if(lobbyPoll){ clearInterval(lobbyPoll); lobbyPoll=null; } }

function isTestMode() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('test')) return true;
    if (localStorage.getItem('avalon:test') === '1') return true;
  } catch(_){}
  return false;
}
function getMyIdForRoom(code, players) {
  const key = 'avalon:myId:' + code;
  let id = null;
  try { id = localStorage.getItem(key); } catch(_) {}
  if (id && players.some(p => p.id === id)) return id;
  // Host is first human
  const firstHuman = players.find(p => !p.isBot);
  if (firstHuman) {
    try { localStorage.setItem(key, firstHuman.id); } catch(_) {}
    return firstHuman.id;
  }
  return players[0]?.id || null;
}

function setMyId(code, id) {
  try { localStorage.setItem('avalon:myId:' + code, id); } catch(_) {}
  myId = id;
}

function toast(msg, variant='default') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast rounded-xl px-4 py-3 text-sm font-medium shadow-xl border backdrop-blur-xl ${
    variant==='error' ? 'bg-evil text-white border-evil/50' :
    variant==='success' ? 'bg-emerald-600 text-white border-emerald-500/50' :
    'bg-[#1f2937] text-white border-white/10'
  }`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>el.remove(), 3000);
}

function dispatch(action) {
  try {
    const prevPhase = state.phase;
    const prevGen = state.voteGeneration;
    const result = reducer(state, action);
    state = result.state;
    storage.save(state);
    // Sync to room (distributed) — use sync helper that also pushes to server in background
    if (state.roomCode) {
      try {
        if (net.updateRoomStateSync) net.updateRoomStateSync(state.roomCode, state);
        else net.updateRoomState(state.roomCode, state);
      } catch(e){ console.warn('[net] update failed', e); }
    }
    queueRender();
    handleEffects(result.effects, { prevPhase, prevGen, action });
  } catch(e) {
    console.error('[dispatch]', action, e);
    toast(e.message || 'Invalid action', 'error');
    const app = document.getElementById('app');
    app?.classList.add('animate-[shake_0.4s_ease-in-out]');
    setTimeout(()=>app?.classList.remove('animate-[shake_0.4s_ease-in-out]'), 400);
  }
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(()=>{ renderQueued=false; render(); });
}

function handleEffects(effects, ctx) {
  if (!effects || !effects.length) return;
  for (const eff of effects) {
    switch(eff.type) {
      case 'ENTER_TEAM_PROPOSAL': onEnterTeamProposal(); startTimer(); break;
      case 'ENTER_TEAM_VOTE': onEnterTeamVote(eff.generation); startTimer(); break;
      case 'SCHEDULE_TEAM_VOTE_RESOLVE':
        schedule(()=>{
          if (state.voteGeneration !== ctx.prevGen && eff.generation!==undefined) {
            const cur = getPublicState(state);
            if (cur.voteGeneration !== eff.generation) return;
          }
          if (state.phase===PHASES.TEAM_VOTE_REVEAL) dispatch({type:'RESOLVE_TEAM_VOTE'});
        }, eff.ms || REVEAL_ANIM_MS);
        break;
      case 'ENTER_QUEST_VOTE': onEnterQuestVote(); startTimer(); break;
      case 'SCHEDULE_QUEST_RESOLVE':
        schedule(()=>{ if(state.phase===PHASES.QUEST_REVEAL) dispatch({type:'RESOLVE_QUEST'}); }, eff.ms || REVEAL_ANIM_MS);
        break;
      case 'ENTER_ROLE_REVEAL': break;
      case 'ENTER_ASSASSINATION': onEnterAssassination(); break;
      case 'ENTER_GAME_OVER': stopTimer(); break;
      case 'ENTER_LOBBY': stopTimer(); break;
    }
  }
  if (ctx.prevPhase !== state.phase) {
    if ([PHASES.TEAM_PROPOSAL, PHASES.TEAM_VOTE, PHASES.QUEST_VOTE].includes(state.phase)) startTimer();
    else if (state.phase===PHASES.GAME_OVER || state.phase===PHASES.LOBBY) stopTimer();
  }
}
function schedule(fn, ms){ setTimeout(fn, ms); }

function onEnterTeamProposal() {
  const leader = state.players[state.leaderIndex];
  if (!leader || !leader.isBot) return;
  const delay = 700 + Math.random()*500;
  const gen = state.voteGeneration;
  setTimeout(()=>{
    if (state.phase!==PHASES.TEAM_PROPOSAL) return;
    if (state.voteGeneration!==gen) return;
    if (state.players[state.leaderIndex]?.id !== leader.id) return;
    try { const view=getAIView(state, leader.id); const team=ai.aiProposeTeam(view); dispatch({type:'PROPOSE_TEAM', payload:{teamIds:team, proposerId:leader.id}});}catch(e){ console.error('[ai propose]', e); }
  }, delay);
}

function onEnterTeamVote(generation) {
  const genAtEntry = generation ?? state.voteGeneration;
  state.players.forEach((p, idx)=>{
    if (!p.isBot) return;
    if (state.proposal.votes[p.id]) return;
    const delay=600+idx*350+Math.random()*400;
    setTimeout(()=>{
      if (state.phase!==PHASES.TEAM_VOTE) return;
      if (state.voteGeneration!==genAtEntry) return;
      if (state.proposal.votes[p.id]) return;
      if (state.phaseLock) return;
      try { const view=getAIView(state,p.id); const vote=ai.aiTeamVote(view, state.proposal.teamIds); dispatch({type:'SUBMIT_TEAM_VOTE', payload:{playerId:p.id, vote}});}catch(e){ console.error('[ai team vote]',e); }
    }, delay);
  });
}

function onEnterQuestVote() {
  state.proposal.teamIds.forEach((pid, idx)=>{
    const p=state.players.find(x=>x.id===pid);
    if (!p?.isBot) return;
    if (state.questVotes[pid]) return;
    const delay=800+idx*500+Math.random()*600;
    setTimeout(()=>{
      if (state.phase!==PHASES.QUEST_VOTE) return;
      if (state.questVotes[pid]) return;
      if (state.phaseLock) return;
      try { const view=getAIView(state,p.id); const vote=ai.aiQuestVote(view); dispatch({type:'SUBMIT_QUEST_VOTE', payload:{playerId:pid, vote}});}catch(e){ console.error('[ai quest]',e); }
    }, delay);
  });
}

function onEnterAssassination() {
  const assassin=state.players.find(p=>p.role==='ASSASSIN');
  if (!assassin?.isBot) return;
  const delay=1200+Math.random()*800;
  setTimeout(()=>{
    if (state.phase!==PHASES.ASSASSINATION) return;
    try { const view=getAIView(state, assassin.id); const pub=getPublicState(state); const targetId=ai.aiAssassinate(view, pub.players, pub); dispatch({type:'ASSASSINATE', payload:{targetId}});}catch(e){ console.error('[ai assassinate]',e); }
  }, delay);
}

function startTimer(){
  stopTimer();
  if (![PHASES.TEAM_PROPOSAL, PHASES.TEAM_VOTE, PHASES.QUEST_VOTE, PHASES.ASSASSINATION].includes(state.phase)) return;
  timerTotal=TIMER_SECONDS; timerRemaining=TIMER_SECONDS;
  timerInterval=setInterval(()=>{
    if (state.phaseLock) return;
    timerRemaining-=1;
    if (timerRemaining<=0){ timerRemaining=0; stopTimer(); dispatch({type:'TIMER_EXPIRED'}); queueRender(); }
    else {
      const el=document.getElementById('timer-remaining'); if(el) el.textContent=`${timerRemaining}s`;
      const fg=document.querySelector('.timer-ring-fg');
      if(fg){ const dash=2*Math.PI*22; const pct=timerRemaining/timerTotal; fg.setAttribute('stroke-dashoffset', String(dash*(1-pct))); fg.classList.toggle('warn', timerRemaining<=15); }
    }
  },1000);
}
function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval=null; }

function render(){
  const app=document.getElementById('app'); if(!app) return;
  const loading=document.getElementById('loading'); if(loading) loading.remove();
  const pub=getPublicState(state);
  // Toggle header / background — hide AVALON header for HOME/JOIN_CODE (they have own Table Party header) and for in-game
  const isHomeLike = pub.phase===PHASES.LOBBY && (uiMode==='HOME' || uiMode==='JOIN_CODE') && !isJoinerMode;
  const headerEl = document.querySelector('header');
  if (headerEl) headerEl.style.display = (pub.phase===PHASES.LOBBY && !isHomeLike) ? '' : 'none';
  if (pub.phase===PHASES.LOBBY && !isHomeLike) {
    document.body.className = document.body.className.replace('bg-[#0a1e2e]','').replace('bg-obsidian','bg-obsidian');
    document.body.style.backgroundColor = '';
  } else if (isHomeLike) {
    document.body.style.backgroundColor = '#0f0a1a';
  } else {
    document.body.style.backgroundColor = '#0a1e2e';
  }
  try {
    app.innerHTML=buildLayout(pub);
    bindDynamicEvents(pub);
    const logScroll=document.getElementById('log-scroll'); if(logScroll) logScroll.scrollTop=0;
  } catch(e){ console.error('[render]',e); app.innerHTML=`<div class="rounded-2xl bg-evil/10 border border-evil/30 p-6 text-center"><p class="text-evil font-bold">Render error</p><p class="text-sm text-stone-400 mt-1">${escape(e.message)}</p><button onclick="location.reload()" class="mt-4 px-4 py-2 rounded-xl bg-white text-obsidian font-bold">Reload</button></div>`; }
}

function buildLayout(pub){
  if (pub.phase===PHASES.LOBBY) {
    // — HOME / JOIN CODE takes precedence when not yet in a real lobby flow —
    if (uiMode === 'JOIN_CODE') {
      return renderJoinCodeScreen(joinCodeInput);
    }
    if (uiMode === 'HOME' && !isJoinerMode) {
      const hostNameForPopup = lobbyDraft.players[0]?.name && lobbyDraft.players[0].name!=='Lucky' ? lobbyDraft.players[0].name : '';
      let html = renderHome(homeSearch);
      if (showGamePopup) html += renderGamePopup(hostNameForPopup);
      return html;
    }
    // Single source of truth: lobbyRoomCache (KV mirror). Fallback to lobbyDraft for offline/host initial.
    const room = lobbyRoomCache || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles };
    const inviteLink = net.generateInviteLink(room.code || lobbyDraft.roomCode);
    // Joiner mode: show join screen or waiting lobby from KV
    if (isJoinerMode) {
      const hostPlayers = room.players || [];
      const count = hostPlayers.length;
      const joinedName = (()=>{ try{ return localStorage.getItem('avalon:myName:'+lobbyDraft.roomCode) || ''; }catch(_){return ''}})();
      const joinedId = (()=>{ try{ return localStorage.getItem('avalon:myId:'+lobbyDraft.roomCode) || ''; }catch(_){return ''}})();
      const isAlreadyJoined = hasJoined || (joinedId && hostPlayers.some(p=> p.id===joinedId)) || (joinedName && hostPlayers.some(p=> p.name===joinedName));
      if (isAlreadyJoined) {
        const ctx = {
          roomCode: room.code || lobbyDraft.roomCode,
          playersDraft: hostPlayers.map(p=> ({id:p.id, name:p.name, isBot:!!p.isBot})),
          extraRoles: room.extraRoles || lobbyDraft.extraRoles,
          gameId: room.gameId || lobbyDraft.gameId || 'quest-of-shadows',
          myName: joinedName,
          myId: joinedId,
          inviteLink,
          isJoiner: true,
          joinedName: joinedName,
          joinedId: joinedId,
          renderGameOptions: () => renderAvalonOptions(room.extraRoles || lobbyDraft.extraRoles, hostPlayers.length, true),
        };
        return renderLobby(ctx);
      }
      return `
        <div class="max-w-[480px] mx-auto px-4 sm:px-0">
          <div class="flex items-center justify-between pt-2">
            <button id="btn-join-back" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70">‹</button>
            <div class="text-center">
              <h1 class="font-display font-extrabold text-[18px] text-[#f0e8d0]">Quest of Shadows</h1>
              <p class="text-xs text-white/60">Joining ${escape(room.code || lobbyDraft.roomCode)}</p>
            </div>
            <div class="w-8"></div>
          </div>
          <div class="mt-5 rounded-[24px] bg-[#29546c] border border-white/10 p-6 text-center">
            <p class="text-xs tracking-widest font-bold text-white/60">ROOM</p>
            <div class="font-display font-black text-[36px] tracking-[0.18em] text-[#f3ecd8]">${escape(room.code || lobbyDraft.roomCode)}</div>
            <p class="text-xs text-white/60 mt-1">${count} in lobby — waiting for host</p>
            <div class="mt-3 flex flex-wrap justify-center gap-1.5">
              ${hostPlayers.map(p=> `<span class="px-2.5 py-1 rounded-full bg-white/15 text-xs font-bold text-white">${escape(p.name)}${p.isBot?' · BOT':''}</span>`).join('')}
            </div>
          </div>
          <div class="mt-6 rounded-2xl bg-[#0e2231]/80 border border-white/10 p-5">
            <h3 class="font-extrabold text-white text-sm">Join this table</h3>
            <p class="text-xs text-white/50 mt-1">Enter your name — you’ll be added to the host’s lobby. No passing.</p>
            <input id="input-join-name" maxlength="16" placeholder="Your name" value=""
              class="mt-3 w-full px-3.5 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 text-sm font-medium outline-none focus:border-[#3aa8d6]" />
            <button id="btn-join-room" class="mt-3 w-full py-3.5 rounded-full bg-[#f3ecd8] hover:bg-white text-[#0e2533] font-extrabold tracking-wide">Join ${escape(room.code || lobbyDraft.roomCode)}</button>
            <p class="text-xs text-white/40 mt-2 text-center">Host will see you appear and can start when 5+ are ready.</p>
          </div>
        </div>
      `;
    }
    const ctx = {
      roomCode: room.code || lobbyDraft.roomCode,
      playersDraft: (room.players || lobbyDraft.players).map(p=>({id:p.id, name:p.name, isBot:!!p.isBot})),
      extraRoles: room.extraRoles || lobbyDraft.extraRoles,
      gameId: room.gameId || lobbyDraft.gameId || 'quest-of-shadows',
      myName: (room.players && room.players[0]?.name) || lobbyDraft.players[0]?.name || 'Lucky',
      myId: room.players && room.players[0]?.id,
      inviteLink,
      renderGameOptions: () => renderAvalonOptions(room.extraRoles || lobbyDraft.extraRoles, (room.players||[]).length, false),
    };
    return renderLobby(ctx);
  }
  if (pub.phase===PHASES.ROLE_REVEAL) {
    // Fix myId if not in current players (e.g., joiner's old lobby ID after host started)
    let my = myId || state.players[0]?.id;
    if (my && !state.players.some(p=>p.id===my)) {
      // Try to find by name via stored mapping
      try {
        const mapRaw = localStorage.getItem('avalon:nameToId:'+ (pub.roomCode||lobbyDraft.roomCode));
        const map = mapRaw ? JSON.parse(mapRaw) : null;
        const myName = (()=>{ try{ const v = localStorage.getItem('avalon:myName:'+ (pub.roomCode||'')); if(v) return v; }catch(_){} try{ const v2 = document.getElementById('input-join-name')?.value?.trim(); if(v2) return v2; }catch(_){} return lobbyDraft.players[0]?.name || null; })();
        if (map && myName && map[myName]) { my = map[myName]; setMyId(pub.roomCode||lobbyDraft.roomCode, my); myId = my; }
        else {
          const found = myName ? state.players.find(p=>p.name===myName) : null;
          if (found) { my = found.id; setMyId(pub.roomCode||lobbyDraft.roomCode, my); myId = my; }
          else { my = state.players[0]?.id; myId = my; if(my) setMyId(pub.roomCode||lobbyDraft.roomCode, my); }
        }
      } catch(_){ my = state.players[0]?.id; myId = my; if(my) try{ setMyId(pub.roomCode||lobbyDraft.roomCode, my); }catch(_){} }
    }
    const myIdx = state.players.findIndex(p=>p.id===my);
    const myRevealed = myIdx!==-1 ? state.revealed[myIdx] : false;
    const myPriv = (()=>{ try{ return getPrivateState(state, my); }catch(_){ return null; }})();
    const vision = myPriv ? myPriv.vision : { sees: [] };
    const role = myPriv ? myPriv.self.role : 'LOYAL';
    const allegiance = myPriv ? myPriv.self.allegiance : 'GOOD';
    // Build vision card content
    let visionCard = '';
    if (role==='LOYAL') {
      visionCard = `
        <div class="rounded-2xl bg-[#0f2231]/80 border border-white/10 p-5 text-center">
          <p class="text-sm text-white/70">Loyal servants are told nothing at all. That is the job.</p>
          <p class="text-sm text-white/50 mt-3">You were shown nobody.</p>
        </div>`;
    } else if (role==='MINION' || role==='ASSASSIN' || role==='MORGANA' || role==='MORDRED' || role==='OBERON') {
      const evilNames = vision.sees.map(id=> state.players.find(p=>p.id===id)?.name || id);
      if (role==='OBERON') {
        visionCard = `<div class="rounded-2xl bg-[#0f2231]/80 border border-white/10 p-5 text-center"><p class="text-sm text-white/70">You see no one, and no one sees you.</p><p class="text-xs text-white/40 mt-2">You are isolated.</p></div>`;
      } else if (evilNames.length) {
        visionCard = `
          <div class="rounded-2xl bg-[#0f2231]/80 border border-white/10 p-5 text-center">
            <p class="text-sm text-white/70">The servants of evil know each other.</p>
            <div class="flex justify-center mt-3">
              ${evilNames.map(n=> `<div class="flex flex-col items-center mx-1.5"><div class="w-12 h-12 rounded-full bg-[#ff6b6b] flex items-center justify-center font-black text-black text-sm">${escape(n.slice(0,2).toUpperCase())}</div><span class="text-xs text-white/60 mt-1">${escape(n.slice(0,8))}</span></div>`).join('')}
            </div>
          </div>`;
      } else {
        visionCard = `<div class="rounded-2xl bg-[#0f2231]/80 border border-white/10 p-5 text-center"><p class="text-sm text-white/70">The servants of evil know each other.</p><p class="text-xs text-white/40 mt-2">You are alone.</p></div>`;
      }
    } else if (role==='MERLIN') {
      const evilNames = vision.sees.map(id=> state.players.find(p=>p.id===id)?.name || id);
      visionCard = `
        <div class="rounded-2xl bg-[#0f2231]/80 border border-white/10 p-5 text-center">
          <p class="text-sm text-white/70">You see the servants of evil${evilNames.length?'.':'. None?'}</p>
          ${evilNames.length ? `<div class="flex justify-center gap-2 mt-3 flex-wrap">${evilNames.map(n=> `<span class="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-bold text-white">${escape(n)}</span>`).join('')}</div>` : '<p class="text-xs text-white/40 mt-2">Mordred hides from you.</p>'}
        </div>`;
    } else if (role==='PERCIVAL') {
      const sees = vision.sees.map(id=> state.players.find(p=>p.id===id)?.name || id);
      visionCard = `
        <div class="rounded-2xl bg-[#0f2231]/80 border border-white/10 p-5 text-center">
          <p class="text-sm text-white/70">You see Merlin${sees.length>1?' — or is it Morgana?':'.'}</p>
          ${sees.length ? `<div class="flex justify-center gap-2 mt-3">${sees.map(n=> `<span class="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-bold text-white">${escape(n)}<span class="ml-1 text-[10px] text-white/40">?</span></span>`).join('')}</div>` : ''}
          <p class="text-xs text-white/40 mt-2">One is Merlin, one may be Morgana.</p>
        </div>`;
    }
    const total = pub.players.length;
    const statusMap = {};
    pub.players.forEach((p,i)=>{ statusMap[p.id] = pub.revealed[i] ? 'READY' : 'READING'; });
    const questNum = 1;
    return `
      <div class="max-w-[520px] mx-auto min-h-[85vh] flex flex-col">
        ${renderExactHeader(questNum, 5)}
        <div class="mt-4 space-y-3">
          ${renderExactAllegiance({ players: pub.players, extraRoles: pub.extraRoles, currentQuest: 0 }, my, { role, allegiance })}
          ${visionCard}
          ${renderExactTableSummary(pub)}
        </div>
        <div class="mt-6">
          ${renderExactAvatarRow(pub, my, statusMap)}
        </div>
        <div class="flex-1"></div>
        <div class="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-[#0a1e2e] to-transparent">
          ${myRevealed
            ? `<div class="w-full py-4 rounded-full bg-white/10 border border-white/15 text-center text-white/60 font-bold text-sm">Waiting for others… ${pub.revealed.filter(Boolean).length}/${pub.players.length} ready</div>`
            : renderExactBottomButton('I know my part', 'btn-private-reveal-exact')}
          ${isTestMode() ? `<div class="flex justify-center mt-3">
            <select id="select-viewas" class="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
              ${state.players.map(p=>`<option value="${p.id}" ${p.id===my?'selected':''}>View as ${escape(p.name)}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  // ——— ALL OTHER PHASES — exact Table Party flow ———
  let my = myId || state.players[0]?.id;
  // Fix myId if not in current players (joiner name mapping)
  if (my && !state.players.some(p=>p.id===my)) {
    try {
      const mapRaw = localStorage.getItem('avalon:nameToId:'+ (pub.roomCode||lobbyDraft.roomCode));
      const map = mapRaw ? JSON.parse(mapRaw) : null;
      const myName = (()=>{ try{ const v=localStorage.getItem('avalon:myName:'+ (pub.roomCode||'')); if(v) return v; }catch(_){} return lobbyDraft.players[0]?.name; })();
      if (map && myName && map[myName]) { my = map[myName]; setMyId(pub.roomCode||lobbyDraft.roomCode, my); myId = my; }
      else {
        const found = state.players.find(p=>p.name===myName);
        if (found) { my = found.id; setMyId(pub.roomCode||lobbyDraft.roomCode, my); myId = my; }
        else { my = state.players[0]?.id; myId = my; if(my) setMyId(pub.roomCode||lobbyDraft.roomCode, my); }
      }
    } catch(_){ my = state.players[0]?.id; myId = my; }
  }
  const questIdx = pub.currentQuest;
  const questNumDisplay = Math.min(questIdx+1, 5);
  // Common header + quest track for all in-game
  const header = renderExactHeader(questNumDisplay, 5);
  const track = renderExactQuestTrack(pub);

  let middle = '';
  let bottom = '';

  if (pub.phase===PHASES.TEAM_PROPOSAL) {
    const quest = pub.quests[questIdx];
    const leader = pub.players[pub.leaderIndex];
    const isMyTurn = leader && leader.id===my;
    const need = quest.size;
    if (!leader || !state.players.find(p=>p.id===leader.id)?.isBot && !isMyTurn) {
      middle = `
        <div class="text-center mt-6">
          <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">QUEST ${questNumDisplay} — CHOOSING ${need}</p>
          <h2 class="font-display font-black text-[26px] text-white leading-none mt-1">${escape(leader?.name||'Someone')} is choosing</h2>
          <p class="text-sm text-white/60 mt-2">They are watching who you leave out.</p>
        </div>
        <div class="mt-6">${renderExactAvatarRow(pub, my)}</div>
      `;
      bottom = `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold text-sm">Waiting for ${escape(leader?.name||'leader')}…</div>`;
    } else if (isMyTurn) {
      middle = `
        <div class="text-center mt-4">
          <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">QUEST ${questNumDisplay}</p>
          <h2 class="font-display font-black text-[26px] text-white leading-none">Choose ${need}</h2>
          <p class="text-sm text-white/60 mt-1">They are watching who you leave out.</p>
        </div>
        <div class="mt-5 grid grid-cols-3 sm:grid-cols-6 gap-2 justify-center">
          ${pub.players.map(p=>{
            const sel = selectedTeam.includes(p.id);
            const border = sel ? 'border-[#7ec8e6] bg-[#7ec8e6]/15' : 'border-white/10 bg-white/5';
            return `<button data-player-id="${p.id}" class="flex flex-col items-center gap-1 p-2 rounded-2xl border-2 ${border} transition-colors">
              <div class="w-12 h-12 rounded-full ${p.id===my?'bg-[#f3ecd8] text-[#0a1e2e]':'bg-[#ff6b6b] text-black'} flex items-center justify-center font-black text-sm">${escape(p.name.slice(0,2).toUpperCase())}</div>
              <span class="text-xs font-bold text-white/70">${escape(p.name.slice(0,7))}${p.id===my?'<span class="ml-1 px-1 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[8px] border border-[#0a1e2e]/10">YOU</span>':''}</span>
            </button>`;
          }).join('')}
        </div>
      `;
      const canConfirm = selectedTeam.length===need;
      bottom = canConfirm
        ? renderExactBottomButton('Put it to the table', 'btn-confirm-team-exact')
        : `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold text-sm">Select ${need-selectedTeam.length} more</div>`;
    } else {
      // Bot leader
      middle = `
        <div class="text-center mt-6">
          <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">QUEST ${questNumDisplay} — CHOOSING ${need}</p>
          <h2 class="font-display font-black text-[26px] text-white">${escape(leader?.name||'Leader')} is choosing</h2>
        </div>
        <div class="mt-6">${renderExactAvatarRow(pub, my)}</div>
      `;
      bottom = `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold text-sm">Waiting…</div>`;
    }
  } else if (pub.phase===PHASES.TEAM_VOTE || pub.phase===PHASES.TEAM_VOTE_REVEAL) {
    if (pub.phase===PHASES.TEAM_VOTE_REVEAL) {
      const votes = pub.proposal.votes || {};
      const approve = Object.values(votes).filter(v=>v==='APPROVE').length;
      const reject = Object.values(votes).length - approve;
      const passed = approve > reject;
      middle = `
        <div class="text-center mt-6">
          <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">QUEST ${questNumDisplay}</p>
          <h2 class="font-display font-black text-[26px] text-white">${passed?'Approved':'Rejected'} <span class="text-sm font-bold text-white/60">(${approve}–${reject})</span></h2>
          <p class="text-sm text-white/60 mt-1">Team ${escape(pub.proposal.teamIds.map(id=> pub.players.find(p=>p.id===id)?.name).join(', '))}</p>
          <div class="mt-4 grid grid-cols-1 gap-2 max-w-[320px] mx-auto">
            ${pub.players.map(p=>{
              const v = votes[p.id];
              return `<div class="flex justify-between rounded-xl px-3 py-2 border ${v==='APPROVE'?'bg-emerald-500/15 border-emerald-400/30 text-emerald-300':'bg-rose-500/15 border-rose-400/30 text-rose-300'}"><span class="text-sm font-bold text-white">${escape(p.name)}</span><span class="text-xs font-black">${v||'—'}</span></div>`;
            }).join('')}
          </div>
        </div>
      `;
      bottom = `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold text-sm">Resolving…</div>`;
    } else {
      const teamIds = pub.proposal.teamIds;
      const teamNames = teamIds.map(id=> pub.players.find(p=>p.id===id)?.name).join(', ');
      const proposer = pub.players[pub.leaderIndex]?.name || 'Someone';
      const myVoted = !!pub.proposal.votes[my];
      if (myVoted) {
        middle = `<div class="text-center mt-8"><p class="text-white font-bold">You voted — waiting</p><p class="text-sm text-white/60 mt-1">${Object.keys(pub.proposal.votes).length}/${pub.players.length} voted</p></div>`;
        bottom = `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold">Waiting…</div>`;
      } else {
        middle = `
          <div class="text-center mt-4">
            <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">${escape(proposer.toUpperCase())} PROPOSED</p>
            <h2 class="font-display font-black text-[28px] text-white leading-none">Do they go?</h2>
            <div class="flex justify-center gap-3 mt-4">
              ${teamIds.map(id=>{
                const p = pub.players.find(x=>x.id===id);
                return `<div class="flex flex-col items-center"><div class="w-14 h-14 rounded-full bg-[#ff6b6b] flex items-center justify-center font-black text-black">${escape((p?.name||'??').slice(0,2).toUpperCase())}</div><span class="text-xs font-bold text-white mt-1">${escape(p?.name||'??')}${id===my?'<span class="ml-1 px-1 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[8px] border border-[#0a1e2e]/10">YOU</span>':''}</span></div>`;
              }).join('')}
            </div>
          </div>
        `;
        bottom = `
          <div class="grid grid-cols-2 gap-3">
            <button data-team-vote="APPROVE" data-voter="${my}" class="py-4 rounded-full bg-[#0f2231] border border-emerald-400/50 text-emerald-300 font-black">Approve</button>
            <button data-team-vote="REJECT" data-voter="${my}" class="py-4 rounded-full bg-[#0f2231] border border-rose-400/50 text-rose-300 font-black">Reject</button>
          </div>`;
      }
    }
  } else if (pub.phase===PHASES.QUEST_VOTE) {
    const teamIds = pub.proposal.teamIds;
    const onTeam = teamIds.includes(my);
    const voted = !!state.questVotes[my];
    if (!onTeam) {
      middle = `<div class="text-center mt-8"><p class="text-white font-bold">Quest in progress</p><p class="text-sm text-white/60">You are not on this team</p><div class="flex justify-center gap-2 mt-4">${teamIds.map(id=>{ const p=pub.players.find(x=>x.id===id); return `<div class="w-10 h-10 rounded-full bg-[#ff6b6b] flex items-center justify-center font-black text-black text-xs">${escape((p?.name||'??').slice(0,2))}</div>`;}).join('')}</div></div>`;
      bottom = `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold">${Object.keys(state.questVotes).length}/${teamIds.length} played</div>`;
    } else if (voted) {
      middle = `<div class="text-center mt-8"><p class="text-white font-bold">You played your card</p><p class="text-sm text-white/60">Waiting for team… ${Object.keys(state.questVotes).length}/${teamIds.length}</p></div>`;
      bottom = `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold">Waiting…</div>`;
    } else {
      const me = state.players.find(p=>p.id===my);
      const canFail = me && me.allegiance==='EVIL';
      middle = `
        <div class="text-center mt-4">
          <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">QUEST ${questNumDisplay}</p>
          <h2 class="font-display font-black text-[28px] text-white leading-none">Play your card</h2>
          <p class="text-sm text-white/60 mt-1 max-w-[320px] mx-auto">The fail card is not yours to play. A loyal servant only ever succeeds.</p>
          <div class="flex justify-center gap-2 mt-4">
            ${teamIds.map(id=>{ const p=pub.players.find(x=>x.id===id); return `<div class="flex flex-col items-center"><div class="w-12 h-12 rounded-full ${id===my?'bg-[#f3ecd8] text-[#0a1e2e]':'bg-[#ff6b6b] text-black'} flex items-center justify-center font-black text-sm">${escape((p?.name||'??').slice(0,2))}</div><span class="text-xs font-bold text-white/70 mt-1">${escape(p?.name||'??')}${id===my?'<span class="ml-1 px-1 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[8px] border border-[#0a1e2e]/10">YOU</span>':''}</span></div>`;}).join('')}
          </div>
          <p class="text-xs text-white/40 mt-2">${Object.keys(state.questVotes).length} of ${teamIds.length} played.</p>
        </div>
      `;
      bottom = `
        <div class="grid grid-cols-2 gap-3">
          <button id="btn-quest-succeed" data-player="${my}" class="py-4 rounded-full bg-[#0f2231] border border-emerald-400/50 text-emerald-300 font-black">Succeed</button>
          <button id="btn-quest-fail" data-player="${my}" ${canFail?'':'disabled'} class="py-4 rounded-full ${canFail?'bg-[#0f2231] border border-rose-400/50 text-rose-300':'bg-white/5 border border-white/10 text-white/20 border-dashed'} font-black">${canFail?'Fail':'Fail'}</button>
        </div>`;
    }
  } else if (pub.phase===PHASES.QUEST_REVEAL) {
    const quest = state.quests[questIdx];
    const teamIds = quest ? quest.teamIds : pub.proposal.teamIds;
    const failCount = quest ? quest.failCount : 0;
    const isSuccess = quest ? quest.status==='SUCCESS' : failCount < (pub.quests[questIdx]?.failsRequired||1);
    const teamNames = teamIds.map(id=> pub.players.find(p=>p.id===id)?.name).join(', ');
    middle = `
      <div class="text-center mt-4">
        <div class="flex justify-center gap-2">
          ${teamIds.map(id=>{ const p=pub.players.find(x=>x.id===id); return `<div class="w-12 h-12 rounded-full bg-[#ff6b6b] flex items-center justify-center font-black text-black text-sm">${escape((p?.name||'??').slice(0,2))}</div>`;}).join('')}
        </div>
        <div class="flex justify-center gap-2 mt-3">
          ${(quest?.votesShuffled || []).map(v=> `<span class="px-4 py-1.5 rounded-full ${v==='FAIL'?'bg-rose-500 text-white':'bg-emerald-400 text-black'} text-xs font-black">${v==='FAIL'?'FAIL':'SUCCESS'}</span>`).join('')}
        </div>
        <p class="text-xs tracking-widest font-bold text-[#7ec8e6] mt-4">QUEST ${questNumDisplay}</p>
        <h2 class="font-display font-black text-[28px] leading-none ${isSuccess?'text-emerald-300':'text-rose-300'}">${isSuccess?'The quest holds':'The quest fails'}</h2>
        <p class="text-sm font-bold text-white mt-1">${isSuccess?'Not one fail card.':'A fail card was played.'}</p>
        <p class="text-xs text-white/50 mt-1">${quest ? `${quest.teamIds.length} on quest • ${failCount} fail • ${isSuccess?'0 for evil':'1+ for evil'}` : ''}</p>
        <p class="text-xs text-white/40 mt-2 max-w-[360px] mx-auto">Nobody on that team had anything to hide. Or nobody chose to use it.</p>
      </div>
    `;
    const isLastQuest = questIdx >= 4 || (quest && ( (quest.status==='SUCCESS' && pub.quests.filter(q=>q.status==='SUCCESS').length>=3) || (quest.status==='FAIL' && pub.quests.filter(q=>q.status==='FAIL').length>=3) ));
    // Actually check win condition
    const goodWins = pub.quests.filter(q=>q.status==='SUCCESS').length;
    const evilWins = pub.quests.filter(q=>q.status==='FAIL').length;
    let btnText = 'Next quest';
    if (goodWins>=3 || evilWins>=3) btnText = goodWins>=3 ? 'See how it ends' : 'See how it ends';
    bottom = renderExactBottomButton(btnText, 'btn-next-quest');
  } else if (pub.phase===PHASES.ASSASSINATION) {
    const goodIds = state.players.filter(p=>p.allegiance==='GOOD').map(p=>p.id);
    middle = `
      <div class="text-center mt-6">
        <p class="text-xs tracking-widest font-bold text-[#7ec8e6]">THREE QUESTS ARE DONE</p>
        <h2 class="font-display font-black text-[26px] text-white leading-none">Name Merlin</h2>
        <p class="text-sm text-white/60 mt-1 max-w-[360px] mx-auto">Good has won the board. Find the one who could see you all along and it is yours anyway.</p>
        <div class="flex justify-center gap-2 mt-6 flex-wrap">
          ${goodIds.map(id=>{
            const p = pub.players.find(x=>x.id===id);
            const sel = selectedTeam.includes(id); // reuse for assassin pick
            return `<button data-assassinate="${id}" class="flex flex-col items-center gap-1 p-1 rounded-2xl border-2 ${sel?'border-[#7ec8e6] bg-[#7ec8e6]/10':'border-transparent'}">
              <div class="w-14 h-14 rounded-full ${p?.id===my?'bg-[#f3ecd8] text-[#0a1e2e]':'bg-[#2a3a4a] text-white'} border-2 border-white/10 flex items-center justify-center font-black">${escape((p?.name||'??').slice(0,2))}</div>
              <span class="text-xs font-bold text-white/70">${escape(p?.name||'??')}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    const picked = selectedTeam[0];
    const pickedName = picked ? pub.players.find(p=>p.id===picked)?.name : '—';
    bottom = picked
      ? renderExactBottomButton(`Name ${pickedName}`, 'btn-confirm-assassinate')
      : `<div class="w-full py-4 rounded-full bg-white/5 border border-white/10 text-center text-white/40 font-bold">Choose one</div>`;
  } else if (pub.phase===PHASES.GAME_OVER) {
    const isGoodWin = pub.winner==='GOOD';
    const assassin = state.players.find(p=>p.role==='ASSASSIN');
    const merlin = state.players.find(p=>p.role==='MERLIN');
    if (pub.winReason==='ASSASSINATION') {
      const success = pub.assassination?.success;
      middle = `
        <div class="text-center mt-4">
          <p class="text-xs tracking-widest font-bold ${success?'text-rose-300':'text-emerald-300'}">${success?'EVIL WINS':'GOOD WINS'}</p>
          <h2 class="font-display font-black text-[28px] leading-none ${success?'text-rose-400':'text-emerald-300'}">${success?'The Assassin found Merlin':'The Assassin missed'}</h2>
          <p class="text-sm text-white/60 mt-1 max-w-[360px] mx-auto">${success?'Good won every quest that mattered and lost the game anyway.':'Good held and Merlin stayed hidden.'}</p>
          <div class="mt-6 rounded-2xl bg-[#0f2231]/60 border border-white/10 p-3 text-left">
            <div class="flex justify-between text-xs py-2 border-b border-white/5"><span class="text-white/60">The Assassin</span><span class="font-bold text-white">${escape(assassin?.name||'—')}</span></div>
            <div class="flex justify-between text-xs py-2 border-b border-white/5"><span class="text-white/60">Named</span><span class="font-bold text-white">${escape(state.players.find(p=>p.id===pub.assassination?.targetId)?.name||'—')}</span></div>
            <div class="flex justify-between text-xs py-2"><span class="text-white/60">Merlin</span><span class="font-bold text-white">${escape(merlin?.name||'—')}</span></div>
          </div>
          <div class="mt-4 space-y-1.5">
            ${state.players.map(p=>`
              <div class="flex items-center justify-between rounded-xl bg-[#0f2231]/80 border-l-4 ${p.allegiance==='GOOD'?'border-emerald-400':'border-rose-400'} border-y border-r border-white/5 px-3 py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-full ${p.id===my?'bg-[#f3ecd8] text-[#0a1e2e]':'bg-[#ff6b6b] text-black'} flex items-center justify-center font-black text-xs">${escape(p.name.slice(0,2))}</div>
                  <span class="text-sm font-bold text-white">${escape(p.name)}${p.id===my?'<span class="ml-1 px-1.5 py-0.5 rounded-full bg-[#f3ecd8] text-[#0a1e2e] text-[8px] border border-[#0a1e2e]/10">YOU</span>':''}</span>
                </div>
                <span class="text-xs font-bold ${p.allegiance==='GOOD'?'text-emerald-300':'text-rose-300'}">${escape(p.role)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      bottom = renderExactBottomButton('See the final scores', 'btn-play-again');
    } else {
      middle = `
        <div class="text-center mt-6">
          <p class="text-xs tracking-widest font-bold ${isGoodWin?'text-emerald-300':'text-rose-300'}">${isGoodWin?'GOOD WINS':'EVIL WINS'}</p>
          <h2 class="font-display font-black text-[28px] text-white">${isGoodWin?'Good prevails':'Evil triumphs'}</h2>
          <p class="text-sm text-white/60 mt-1">${isGoodWin?'Three quests held.':'Three quests fell.'}</p>
          <div class="mt-4 space-y-1.5">
            ${state.players.map(p=>`
              <div class="flex items-center justify-between rounded-xl bg-[#0f2231]/80 border border-white/5 px-3 py-2.5">
                <span class="text-sm font-bold text-white">${escape(p.name)}</span>
                <span class="text-xs font-bold ${p.allegiance==='GOOD'?'text-emerald-300':'text-rose-300'}">${escape(p.role)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      bottom = renderExactBottomButton('Play again', 'btn-play-again');
    }
  } else {
    middle = `<div class="text-center mt-8 text-white/60">Unknown phase ${escape(pub.phase)}</div>`;
    bottom = '';
  }

  // Wrap with header + track + middle + avatar row (if not already) + bottom
  const showTrack = pub.phase!==PHASES.ROLE_REVEAL && pub.phase!==PHASES.GAME_OVER;
  return `
    <div class="max-w-[520px] mx-auto min-h-[88vh] flex flex-col px-2 sm:px-0">
      ${header}
      ${showTrack ? `<div class="mt-3">${track}</div>` : ''}
      <div class="flex-1">
        ${middle}
        ${pub.phase!==PHASES.ROLE_REVEAL && pub.phase!==PHASES.GAME_OVER ? `<div class="mt-6">${renderExactAvatarRow(pub, my)}</div>` : ''}
      </div>
      <div class="sticky bottom-0 pt-4 pb-3 bg-gradient-to-t from-[#0a1e2e] to-transparent">
        ${bottom}
        ${isTestMode() ? `<div class="flex justify-center mt-2">
          <select id="select-viewas-ingame" class="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/40">
            ${state.players.map(p=>`<option value="${p.id}" ${p.id===my?'selected':''}>View as ${escape(p.name)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>
    </div>
  `;
}

// Phase panels — keep previous but adapt text to not say "Pass device"

function renderTeamProposalPanel(pub){
  const quest=pub.quests[pub.currentQuest];
  const leader=pub.players[pub.leaderIndex];
  const isHumanLeader = leader && !state.players.find(p=>p.id===leader.id)?.isBot;
  const need=quest.size;
  const selectedCount=selectedTeam.length;
  const canConfirm=selectedCount===need;
  const leaderName=leader?.name || 'Leader';
  const isMyTurn = leader?.id === myId;
  if (!isHumanLeader) {
    return `
      <div class="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-5 sm:p-6 text-center">
        <div class="w-10 h-10 mx-auto rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">👑</div>
        <h3 class="font-display font-bold text-white mt-3">${escape(leaderName)} (Bot) is choosing…</h3>
        <p class="text-sm text-amber-200/80 mt-1">Team of ${need} incoming.</p>
      </div>
    `;
  }
  // If human leader but not my turn (other device), show waiting
  if (!isMyTurn) {
    return `
      <div class="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5 text-center">
        <p class="text-sm font-bold text-white">Waiting for Leader <span class="text-gold">${escape(leaderName)}</span> on their device</p>
        <p class="text-xs text-stone-500 mt-1">They are choosing ${need} for Quest ${pub.currentQuest+1} • ${quest.failsRequired>1?'2 fails needed':''}</p>
      </div>
    `;
  }
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] backdrop-blur-xl overflow-hidden shadow-xl">
      <div class="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <p class="text-[11px] tracking-[0.14em] font-bold text-gold">TEAM PROPOSAL — YOUR TURN</p>
          <h3 class="font-display font-bold text-white mt-0.5">You are Leader — pick ${need}</h3>
        </div>
        <span class="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs font-mono font-bold text-white">${selectedCount}/${need}</span>
      </div>
      <div class="p-5">
        <p class="text-sm text-stone-400">Tap players in the table to select exactly ${need}.</p>
        <div class="mt-4 flex gap-3">
          <button id="btn-confirm-team" ${canConfirm?'':'disabled'} class="flex-1 py-3.5 rounded-xl font-bold transition-colors ${canConfirm?'bg-gold text-obsidian hover:bg-amber-300 shadow-lg shadow-gold/20':'bg-white/10 text-stone-500 cursor-not-allowed'}">
            ${canConfirm?'PROPOSE TEAM ✓':`Select ${need-selectedCount} more`}
          </button>
          <button id="btn-clear-team" class="px-4 py-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-white text-sm font-semibold">Clear</button>
        </div>
        <p class="text-xs text-stone-500 mt-3">Quest ${pub.currentQuest+1} requires ${need} • ${quest.failsRequired>1?'Needs 2 fails to sabotage':'1 fail sabotages'}</p>
      </div>
    </div>
  `;
}

function renderTeamVotePanel(pub){
  const isReveal=pub.phase===PHASES.TEAM_VOTE_REVEAL || pub.phaseLock;
  const votes=pub.proposal.votes||{};
  const total=pub.players.length;
  const voted=Object.keys(votes).length;
  const teamNames=pub.proposal.teamIds.map(id=>pub.players.find(p=>p.id===id)?.name).join(', ');
  const leaderName=pub.players[pub.leaderIndex]?.name || '';
  if (isReveal) {
    const approve=Object.values(votes).filter(v=>v==='APPROVE').length;
    const reject=total-approve;
    const passed=approve>reject;
    return `
      <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-5 sm:p-6 shadow-xl">
        <p class="text-[11px] tracking-[0.14em] font-bold ${passed?'text-good':'text-evil'}">VOTE REVEAL</p>
        <h3 class="font-display font-bold text-xl text-white mt-1">${passed?'APPROVED':'REJECTED'} <span class="font-mono text-sm font-bold ${passed?'text-good':'text-evil'}">(${approve}–${reject})</span></h3>
        <p class="text-sm text-stone-400 mt-1">Team: <span class="text-white font-medium">${escape(teamNames)}</span> proposed by ${escape(leaderName)}.</p>
        <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${pub.players.map(p=>{
            const v=votes[p.id];
            return `<div class="flex items-center justify-between rounded-xl px-3.5 py-2.5 border ${v==='APPROVE'?'bg-good/10 border-good/20 text-good':'bg-evil/10 border-evil/20 text-evil'}">
              <span class="text-sm font-medium text-white">${escape(p.name)}</span>
              <span class="text-xs font-extrabold tracking-wide">${v==='APPROVE'?'APPROVE ✓':'REJECT ✕'}</span>
            </div>`;
          }).join('')}
        </div>
        <p class="text-xs text-stone-500 mt-3">Resolving…</p>
      </div>
    `;
  }
  // Check if myId has voted
  const myVoted = !!votes[myId];
  if (myVoted) {
    return `
      <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-6 text-center shadow-xl">
        <p class="text-sm font-medium text-white">You voted — waiting for ${total - voted} more</p>
        <div class="mt-3 w-full bg-white/10 rounded-full h-1.5 overflow-hidden"><div class="h-full bg-gold" style="width:${(voted/total)*100}%"></div></div>
        <p class="text-xs text-stone-500 mt-2">Team: ${escape(teamNames)}</p>
      </div>
    `;
  }
  // My turn to vote (if I'm human)
  const me = state.players.find(p=>p.id===myId);
  if (me?.isBot) {
    return `
      <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-6 text-center shadow-xl">
        <p class="text-sm font-medium text-white">Votes: ${voted}/${total}</p>
        <p class="text-xs text-stone-500 mt-1">Bots are voting…</p>
        <div class="mt-3 w-full bg-white/10 rounded-full h-1.5 overflow-hidden"><div class="h-full bg-gold" style="width:${(voted/total)*100}%"></div></div>
      </div>
    `;
  }
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] backdrop-blur-xl overflow-hidden shadow-xl">
      <div class="px-5 py-4 border-b border-white/[0.06]">
        <p class="text-[11px] tracking-[0.14em] font-bold text-gold">TEAM VOTE — SECRET UNTIL ALL VOTE</p>
        <h3 class="font-display font-bold text-white mt-1">Your vote, <span class="text-gold">${escape(me?.name||'Player')}</span></h3>
        <p class="text-sm text-stone-400 mt-1">Team: <span class="text-white font-medium">${escape(teamNames)}</span></p>
      </div>
      <div class="p-5">
        <div class="grid grid-cols-2 gap-3">
          <button data-team-vote="APPROVE" data-voter="${myId}" class="rounded-2xl border-2 border-good/30 bg-good/10 hover:bg-good/20 p-4 text-center">
            <div class="w-10 h-10 mx-auto rounded-xl bg-good text-obsidian flex items-center justify-center font-bold">✓</div>
            <p class="font-display font-bold text-white mt-2">APPROVE</p>
          </button>
          <button data-team-vote="REJECT" data-voter="${myId}" class="rounded-2xl border-2 border-evil/30 bg-evil/10 hover:bg-evil/20 p-4 text-center">
            <div class="w-10 h-10 mx-auto rounded-xl bg-evil text-white flex items-center justify-center font-bold">✕</div>
            <p class="font-display font-bold text-white mt-2">REJECT</p>
          </button>
        </div>
        <p class="text-center text-xs text-stone-500 mt-3">${voted}/${total} voted</p>
      </div>
    </div>
  `;
}

function renderQuestVotePanel(pub){
  const isReveal=pub.phase===PHASES.QUEST_REVEAL || pub.phaseLock;
  const teamIds=pub.proposal.teamIds;
  const quest=pub.quests[pub.currentQuest];
  if (isReveal) {
    const teamNames=teamIds.map(id=>pub.players.find(p=>p.id===id)?.name).join(', ');
    const failCount=quest ? state.quests[pub.currentQuest]?.failCount : null;
    const shuffled=state.quests[pub.currentQuest]?.votesShuffled || [];
    return `
      <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-6 shadow-xl text-center">
        <p class="text-[11px] tracking-[0.14em] font-bold text-gold">QUEST REVEAL</p>
        <h3 class="font-display font-bold text-xl text-white mt-1">Quest ${pub.currentQuest+1} — ${escape(teamNames)}</h3>
        <div class="mt-4 flex justify-center gap-2 flex-wrap">
          ${shuffled.map(v=>`<span class="px-4 py-2 rounded-xl font-bold text-sm border ${v==='FAIL'?'bg-evil text-white border-evil':'bg-good text-obsidian border-good'}">${v==='FAIL'?'FAIL ✕':'SUCCESS ✓'}</span>`).join('') || '<span class="text-stone-500 text-sm">Revealing…</span>'}
        </div>
        <p class="text-sm text-stone-400 mt-3">${failCount!=null?`${failCount} fail(s) — ${failCount >= quest.failsRequired ? 'Quest FAILED' : 'Quest SUCCEEDED'}`:'Calculating…'}</p>
      </div>
    `;
  }
  const questVotes=state.questVotes||{};
  const onTeam=teamIds.includes(myId);
  if (!onTeam) {
    const voted=Object.keys(questVotes).length;
    return `
      <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-6 text-center shadow-xl">
        <p class="text-sm font-medium text-white">Quest in progress — you are not on team</p>
        <p class="text-xs text-stone-500 mt-1">Team: ${escape(teamIds.map(id=>pub.players.find(p=>p.id===id)?.name).join(', '))} • ${voted}/${teamIds.length} voted secretly</p>
        <div class="mt-3 w-full bg-white/10 rounded-full h-1.5 overflow-hidden"><div class="h-full bg-gold" style="width:${(voted/teamIds.length)*100}%"></div></div>
      </div>
    `;
  }
  if (questVotes[myId]) {
    return `
      <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] p-6 text-center shadow-xl">
        <p class="text-sm font-medium text-white">You voted secretly — waiting for team</p>
        <p class="text-xs text-stone-500 mt-1">${Object.keys(questVotes).length}/${teamIds.length} voted</p>
      </div>
    `;
  }
  const me=state.players.find(p=>p.id===myId);
  const isEvil=me?.allegiance==='EVIL';
  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] backdrop-blur-xl overflow-hidden shadow-xl">
      <div class="px-5 py-4 border-b border-white/[0.06]">
        <p class="text-[11px] tracking-[0.14em] font-bold text-gold">SECRET QUEST — YOUR DEVICE ONLY</p>
        <h3 class="font-display font-bold text-white mt-1">Choose your card, ${escape(me?.name||'')}</h3>
        <p class="text-sm text-stone-400 mt-1">Only you will see this. Good must play Success.</p>
      </div>
      <div class="p-5 text-center">
        <button id="btn-open-quest-vote" data-player="${myId}" class="w-full py-3.5 rounded-xl bg-gold text-obsidian font-extrabold hover:bg-amber-300 shadow-lg shadow-gold/20">
          TAP TO VOTE SECRETLY
        </button>
        <p class="text-xs text-stone-500 mt-2">${Object.keys(questVotes).length}/${teamIds.length} voted secretly</p>
      </div>
    </div>
  `;
}

function renderAssassinationPanel(pub){
  const assassin=state.players.find(p=>p.role==='ASSASSIN');
  const isHumanAssassin=assassin && !assassin.isBot;
  const goodIds=state.players.filter(p=>p.allegiance==='GOOD').map(p=>p.id);
  const goodNames=goodIds.map(id=>pub.players.find(p=>p.id===id)?.name).join(', ');
  const isMeAssassin = assassin?.id === myId;
  if (!isMeAssassin) {
    // If not assassin, show waiting
    return `
      <div class="rounded-2xl bg-evil/10 border border-evil/30 p-6 text-center shadow-xl">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-evil/20 border border-evil/30 flex items-center justify-center text-xl">🗡️</div>
        <h3 class="font-display font-bold text-white mt-3">ASSASSINATION</h3>
        <p class="text-sm text-evil/80 mt-1">${escape(assassin?.name||'Assassin')} is choosing who is Merlin among: ${escape(goodNames)}.</p>
        ${isHumanAssassin ? '<p class="text-xs text-stone-400 mt-2">On their device…</p>' : ''}
      </div>
    `;
  }
  return `
    <div class="rounded-2xl bg-evil/10 border border-evil/30 backdrop-blur-xl overflow-hidden shadow-xl">
      <div class="px-5 py-4 border-b border-evil/20">
        <p class="text-[11px] tracking-[0.14em] font-bold text-evil">ASSASSINATION — YOUR SHOT</p>
        <h3 class="font-display font-bold text-white mt-1">You are Assassin — kill Merlin</h3>
        <p class="text-sm text-stone-300 mt-1">Good won 3 quests! Pick who you think is <span class="text-gold font-bold">Merlin</span>.</p>
      </div>
      <div class="p-5">
        <p class="text-xs font-bold tracking-[0.12em] text-stone-400">TAP A GOOD PLAYER</p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          ${goodIds.map(id=>{
            const nm=pub.players.find(p=>p.id===id)?.name || id;
            return `<button data-assassinate="${id}" class="py-3 rounded-xl bg-white/[0.06] hover:bg-evil/20 border border-white/[0.08] hover:border-evil/30 text-white font-semibold">🗡️ ${escape(nm)}</button>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderGameOver(pub){
  const isGoodWin=pub.winner==='GOOD';
  const reasonText=pub.winReason==='TRACKER' ? 'Evil won by 5 rejected proposals (deadlock).'
    : pub.winReason==='ASSASSINATION' ? (pub.assassination?.success ? 'Assassin killed Merlin!' : 'Assassin missed — Good survives!')
    : isGoodWin ? 'Good completed 3 quests and Merlin survived.' : 'Evil sabotaged 3 quests.';
  const assassinTarget=pub.assassination?.targetId ? pub.players.find(p=>p.id===pub.assassination.targetId)?.name : null;
  const roleRows=state.players.map(p=>{
    const isTarget=p.id===pub.assassination?.targetId;
    return `<tr class="${isTarget?'bg-evil/10':''}">
      <td class="px-3 py-2.5 text-sm font-medium text-white">${escape(p.name)} ${p.isBot?'<span class="text-xs text-stone-500">(Bot)</span>':''} ${isTarget?'<span class="ml-1 px-1.5 py-0.5 rounded bg-evil text-white text-[11px] font-bold">TARGET</span>':''}</td>
      <td class="px-3 py-2.5 text-sm"><span class="px-2 py-1 rounded-full text-xs font-bold border ${p.allegiance==='GOOD'?'bg-good/15 text-good border-good/30':'bg-evil/15 text-evil border-evil/30'}">${escape(p.role)} • ${p.allegiance}</span></td>
    </tr>`;
  }).join('');
  return `
    <div class="rounded-2xl overflow-hidden border ${isGoodWin?'border-good/30 bg-good/10':'border-evil/30 bg-evil/10'} backdrop-blur-xl shadow-xl">
      <div class="px-6 py-6 text-center border-b ${isGoodWin?'border-good/20 bg-good/5':'border-evil/20 bg-evil/5'}">
        <div class="w-16 h-16 mx-auto rounded-2xl ${isGoodWin?'bg-good text-obsidian':'bg-evil text-white'} flex items-center justify-center text-2xl shadow-lg">${isGoodWin?'⚔️':'💀'}</div>
        <h2 class="font-display font-extrabold text-2xl tracking-wide ${isGoodWin?'text-good':'text-evil'} mt-3">${isGoodWin?'GOOD PREVAILS':'EVIL TRIUMPHS'}</h2>
        <p class="text-sm ${isGoodWin?'text-cyan-100/80':'text-rose-100/80'} mt-1 max-w-[520px] mx-auto">${escape(reasonText)}</p>
        ${assassinTarget?`<p class="text-xs text-stone-400 mt-2">Assassin chose: <span class="text-white font-bold">${escape(assassinTarget)}</span> — ${pub.assassination.success?'was Merlin':'was not Merlin'}</p>`:''}
        <div class="mt-5 flex gap-3 justify-center">
          <button id="btn-play-again" class="px-6 py-3 rounded-xl bg-white text-obsidian font-extrabold hover:bg-stone-100">PLAY AGAIN</button>
          <button id="btn-review-log" class="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold border border-white/10">Review Log</button>
        </div>
      </div>
      <div class="p-5 sm:p-6">
        <h4 class="font-display font-bold text-sm tracking-[0.12em] text-white">ROLE REVEAL</h4>
        <div class="mt-3 rounded-xl overflow-hidden border border-white/10">
          <table class="w-full text-left border-collapse">
            <thead><tr class="bg-white/[0.06] border-b border-white/10"><th class="px-3 py-2 text-xs font-bold tracking-[0.12em] text-stone-400">PLAYER</th><th class="px-3 py-2 text-xs font-bold tracking-[0.12em] text-stone-400">ROLE</th></tr></thead>
            <tbody class="divide-y divide-white/[0.06]">${roleRows}</tbody>
          </table>
        </div>
        <div class="mt-4 grid grid-cols-5 gap-2 text-center">
          ${pub.quests.map((q,i)=>`<div class="rounded-xl border p-2.5 ${q.status==='SUCCESS'?'bg-good/10 border-good/20':q.status==='FAIL'?'bg-evil/10 border-evil/20':'bg-white/[0.04] border-white/[0.06]'}">
            <p class="text-[11px] font-bold tracking-wide ${q.status==='SUCCESS'?'text-good':q.status==='FAIL'?'text-evil':'text-stone-500'}">Q${i+1}</p>
            <p class="text-sm font-bold text-white">${q.status==='SUCCESS'?'Good':q.status==='FAIL'?'Evil':'—'}</p>
            <p class="text-[11px] text-stone-500">${q.failCount!=null?`${q.failCount} fail`:''}</p>
          </div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function bindDynamicEvents(pub){
  // — HOME (Pick a game) and JOIN_CODE intercept — must be before lobby bindings —
  if (pub.phase===PHASES.LOBBY && uiMode==='HOME' && !isJoinerMode) {
    document.getElementById('input-home-search')?.addEventListener('input', (e)=>{
      homeSearch = e.target.value;
      // live filter without full re-render to keep focus
      const q = homeSearch.toLowerCase().trim();
      document.querySelectorAll('[data-game-id]').forEach(card=>{
        const title = card.dataset.gameId || '';
        const text = card.textContent.toLowerCase();
        const show = !q || text.includes(q) || title.includes(q);
        card.style.display = show ? '' : 'none';
      });
      const countEl = document.querySelector('#home-games-count');
      if (countEl) {
        const visible = Array.from(document.querySelectorAll('[data-game-id]')).filter(c=> c.style.display!=='none').length;
        countEl.textContent = visible + ' games';
      }
    });
    document.getElementById('btn-home-join-banner')?.addEventListener('click', ()=>{
      uiMode='JOIN_CODE'; joinCodeInput=''; queueRender();
    });
    document.querySelectorAll('[data-game-id]')?.forEach(el=>{
      el.addEventListener('click', ()=>{
        if (el.dataset.gameId==='quest-of-shadows') { showGamePopup=true; queueRender(); }
        else toast('Coming soon','default');
      });
    });
    document.getElementById('btn-popup-close')?.addEventListener('click', ()=>{ showGamePopup=false; queueRender(); });
    document.getElementById('game-popup-overlay')?.addEventListener('click', (e)=>{
      if (e.target.id==='game-popup-overlay') { showGamePopup=false; queueRender(); }
    });
    document.getElementById('btn-popup-play')?.addEventListener('click', async ()=>{
      const hostNameInput=document.getElementById('popup-host-name');
      let hostName=(hostNameInput?.value||'').trim();
      if (!hostName) return toast('Enter your name','error');
      if (hostName.length>16) return toast('Name max 16 chars','error');
      if (hostName.length<2) return toast('Name too short','error');
      const newCode = generateRoomCode();
      persistLobbyCode(newCode);
      lobbyDraft = { roomCode: newCode, players: [{ id: lobbyPlayerId(), name: hostName, isBot: false }], extraRoles: { percival: true, morgana: true, mordred: false, oberon: false } };
      saveLobbyDraft();
      try { await syncLobbyToServer(); } catch(_){}
      lobbyRoomCache = { code: newCode, players: lobbyDraft.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot})), extraRoles: {...lobbyDraft.extraRoles} };
      history.replaceState(null,'', window.location.pathname + '?room=' + newCode);
      uiMode='LOBBY'; showGamePopup=false; queueRender();
      startLobbyPoll();
      toast('Room ' + newCode + ' created as ' + hostName,'success');
    });
    document.getElementById('btn-popup-howto')?.addEventListener('click', ()=>{
      showGamePopup=false; queueRender();
      document.getElementById('rules-dialog')?.showModal();
    });
    document.getElementById('btn-popup-join')?.addEventListener('click', ()=>{
      showGamePopup=false; uiMode='JOIN_CODE'; joinCodeInput=''; queueRender();
    });
    return;
  }
  if (pub.phase===PHASES.LOBBY && uiMode==='JOIN_CODE') {
    const inp = document.getElementById('input-join-code');
    const btn = document.getElementById('btn-join-enter');
    const err = document.getElementById('join-code-error');
    const disp = document.getElementById('join-code-display');
    inp?.addEventListener('input', (e)=>{
      let v = e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
      joinCodeInput = v;
      e.target.value = v;
      if (disp) {
        disp.innerHTML = v ? v.split('').map(ch=> `<span>${escape(ch)}</span>`).join('<span class="w-1"></span>') : '<span class="text-white/20 tracking-[0.6em]">----</span>';
      }
      if (btn) {
        const canEnter = v.length===4;
        btn.disabled = !canEnter;
        btn.className = canEnter
          ? "w-full py-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-black border border-emerald-500 transition-colors cursor-pointer"
          : "w-full py-4 rounded-full bg-white/10 text-white/30 font-bold cursor-not-allowed border border-white/5 transition-colors";
      }
      if (err) err.textContent = '';
    });
    inp?.addEventListener('keydown', (e)=>{
      if (e.key==='Enter' && joinCodeInput.length===4) {
        e.preventDefault();
        window.location.href = window.location.pathname + '?room=' + joinCodeInput;
      }
    });
    // auto-focus
    setTimeout(()=> inp?.focus(), 50);
    document.getElementById('btn-join-back')?.addEventListener('click', ()=>{
      uiMode='HOME'; joinCodeInput=''; queueRender();
    });
    btn?.addEventListener('click', ()=>{
      const code = joinCodeInput.trim().toUpperCase();
      if (!isValidRoomCode(code)) { if (err) err.textContent='Enter 4 letters A-Z'; return; }
      window.location.href = window.location.pathname + '?room=' + code;
    });
    return;
  }
  // Lobby Table Party events (including joiner back)
  if (pub.phase===PHASES.LOBBY) {
    document.getElementById('btn-join-back')?.addEventListener('click', async ()=>{
      if (hasJoined && myId) {
        try { net.leaveRoom(lobbyDraft.roomCode, myId); } catch(_){}
        hasJoined=false;
        try{ localStorage.removeItem('avalon:myName:'+lobbyDraft.roomCode); }catch(_){}
        try{ localStorage.removeItem('avalon:myId:'+lobbyDraft.roomCode); }catch(_){}
      }
      isJoinerMode=false;
      hasJoined=false;
      history.replaceState(null,'',window.location.pathname);
      uiMode='HOME';
      showGamePopup=false;
      lobbyDraft=defaultLobby();
      if (roomUnsub) try{ roomUnsub(); }catch(_){}
      roomUnsub=null;
      stopLobbyPoll();
      queueRender();
    });
    document.getElementById('btn-share-link')?.addEventListener('click', async (e)=>{
      const link = e.currentTarget.dataset.link;
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(link);
        else { const t=document.createElement('input'); t.value=link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
        toast('Invite link copied!', 'success');
      } catch { toast(link, 'default'); }
    });
    // Joiner join button
    document.getElementById('btn-join-room')?.addEventListener('click', async ()=>{
      const input = document.getElementById('input-join-name');
      const name = (input?.value || '').trim() || `Player${Math.floor(Math.random()*900)}`;
      if (!name) return toast('Enter a name', 'error');
      if (name.length>16) return toast('Name max 16 chars', 'error');
      try {
        const newId = `p_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2,5)}`;
        const player = { id: newId, name, isBot: false };
        await net.joinRoom(lobbyDraft.roomCode, player);
        myId = newId;
        setMyId(lobbyDraft.roomCode, myId);
        try { localStorage.setItem('avalon:myName:'+lobbyDraft.roomCode, name); } catch(_){}
        hasJoined = true;
        // Keep isJoinerMode true so joiner stays on waiting screen until host starts
        toast('Joined ' + lobbyDraft.roomCode + ' as ' + name + ' — waiting for host', 'success');
        lobbyRoomCache = await net.getRoomAsync(lobbyDraft.roomCode);
        queueRender();
      } catch(e){ toast(e.message, 'error'); }
    });
// Add Bot — host only, push directly to KV (single source of truth)
    document.getElementById('btn-add-bot')?.addEventListener('click', async ()=>{
      const room = lobbyRoomCache || await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>null) || { code: lobbyDraft.roomCode, players: lobbyDraft.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot})), extraRoles: {...lobbyDraft.extraRoles} };
      if ((room.players||[]).length>=10) return toast('Max 10 players','error');
      const inp=document.getElementById('input-add-player');
      let name=(inp?.value||'').trim();
      if (name) {
        if (name.length>16) return toast('Name max 16 chars','error');
        if (room.players.some(p=>p.name.toLowerCase()===name.toLowerCase())) return toast('Name already taken','error');
      } else {
        const botNames=['Galahad','Percival','Tristan','Lancelot','Gawain','Kay','Bors','Ector'];
        name=botNames[Math.floor(Math.random()*botNames.length)] + Math.floor(Math.random()*900);
        let tries=0;
        while (room.players.some(p=>p.name===name) && tries<10) {
          name=botNames[Math.floor(Math.random()*botNames.length)] + Math.floor(Math.random()*900);
          tries++;
        }
      }
      const newPlayer = { id: lobbyPlayerId(), name, isBot: true };
      room.players.push(newPlayer);
      if (inp) inp.value='';
      try {
        await net.pushRoom(lobbyDraft.roomCode, room);
        lobbyRoomCache = room;
        lobbyDraft.players = room.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
        saveLobbyDraft();
      } catch(e){ toast('Failed to add bot','error'); }
      queueRender();
    });
    // Avatar edit — straightforward: host edits via KV, joiner edits own via KV
    document.querySelectorAll('[data-edit-idx]')?.forEach(el=>{
      el.addEventListener('click', (e)=>{
        if (e.target.closest('[data-kick-idx]')) return;
        const idx=Number(el.dataset.editIdx);
        const room = lobbyRoomCache || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles };
        const sourcePlayers = room.players || lobbyDraft.players;
        const p=sourcePlayers[idx];
        if (!p) return;
        let myName2=null; try{ myName2=localStorage.getItem('avalon:myName:'+lobbyDraft.roomCode); }catch(_){}
        let myId2=null; try{ myId2=localStorage.getItem('avalon:myId:'+lobbyDraft.roomCode); }catch(_){}
        const isYou = isJoinerMode ? (p.id ? p.id===myId2 : p.name===myName2) : (p.id ? p.id===(room.players[0]?.id || lobbyDraft.players[0]?.id) : idx===0);
        if (!isJoinerMode) {
          if (!p.isBot && !isYou) return toast('You can only edit yourself or bots','default');
        } else {
          if (p.isBot) return toast('Only host can edit bots','default');
          if (!isYou) return toast('You can only edit your own name','default');
        }
        const cur=p.name||'';
        const overlay=document.createElement('div');
        overlay.className='fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
        overlay.innerHTML=`
          <div class="w-full max-w-[360px] rounded-[20px] bg-[#1e1a2e] border border-white/10 p-5 text-center shadow-2xl">
            <div class="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-200 to-orange-100 border-2 border-emerald-400 flex items-center justify-center text-xl font-black text-black">${escape(cur.slice(0,2).toUpperCase()||'?')}</div>
            <h3 class="font-bold text-white mt-3">Edit player</h3>
            <p class="text-xs text-white/50">${p.isBot?'BOT':'Human'} ${isYou?'• YOU':''}</p>
            <input id="avatar-edit-input" maxlength="16" value="${escape(cur)}" placeholder="Player name" class="mt-4 w-full px-3.5 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/30 text-sm font-medium outline-none focus:border-[#7ec8e6] text-center" />
            <div class="mt-4 grid grid-cols-2 gap-2">
              <button id="avatar-edit-cancel" class="py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-semibold">Cancel</button>
              <button id="avatar-edit-save" class="py-3 rounded-xl bg-[#7ec8e6] hover:bg-[#a0d8f0] text-[#0a1e2e] font-black">Save</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        const inp2=overlay.querySelector('#avatar-edit-input');
        setTimeout(()=> inp2?.select(), 30);
        const close=()=> overlay.remove();
        overlay.addEventListener('click', (e)=>{ if(e.target===overlay) close(); });
        overlay.querySelector('#avatar-edit-cancel')?.addEventListener('click', close);
        overlay.querySelector('#avatar-edit-save')?.addEventListener('click', async ()=>{
          const next=(inp2.value||'').trim().slice(0,16);
          if (!next) return toast('Name cannot be empty','error');
          const room2 = lobbyRoomCache || await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>null) || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles };
          const checkPlayers = room2.players || [];
          if (checkPlayers.some((x,i)=> i!==idx && x.name.toLowerCase()===next.toLowerCase())) return toast('Name already taken','error');
          if (!isJoinerMode) {
            try {
              const target = room2.players[idx];
              if (!target) throw new Error('Player not found');
              target.name = next;
              await net.pushRoom(lobbyDraft.roomCode, room2);
              lobbyRoomCache = room2;
              lobbyDraft.players = room2.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
              saveLobbyDraft();
              close(); queueRender(); toast('Name updated','success');
            } catch(err){ toast(err.message,'error'); }
          } else {
            try {
              const room3 = await net.getRoomAsync(lobbyDraft.roomCode);
              if (!room3 || !Array.isArray(room3.players)) throw new Error('Room not found');
              const myId = myId2;
              const serverIdx = myId ? room3.players.findIndex(x=> x.id===myId) : room3.players.findIndex(x=> x.name===myName2);
              if (serverIdx===-1) throw new Error('Your player not found');
              if (room3.players.some((x,i)=> i!==serverIdx && x.name.toLowerCase()===next.toLowerCase())) return toast('Name already taken','error');
              room3.players[serverIdx].name = next;
              try{ localStorage.setItem('avalon:myName:'+lobbyDraft.roomCode, next); }catch(_){}
              await net.pushRoom(lobbyDraft.roomCode, room3);
              lobbyRoomCache = await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>room3);
              close(); queueRender(); toast('Name updated','success');
            } catch(err){ toast(err.message||'Failed to update name','error'); }
          }
        });
        inp2?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') overlay.querySelector('#avatar-edit-save')?.click(); if(e.key==='Escape') close(); });
      });
    });
    // Kick via X on avatar — only host can kick, not self — direct KV write
    document.querySelectorAll('[data-kick-idx]')?.forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        if (isJoinerMode) return toast('Only host can kick','default');
        const idx=Number(btn.dataset.kickIdx);
        const room = lobbyRoomCache || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles };
        const name=(room.players[idx]|| lobbyDraft.players[idx])?.name||'Player';
        if (idx===0) return toast('Cannot kick yourself','default');
        if ((room.players||[]).length<=1) return toast('Need at least 1 player','error');
        showConfirm({ title:'Kick player?', body:`Remove <span class="text-white font-bold">${escape(name)}</span>?`, confirmText:'Kick', variant:'danger', onConfirm: async ()=>{
          try {
            const latest = await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>room);
            const target = (latest.players||[])[idx] || room.players[idx];
            const targetId = target?.id;
            let newPlayers;
            if (targetId) newPlayers = latest.players.filter(p=>p.id!==targetId);
            else { newPlayers = latest.players.slice(); newPlayers.splice(idx,1); }
            latest.players = newPlayers;
            await net.pushRoom(lobbyDraft.roomCode, latest);
            lobbyRoomCache = latest;
            lobbyDraft.players = latest.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
            saveLobbyDraft();
          } catch(e){ console.warn(e); }
          queueRender();
        }});
      });
    });
    document.querySelectorAll('[data-extra]')?.forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const key=btn.dataset.extra;
        const room = lobbyRoomCache || await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>null) || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: {...lobbyDraft.extraRoles} };
        room.extraRoles = room.extraRoles || {...lobbyDraft.extraRoles};
        const isEvil = ['morgana','mordred','oberon'].includes(key);
        const wasActive = !!room.extraRoles[key];
        if (!wasActive && isEvil) {
          const max = getMaxExtraEvil((room.players||[]).length);
          const enabled = ['morgana','mordred','oberon'].filter(k=> !!room.extraRoles[k]).length;
          if (enabled >= max) {
            toast(`Max ${max} evil extra for ${(room.players||[]).length} players — remove one first`,'error');
            return;
          }
        }
        room.extraRoles[key]=!room.extraRoles[key];
        try {
          await net.pushRoom(lobbyDraft.roomCode, { extraRoles: room.extraRoles });
          lobbyRoomCache = await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>room);
          lobbyDraft.extraRoles = lobbyRoomCache.extraRoles || room.extraRoles;
          saveLobbyDraft();
        } catch(e){ console.warn(e); }
        render();
      });
    });
    // Change game in lobby — no need to remake room
    document.getElementById('select-game')?.addEventListener('change', async (e)=>{
      const newGameId = e.target.value;
      const curGameId = (lobbyRoomCache?.gameId || lobbyDraft.gameId || 'quest-of-shadows');
      if (!newGameId || newGameId === curGameId) return;
      if (isJoinerMode) return toast('Only host can change game','default');
      const room = lobbyRoomCache || await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>null) || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles, gameId: curGameId };
      const game = getGame(newGameId);
      room.gameId = newGameId;
      room.gameOptions = game ? {...game.defaultOptions} : {};
      if (newGameId === 'quest-of-shadows') {
        room.extraRoles = {...game.defaultOptions};
        lobbyDraft.extraRoles = {...game.defaultOptions};
      } else {
        room.extraRoles = undefined;
      }
      room.state = null;
      try {
        await net.pushRoom(lobbyDraft.roomCode, room);
        lobbyRoomCache = room;
        lobbyDraft.gameId = newGameId;
        lobbyDraft.extraRoles = room.extraRoles || room.gameOptions;
        saveLobbyDraft();
        toast(`Switched to ${game ? game.label : newGameId}`,'success');
      } catch(err){ toast('Failed to change game','error'); }
      queueRender();
    });
    document.getElementById('btn-start')?.addEventListener('click', async ()=>{
      try {
        // Single source of truth: KV room
        const room = lobbyRoomCache || await net.getRoomAsync(lobbyDraft.roomCode).catch(()=>null) || { code: lobbyDraft.roomCode, players: lobbyDraft.players, extraRoles: lobbyDraft.extraRoles };
        const latestPlayers = (room.players || []).map(p=>({ id: p.id, name: p.name, isBot: !!p.isBot }));
        const effectiveOpts = getEffectiveExtraRoles(latestPlayers.length, room.extraRoles || lobbyDraft.extraRoles);
        // If capped, update lobby to reflect effective
        if (JSON.stringify(effectiveOpts) !== JSON.stringify(room.extraRoles || lobbyDraft.extraRoles)) {
          room.extraRoles = effectiveOpts;
          try{ await net.pushRoom(lobbyDraft.roomCode, { extraRoles: effectiveOpts }); }catch(_){}
          lobbyRoomCache = room;
          lobbyDraft.extraRoles = effectiveOpts;
          saveLobbyDraft();
          toast(`Balanced roles for ${latestPlayers.length} players`,'default');
        }
        const players=latestPlayers.map((p,i)=>({ id: p.id || `p${i}_${Date.now().toString(36).slice(-3)}_${Math.random().toString(36).slice(2,5)}`, name: String(p.name).trim() || `Player ${i+1}`, isBot: !!p.isBot }));
        const names=players.map(p=>p.name);
        if (new Set(names).size!==names.length) throw new Error('Duplicate names — make each unique');
        if (names.some(n=>n.length>16)) throw new Error('Names max 16 chars');
        if (players.length<5) throw new Error('Need at least 5 players (add bots or friends)');
        if (players.length>10) throw new Error('Max 10 players');
        selectedTeam=[];
        myId=players[0].id;
        setMyId(lobbyDraft.roomCode, myId);
        // Store mapping from name to new ID for joiners to find themselves
        try {
          const nameToId = {};
          players.forEach(p=> nameToId[p.name] = p.id);
          localStorage.setItem('avalon:nameToId:'+lobbyDraft.roomCode, JSON.stringify(nameToId));
        } catch(_){}
        dispatch({ type:'SETUP_GAME', payload:{ players, opts: effectiveOpts, roomCode: lobbyDraft.roomCode }});
        try {
          await net.createRoom(lobbyDraft.roomCode, players[0]);
          const roomPlayers = players.map(p=>({id:p.id, name:p.name, isBot:p.isBot}));
          await net.pushRoom(lobbyDraft.roomCode, { players: roomPlayers, state, hostId: players[0].id, extraRoles: effectiveOpts });
          // Host must also subscribe to game updates (so it sees joiner votes)
          stopLobbyPoll();
          if (roomUnsub) try{ roomUnsub(); }catch(_){}
          roomUnsub = net.subscribe(lobbyDraft.roomCode, (msg)=>{
            if (msg.state && JSON.stringify(msg.state) !== JSON.stringify(state)) {
              state = msg.state; storage.save(state); queueRender();
              if (state.phase===PHASES.TEAM_PROPOSAL) onEnterTeamProposal();
              if (state.phase===PHASES.TEAM_VOTE) onEnterTeamVote(state.voteGeneration);
              if (state.phase===PHASES.QUEST_VOTE) onEnterQuestVote();
            }
          });
          // Persist that host has started, so joiner's isJoinerMode stays correct
          hasJoined = false;
          isJoinerMode = false;
        } catch(e){ console.warn('[createRoom]', e); }
      } catch(e){ toast(e.message,'error'); }
    });
  }

  // Role reveal — exact Table Party flow (no popup, just mark ready) — back handled globally single confirm
  if (pub.phase===PHASES.ROLE_REVEAL) {
    document.getElementById('btn-exact-rules')?.addEventListener('click', ()=>{
      document.getElementById('rules-dialog')?.showModal();
    });
    const handleReveal = ()=>{
      const pid = myId || state.players[0]?.id;
      if (!pid) return;
      // Don't show popup — just mark as ready, info is already on screen
      dispatch({type:'REVEAL_ROLE', payload:{playerId: pid}});
      toast('You are ready', 'success');
    };
    document.getElementById('btn-private-reveal')?.addEventListener('click', handleReveal);
    document.getElementById('btn-private-reveal-exact')?.addEventListener('click', handleReveal);
    if (isTestMode()) {
      document.getElementById('select-viewas')?.addEventListener('change', (e)=>{
        setMyId(pub.roomCode || lobbyDraft.roomCode, e.target.value);
        render();
      });
    }
    document.getElementById('btn-back-lobby')?.addEventListener('click', ()=>{
      showConfirm({ title:'Back to lobby?', body:'This will discard roles and return to setup.', confirmText:'Back to lobby', onConfirm:()=>dispatch({type:'RESET'}) });
    });
  }

  // In-game viewAs switcher — only for testing
  if (isTestMode()) {
    document.getElementById('select-viewas-ingame')?.addEventListener('change', (e)=>{
      setMyId(pub.roomCode || lobbyDraft.roomCode, e.target.value);
      render();
    });
    document.getElementById('select-viewas')?.addEventListener('change', (e)=>{
      setMyId(pub.roomCode || lobbyDraft.roomCode, e.target.value);
      render();
    });
  }
  // Exact header buttons (visible in-game) — single confirm, host deletes KV
  document.getElementById('btn-exact-back')?.addEventListener('click', ()=>{
    showConfirm({ title:'Back to main menu?', body:'Leave the game and go back to Pick a game? This will close the room for everyone if you are host.', confirmText:'Back to menu', variant:'danger', onConfirm: async ()=>{
      const code=state.roomCode || lobbyDraft.roomCode;
      const isHost = !isJoinerMode && state.players[0]?.id===myId;
      if (isHost || state.phase===PHASES.ROLE_REVEAL) {
        try { await net.deleteRoom(code); } catch(_){}
        try { localStorage.removeItem('avalon:lobby:'+code); }catch(_){}
        try { localStorage.removeItem('avalon:lastRoomCode'); }catch(_){}
        stopLobbyPoll();
        if (roomUnsub) try{ roomUnsub(); }catch(_){}
        roomUnsub=null;
      } else {
        if (myId) try{ net.leaveRoom(code, myId); }catch(_){}
        try{ localStorage.removeItem('avalon:myName:'+code); }catch(_){}
        try{ localStorage.removeItem('avalon:myId:'+code); }catch(_){}
      }
      hasJoined=false;
      isJoinerMode=false;
      showGamePopup=false;
      uiMode='HOME';
      lobbyDraft=defaultLobby();
      dispatch({type:'RESET'});
      history.replaceState(null,'',window.location.pathname);
      queueRender();
    }});
  });
  document.getElementById('btn-exact-rules')?.addEventListener('click', ()=>{
    document.getElementById('rules-dialog')?.showModal();
  });
  document.getElementById('btn-peek-role')?.addEventListener('click', ()=>{
    const me=state.players.find(p=>p.id===myId);
    if(!me) return toast('No role yet', 'error');
    const vision=getVision(state, myId);
    showRoleReveal({
      playerName: me.name,
      role: me.role,
      allegiance: me.allegiance,
      visionIds: vision.sees,
      allPlayers: state.players,
      isLast: false,
      onHide: ()=>{},
      onNext: ()=>{}
    });
  });
  document.getElementById('btn-back-lobby')?.addEventListener('click', ()=>{
    showConfirm({ title:'Back to lobby?', body:'This will discard roles and return to setup.', confirmText:'Back to lobby', onConfirm:()=>dispatch({type:'RESET'}) });
  });

  // Proposal — handles both old and exact UI
  if (pub.phase===PHASES.TEAM_PROPOSAL) {
    document.querySelectorAll('[data-player-id]').forEach(card=>{
      card.addEventListener('click', ()=>{
        const pid=card.dataset.playerId;
        const leader=state.players[state.leaderIndex];
        if (!leader || leader.isBot) return;
        if (leader.id !== myId) return; // not my turn
        const quest=pub.quests[pub.currentQuest];
        const need=quest?.size||0;
        if (selectedTeam.includes(pid)) selectedTeam=selectedTeam.filter(id=>id!==pid);
        else {
          if (selectedTeam.length>=need) selectedTeam=[...selectedTeam.slice(1), pid];
          else selectedTeam=[...selectedTeam, pid];
        }
        render();
      });
    });
    const confirmTeam = ()=>{
      const leaderId=state.players[state.leaderIndex]?.id;
      if (leaderId !== myId) return toast('Not your turn', 'error');
      const need = pub.quests[pub.currentQuest]?.size || 0;
      if (selectedTeam.length !== need) return toast(`Pick ${need}`, 'error');
      dispatch({type:'PROPOSE_TEAM', payload:{teamIds:selectedTeam.slice(), proposerId:leaderId}});
      selectedTeam=[];
    };
    document.getElementById('btn-clear-team')?.addEventListener('click', ()=>{ selectedTeam=[]; render(); });
    document.getElementById('btn-confirm-team')?.addEventListener('click', confirmTeam);
    document.getElementById('btn-confirm-team-exact')?.addEventListener('click', confirmTeam);
  }

  document.querySelectorAll('[data-team-vote]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const vote=e.currentTarget.dataset.teamVote;
      const voter=e.currentTarget.dataset.voter;
      if (voter !== myId) return toast('Not your vote', 'error');
      dispatch({type:'SUBMIT_TEAM_VOTE', payload:{playerId:voter, vote}});
    });
  });

  // Exact quest vote — Succeed / Fail buttons (no modal)
  document.getElementById('btn-quest-succeed')?.addEventListener('click', ()=>{
    if (!pub.proposal.teamIds.includes(myId)) return toast('Not on team', 'error');
    try{ dispatch({type:'SUBMIT_QUEST_VOTE', payload:{playerId:myId, vote:'SUCCESS'}});}catch(e){ toast(e.message,'error'); }
  });
  document.getElementById('btn-quest-fail')?.addEventListener('click', ()=>{
    const me = state.players.find(p=>p.id===myId);
    if (!me || me.allegiance!=='EVIL') return toast('Good must Succeed', 'error');
    if (!pub.proposal.teamIds.includes(myId)) return toast('Not on team', 'error');
    try{ dispatch({type:'SUBMIT_QUEST_VOTE', payload:{playerId:myId, vote:'FAIL'}});}catch(e){ toast(e.message,'error'); }
  });
  // Keep old modal flow for fallback
  document.getElementById('btn-open-quest-vote')?.addEventListener('click', (e)=>{
    const pid=e.currentTarget.dataset.player;
    if (pid !== myId) return toast('Not your turn', 'error');
    const p=state.players.find(x=>x.id===pid);
    if(!p) return;
    const isEvil=p.allegiance==='EVIL';
    showQuestVote({ playerName:p.name, isEvil, onSubmit:(vote)=>{
      try{ dispatch({type:'SUBMIT_QUEST_VOTE', payload:{playerId:pid, vote}});}catch(err){ toast(err.message,'error'); }
    }});
  });

  // Assassin exact — tapping avatar selects, bottom button confirms
  document.querySelectorAll('[data-assassinate]').forEach(btn=>{
    const isExact = document.getElementById('btn-confirm-assassinate') !== null;
    btn.addEventListener('click', (e)=>{
      const targetId=e.currentTarget.dataset.assassinate;
      if (isExact) {
        // Exact flow: just select, don't dispatch immediately
        selectedTeam = [targetId];
        render();
      } else {
        const targetName=pub.players.find(p=>p.id===targetId)?.name || targetId;
        showConfirm({ title:'Confirm assassination?', body:`Assassinate <span class="text-white font-bold">${escape(targetName)}</span> as Merlin?`, confirmText:'ASSASSINATE 🗡️', variant:'danger', onConfirm:()=>dispatch({type:'ASSASSINATE', payload:{targetId}}) });
      }
    });
  });
  document.getElementById('btn-confirm-assassinate')?.addEventListener('click', ()=>{
    const targetId = selectedTeam[0];
    if (!targetId) return toast('Choose one', 'error');
    const targetName=pub.players.find(p=>p.id===targetId)?.name || targetId;
    showConfirm({ title:'Name Merlin?', body:`Name <span class="text-white font-bold">${escape(targetName)}</span> as Merlin? This ends the game.`, confirmText:`Name ${escape(targetName)}`, variant:'danger', onConfirm:()=>{
      dispatch({type:'ASSASSINATE', payload:{targetId}});
      selectedTeam=[];
    }});
  });
  document.getElementById('btn-next-quest')?.addEventListener('click', ()=>{
    // Quest reveal -> next quest is already handled by reducer's RESOLVE_QUEST auto, but for exact UI we need to trigger it
    // In our flow, QUEST_REVEAL is a locked phase that auto-resolves after 1.6s. The Next quest button should just wait, but if user clicks, we can dispatch RESOLVE_QUEST if still in REVEAL
    // Actually after votes, we go to QUEST_REVEAL then auto to next. The button is just for pacing — we can dispatch if needed
    if (pub.phase===PHASES.QUEST_REVEAL) {
      // Already in reveal, the next quest will be triggered by auto timer; but allow manual
      // For now, do nothing — auto will handle. If stuck, force
      toast('Quest will advance shortly', 'default');
    }
  });

  document.getElementById('btn-play-again')?.addEventListener('click', ()=>{
    selectedTeam=[];
    const code=pub.roomCode || lobbyDraft.roomCode;
    lobbyDraft=defaultLobby();
    lobbyDraft.roomCode=code;
    hasJoined = false;
    isJoinerMode = false;
    if (roomUnsub) try{ roomUnsub(); }catch(_){}
    roomUnsub = null;
    dispatch({type:'RESET'});
    try{ localStorage.removeItem('avalon:myId:'+code);}catch(_){}
    try{ localStorage.removeItem('avalon:myName:'+code);}catch(_){}
    try{ localStorage.removeItem('avalon:nameToId:'+code);}catch(_){}
    stopLobbyPoll();
    syncLobbyToServer();
    startLobbyPoll();
  });
  document.getElementById('btn-review-log')?.addEventListener('click', ()=>{
    document.getElementById('log-scroll')?.scrollIntoView({behavior:'smooth', block:'center'});
    toast('Scrolled to live log','default');
  });
}

function escape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function bindGlobal(){
  document.getElementById('btn-reset')?.addEventListener('click', ()=>{
    if (state.phase===PHASES.LOBBY){
      lobbyDraft=defaultLobby();
      // Keep roomCode stable unless user wants new
      render(); toast('Lobby reset','default'); return;
    }
    showConfirm({ title:'New game?', body:'This will discard the current game and return to the lobby.', confirmText:'New Game', variant:'danger', onConfirm:()=>{
      selectedTeam=[];
      const code=state.roomCode || lobbyDraft.roomCode;
      lobbyDraft=defaultLobby(); lobbyDraft.roomCode=code;
      hasJoined = false;
      isJoinerMode = false;
      if (roomUnsub) try{ roomUnsub(); }catch(_){}
      roomUnsub = null;
      stopLobbyPoll();
      dispatch({type:'RESET'});
      try{ net.updateRoomState(code, state); }catch(_){}
      try{ localStorage.removeItem('avalon:myId:'+code);}catch(_){}
      try{ localStorage.removeItem('avalon:myName:'+code);}catch(_){}
      storage.clear();
      syncLobbyToServer();
      startLobbyPoll();
    }});
  });
  document.getElementById('btn-rules')?.addEventListener('click', ()=>{
    const dlg=document.getElementById('rules-dialog');
    if(dlg && typeof dlg.showModal==='function') dlg.showModal();
    else toast('Rules: Good needs 3 quests; Evil needs 3 fails, 5 rejects, or kill Merlin.','default');
  });
  const rulesDlg=document.getElementById('rules-dialog');
  rulesDlg?.addEventListener('click', (e)=>{ if(e.target===rulesDlg) rulesDlg.close(); });
}

async function init(){
  try{ window.__AVALON_BOOTED__=true; }catch(_){}
  bindGlobal();
  // Handle invite code from URL — persist and treat as join
  const inviteCode = net.parseInviteCode();
  let isJoiner = false;
  if (inviteCode) {
    if (inviteCode !== lobbyDraft.roomCode) {
      // Check if room actually exists on server — retry 4×400ms (host push race + KV eventual consistency)
      let existing = null;
      for (let attempt=0; attempt<4; attempt++) {
        try { existing = await net.getRoomAsync(inviteCode); } catch(_){}
        if (existing && (existing.state || (existing.players && existing.players.length))) break;
        await new Promise(r=> setTimeout(r, 400));
      }
      if (existing && (existing.state || (existing.players && existing.players.length))) {
        // Room exists — joining
        lobbyDraft.roomCode = inviteCode;
        persistLobbyCode(inviteCode);
        isJoiner = true;
        isJoinerMode = true;
        toast('Joining room ' + inviteCode, 'success');
        // Cache for lobby display
        lobbyRoomCache = existing;
      } else {
        // No room yet, treat as host creating with that code
        lobbyDraft.roomCode = inviteCode;
        persistLobbyCode(inviteCode);
        toast('Creating room ' + inviteCode, 'success');
        // Host will sync lobby immediately below
      }
    } else {
      // Same code as local — could be host refresh or joiner refresh
      // Check if we are already part of room
      try {
        const existing = await net.getRoomAsync(inviteCode);
        if (existing && existing.players && existing.players.length > 1) {
          // If local myId not in room, treat as joiner pending
          const myKey = 'avalon:myId:' + inviteCode;
          let my = null; try { my = localStorage.getItem(myKey); } catch(_){}
          const inRoom = my && existing.players.some(p=> p.id===my || p.name===lobbyDraft.players[0]?.name);
          if (!inRoom && !existing.state) {
            isJoiner = true;
            isJoinerMode = true;
            lobbyRoomCache = existing;
          }
        }
      } catch(_){}
    }
  }
  isJoinerMode = isJoiner;
  // Determine uiMode — HOME when no invite, LOBBY when invite present or already in lobby
  if (inviteCode) uiMode = 'LOBBY';
  else uiMode = 'HOME';
  // Determine if joiner already joined (for waiting screen)
  if (isJoiner) {
    try {
      const myName = localStorage.getItem('avalon:myName:'+lobbyDraft.roomCode);
      if (myName && lobbyRoomCache && lobbyRoomCache.players && lobbyRoomCache.players.some(p=>p.name===myName)) hasJoined = true;
    } catch(_){}
  }
  // If host (not joiner) and in lobby mode, sync lobby to server so joiners can find it — await so joiner sees it
  if (!isJoiner && lobbyDraft.roomCode && uiMode==='LOBBY') {
    try { await syncLobbyToServer(); } catch(_){}
    startLobbyPoll();
  } else if (isJoiner) {
    startLobbyPoll();
  }
  // Host closing tab/browser should delete room to prevent KV bloat
  window.addEventListener('pagehide', ()=>{
    if (!isJoinerMode && lobbyDraft.roomCode) {
      try { fetch('/api/room/'+lobbyDraft.roomCode, {method:'DELETE', keepalive:true}); } catch(_){}
    }
  });
  window.addEventListener('beforeunload', ()=>{
    if (!isJoinerMode && lobbyDraft.roomCode && state.phase!==PHASES.GAME_OVER) {
      try { fetch('/api/room/'+lobbyDraft.roomCode, {method:'DELETE', keepalive:true}); } catch(_){}
    }
  });
  // Try to load room state first (distributed via API), then fallback to local storage
  let loaded = null;
  const codeToLoad = lobbyDraft.roomCode;
  try {
    const room = await net.getRoomAsync(codeToLoad);
    if (room && room.state && room.state.phase && PHASES[room.state.phase]) {
      loaded = room.state;
    } else if (room && !room.state) {
      // Room exists but no game started yet — stay in lobby, but sync players
      // For joiner, populate lobbyDraft with host's players for display
      if (isJoiner && room.players && room.players.length) {
        // Keep local name but show host's list
        // Don't overwrite lobbyDraft.players yet — we will show join screen
      }
    }
  } catch(_){}
  if (!loaded) loaded = storage.load();
  if (loaded) {
    try {
      state = loaded;
      if (!state.phase || !PHASES[state.phase]) throw new Error('Invalid phase');
      if (!state.log) state.log=[];
      if (!state.extraRoles) state.extraRoles={ percival:true, morgana:true, mordred:false, oberon:false };
      // Restore myId — map by stored name to handle id rotation after host recreates
      const code = state.roomCode || lobbyDraft.roomCode;
      if (code) {
        const key='avalon:myId:'+code;
        try { myId=localStorage.getItem(key); } catch(_){}
        let storedName=null; try{ storedName=localStorage.getItem('avalon:myName:'+code); }catch(_){}
        if (!myId || !state.players.some(p=>p.id===myId)) {
          if (storedName) {
            const found=state.players.find(p=>p.name===storedName);
            if(found){ myId=found.id; try{localStorage.setItem(key, myId);}catch(_){} }
            else myId=state.players[0]?.id || null;
          } else {
            myId=state.players[0]?.id || null;
            if(myId) try{localStorage.setItem(key, myId);}catch(_){}
          }
        }
        lobbyDraft.roomCode=code;
        lobbyDraft.extraRoles = state.extraRoles;
        // Subscribe to room updates
        if (code && isValidRoomCode(code)) {
          if (roomUnsub) roomUnsub();
          roomUnsub = net.subscribe(code, (msg)=>{
            if (msg.state && msg.state !== state) {
              // Avoid loop: only if different
              const incoming = msg.state;
              if (JSON.stringify(incoming) !== JSON.stringify(state)) {
                state = incoming;
                storage.save(state);
                queueRender();
                // Re-trigger AI if needed after sync
                if (state.phase===PHASES.TEAM_PROPOSAL) onEnterTeamProposal();
              }
            }
          });
        }
      }
      toast('Restored saved game','default');
    } catch(e){ console.warn('[init] bad state',e); state=createInitialState(); storage.clear(); }
  } else {
    state=createInitialState();
    // Ensure LOBBY has roomCode for display
    state = { ...state, roomCode: lobbyDraft.roomCode, extraRoles: lobbyDraft.extraRoles };
  }
  // Ensure myId set for fresh lobby
  if (!myId) {
    const code = state.roomCode || lobbyDraft.roomCode;
    try {
      const k='avalon:myId:'+code;
      let v=null; try{v=localStorage.getItem(k);}catch(_){}
      if (v) myId=v;
      else if (state.players.length) { myId=state.players[0].id; try{localStorage.setItem(k,myId);}catch(_){} }
      else { myId=null; }
    } catch(_){ myId=null; }
  }
  render();
  if (state.phase===PHASES.TEAM_PROPOSAL) onEnterTeamProposal();
  if (state.phase===PHASES.TEAM_VOTE) onEnterTeamVote(state.voteGeneration);
  if (state.phase===PHASES.QUEST_VOTE) onEnterQuestVote();
  if (state.phase===PHASES.ASSASSINATION) onEnterAssassination();
  if ([PHASES.TEAM_PROPOSAL, PHASES.TEAM_VOTE, PHASES.QUEST_VOTE].includes(state.phase)) startTimer();
  window.addEventListener('error', (e)=>{ console.error(e.error||e.message); toast('Unexpected error — check console','error'); });
  window.addEventListener('unhandledrejection', (e)=>{ console.error(e.reason); toast('Async error — check console','error'); });
}

init();
