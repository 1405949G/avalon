/**
 * js/lobby/storage.js — Generic lobby persistence (room code + draft)
 * Single source for roomCode, no player merge — KV is authoritative.
 */
import { generateRoomCode, isValidRoomCode } from '../games/avalon/config.js';

export function lobbyPlayerId() {
  return `lobby_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2,6)}`;
}
export function ensureLobbyIds(players) {
  for (const p of players) if (!p.id) p.id = lobbyPlayerId();
}

export function defaultLobby() {
  let code = null;
  try {
    const last = localStorage.getItem('avalon:lastRoomCode');
    if (last && isValidRoomCode(last)) code = last;
  } catch(_) {}
  if (!code) {
    code = generateRoomCode();
    try { localStorage.setItem('avalon:lastRoomCode', code); } catch(_) {}
  }
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
    players: [{ id: lobbyPlayerId(), name: 'Lucky', isBot: false }],
    extraRoles: { percival: true, morgana: true, mordred: false, oberon: false },
    gameId: 'quest-of-shadows',
  };
}

export function persistLobbyCode(code) {
  try { localStorage.setItem('avalon:lastRoomCode', code); } catch(_) {}
}
export function saveLobbyDraft(draft) {
  try { ensureLobbyIds(draft.players); localStorage.setItem('avalon:lobby:' + draft.roomCode, JSON.stringify({ players: draft.players, extraRoles: draft.extraRoles, gameId: draft.gameId })); } catch(_){}
}
