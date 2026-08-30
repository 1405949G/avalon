/**
 * js/net.js — Backend abstraction for distributed play (own phones)
 * Supports:
 *  - localStorage + BroadcastChannel (same browser, demo)
 *  - HTTP API /api/room/<CODE> via serve.py (real cross-device on same WiFi)
 *  - Falls back gracefully when API not available (Netlify etc.)
 */

import { ROOM_STORAGE_PREFIX, isValidRoomCode } from './config.js';

let channels = new Map();
function roomKey(code) { return ROOM_STORAGE_PREFIX + code; }
function getChannel(code) {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channels.has(code)) {
    try { const ch = new BroadcastChannel('avalon-' + code); channels.set(code, ch); } catch(_) { return null; }
  }
  return channels.get(code);
}

// --- Local (sync) helpers ---
function getLocalRoom(code) {
  try {
    const raw = localStorage.getItem(roomKey(code));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(_) { return null; }
}
function setLocalRoom(code, room) {
  try { localStorage.setItem(roomKey(code), JSON.stringify(room)); } catch(e){ console.warn('[net] local save failed', e); }
}

// --- HTTP API helpers (async) ---
async function fetchRoom(code) {
  if (!isValidRoomCode(code)) return null;
  try {
    const res = await fetch(`/api/room/${code}`, { method: 'GET', headers: { 'Accept':'application/json' }});
    if (!res.ok) return null;
    const data = await res.json();
    // Also sync to local for offline fallback
    setLocalRoom(code, data);
    return data;
  } catch(e) {
    // No API (e.g., Netlify) — fallback to local
    return getLocalRoom(code);
  }
}

function mergeStates(oldState, incomingState) {
  if (!oldState || !incomingState) return incomingState;
  if (oldState.phase !== incomingState.phase) return incomingState;
  // Same phase — merge votes & revealed to avoid losing concurrent submissions
  let merged = { ...incomingState };
  // Merge proposal.votes (union)
  if (oldState.proposal && incomingState.proposal && oldState.proposal.votes && incomingState.proposal.votes) {
    const votes = { ...oldState.proposal.votes, ...incomingState.proposal.votes };
    merged.proposal = { ...incomingState.proposal, votes };
  } else if (oldState.proposal && oldState.proposal.votes && !incomingState.proposal?.votes) {
    merged.proposal = { ...incomingState.proposal, votes: { ...oldState.proposal.votes } };
  }
  // Merge questVotes (union)
  if (oldState.questVotes || incomingState.questVotes) {
    merged.questVotes = { ...(oldState.questVotes||{}), ...(incomingState.questVotes||{}) };
  }
  // Merge revealed (OR)
  if (Array.isArray(oldState.revealed) && Array.isArray(incomingState.revealed)) {
    const len = Math.max(oldState.revealed.length, incomingState.revealed.length);
    const arr = Array.from({length: len}, (_,i)=> !!(oldState.revealed[i] || incomingState.revealed[i]));
    merged.revealed = arr;
  }
  return merged;
}

export async function pushRoom(code, roomData) {
  // Merge with both local and server to avoid races
  let existingLocal = getLocalRoom(code) || {};
  let existingServer = null;
  try { existingServer = await fetchRoom(code); } catch(_){}
  // Prefer server's version if newer, but merge players & state
  let base = existingLocal;
  if (existingServer && existingServer.updatedAt > (existingLocal.updatedAt||0)) base = existingServer;
  // Deep merge for state
  let mergedState = roomData.state;
  if (base.state && roomData.state) {
    mergedState = mergeStates(base.state, roomData.state);
  } else if (!mergedState && base.state) {
    // If pushing only players (lobby) and base has state, keep state
    mergedState = base.state;
  }
  // Merge players — handle adds (union) and kicks (incoming authoritative when smaller)
  // Use id as primary key, fallback to name for legacy
  let mergedPlayers = roomData.players;
  if (Array.isArray(base.players) && Array.isArray(roomData.players)) {
    const incomingIds = new Set(roomData.players.map(p=>p.id).filter(Boolean));
    const incomingNames = new Set(roomData.players.map(p=>p.name));
    const baseIds = new Set(base.players.map(p=>p.id).filter(Boolean));
    const missingIds = base.players.filter(p=> p.id && !incomingIds.has(p.id)).map(p=>p.id);
    const extraIds = roomData.players.filter(p=> p.id && !baseIds.has(p.id)).map(p=>p.id);
    if (roomData.players.length < base.players.length && missingIds.length > 0 && extraIds.length === 0) {
      // Likely a kick — incoming is authoritative, don't re-add removed
      mergedPlayers = roomData.players;
    } else {
      const extra = base.players.filter(p=> {
        if (p.id) return !incomingIds.has(p.id);
        return !incomingNames.has(p.name);
      });
      if (extra.length) mergedPlayers = [...roomData.players, ...extra];
    }
  } else if (!mergedPlayers && base.players) {
    mergedPlayers = base.players;
  }
  // gameId/gameOptions/extraRoles already handled via spread, but ensure they persist if not in roomData
  const merged = { ...base, ...roomData, players: mergedPlayers, state: mergedState, code, updatedAt: Date.now() };
  if (roomData.gameId === undefined && base.gameId !== undefined) merged.gameId = base.gameId;
  if (roomData.gameOptions === undefined && base.gameOptions !== undefined) merged.gameOptions = base.gameOptions;
  if (roomData.extraRoles === undefined && base.extraRoles !== undefined) merged.extraRoles = base.extraRoles;
  setLocalRoom(code, merged);
  try {
    await fetch(`/api/room/${code}`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(merged)
    });
  } catch(e) {
  }
  const ch = getChannel(code);
  if (ch) ch.postMessage({ type: 'STATE_UPDATE', code, state: merged.state, room: merged });
  return merged;
}

export async function createRoom(code, hostPlayer) {
  if (!isValidRoomCode(code)) throw new Error('Invalid room code');
  const payload = {
    code,
    createdAt: Date.now(),
    state: null,
    players: hostPlayer ? [hostPlayer] : [],
    hostId: hostPlayer?.id || null,
  };
  await pushRoom(code, payload);
  const ch = getChannel(code);
  if (ch) ch.postMessage({ type: 'ROOM_CREATED', code, payload });
  try { localStorage.setItem('avalon:lastRoomCode', code); } catch(_){}
  return payload;
}

export function getRoom(code) {
  // Sync version — checks local only (for immediate render)
  return getLocalRoom(code);
}

export async function getRoomAsync(code) {
  return await fetchRoom(code);
}

export async function joinRoom(code, player) {
  let room = null;
  // Retry a few times in case host hasn't pushed yet (race)
  for (let attempt=0; attempt<4; attempt++) {
    room = await fetchRoom(code);
    if (room) break;
    await new Promise(r=> setTimeout(r, 400));
  }
  if (!room) throw new Error('Room not found: ' + code + '. Host may not have started lobby yet — ask host to refresh.');
  if (room.players.some(p => p.id === player.id || p.name === player.name)) {
    throw new Error('Player already in room');
  }
  room.players.push(player);
  await pushRoom(code, room);
  const ch = getChannel(code);
  if (ch) ch.postMessage({ type: 'PLAYER_JOINED', code, player });
  return room;
}

export async function updateRoomState(code, newState) {
  let room = await fetchRoom(code);
  if (!room) room = { code, createdAt: Date.now(), players: [], hostId: null };
  // Merge with server state to avoid losing concurrent votes
  if (room.state) newState = mergeStates(room.state, newState);
  room.state = newState;
  room.updatedAt = Date.now();
  await pushRoom(code, room);
}

export function updateRoomStateSync(code, newState) {
  // Sync fallback for quick local update (used by dispatch) — also merges with local
  let room = getLocalRoom(code);
  if (!room) room = { code, createdAt: Date.now(), players: [], hostId: null };
  if (room.state) newState = mergeStates(room.state, newState);
  room.state = newState;
  room.updatedAt = Date.now();
  setLocalRoom(code, room);
  const ch = getChannel(code);
  if (ch) ch.postMessage({ type: 'STATE_UPDATE', code, state: newState });
  // Also try async push in background with merge
  (async()=>{
    try {
      const serverRoom = await fetchRoom(code);
      let toPush = newState;
      if (serverRoom && serverRoom.state) toPush = mergeStates(serverRoom.state, newState);
      const payload = { ...room, state: toPush, updatedAt: Date.now() };
      await fetch(`/api/room/${code}`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      setLocalRoom(code, payload);
    } catch(_){}
  })();
}

export function subscribe(code, callback) {
  if (!isValidRoomCode(code)) return () => {};
  const ch = getChannel(code);
  let handler = (e) => { if (e.data && e.data.code === code) callback(e.data); };
  if (ch) ch.addEventListener('message', handler);

  function onStorage(ev) {
    if (ev.key === roomKey(code) && ev.newValue) {
      try { const room = JSON.parse(ev.newValue); callback({ type: 'STATE_UPDATE', code, state: room.state, room }); } catch(_){}
    }
  }
  window.addEventListener('storage', onStorage);

  // Poll server for cross-device sync (every 1.5s) — also detects host deletion (room 404)
  let lastStateStr = null;
  let lastHadRoom = false;
  try { const r = getLocalRoom(code); if (r) lastHadRoom = true; if (r?.state) lastStateStr = JSON.stringify(r.state); } catch(_){}
  const poll = setInterval(async () => {
    try {
      const room = await fetchRoom(code);
      if (!room) {
        if (lastHadRoom) {
          lastHadRoom = false;
          callback({ type: 'ROOM_DELETED', code });
        }
        return;
      }
      lastHadRoom = true;
      if (!room.state) return;
      const s = JSON.stringify(room.state);
      if (s !== lastStateStr) {
        lastStateStr = s;
        callback({ type: 'STATE_UPDATE', code, state: room.state, room });
      }
    } catch(_){}
  }, 1500);

  return () => {
    if (ch) ch.removeEventListener('message', handler);
    window.removeEventListener('storage', onStorage);
    clearInterval(poll);
  };
}

export function leaveRoom(code, playerId) {
  // fire-and-forget async
  (async () => {
    let room = await fetchRoom(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== playerId);
    await pushRoom(code, room);
    const ch = getChannel(code);
    if (ch) ch.postMessage({ type: 'PLAYER_LEFT', code, playerId });
  })();
}

export async function deleteRoom(code) {
  if (!isValidRoomCode(code)) return;
  try {
    await fetch(`/api/room/${code}`, { method: 'DELETE' });
  } catch(_){}
  try { localStorage.removeItem(roomKey(code)); } catch(_){}
  const ch = getChannel(code);
  if (ch) ch.postMessage({ type: 'ROOM_DELETED', code });
}

export function generateInviteLink(code) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

export function parseInviteCode() {
  try {
    const url = new URL(window.location.href);
    const c = url.searchParams.get('room');
    if (c && isValidRoomCode(c.toUpperCase())) return c.toUpperCase();
  } catch(_){}
  return null;
}
