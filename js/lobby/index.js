/**
 * js/lobby/index.js — Generic Table Party lobby (KV single source)
 * Handles poll, add-bot/kick/rename, extra-roles via game module, change game without remake.
 */
import * as net from '../net.js';
import { saveLobbyDraft } from './storage.js';
import { getGame } from '../games/registry.js';

export function createLobbyController({ lobbyDraft, lobbyRoomCache, getLobbyRoomCache, setLobbyRoomCache, isJoinerMode, hasJoined, uiMode, getMyId, setMyId, queueRender, toast, showConfirm }) {
  let lobbyPoll = null;

  function startPoll() {
    if (lobbyPoll) clearInterval(lobbyPoll);
    lobbyPoll = setInterval(async ()=>{
      const state = window.__AVALON_STATE__; // set by app
      if (state && state.phase !== 'LOBBY') { clearInterval(lobbyPoll); lobbyPoll=null; return; }
      try {
        const room = await net.getRoomAsync(lobbyDraft.roomCode);
        if (!room) {
          if (isJoinerMode()) {
            toast('Host left — room closed','error');
            hasJoined(false); // setter
            // caller will handle isJoinerMode etc.
          }
          return;
        }
        // Kick detection for joiner
        if (isJoinerMode() && hasJoined()) {
          const myId = (()=>{ try{ return localStorage.getItem('avalon:myId:'+lobbyDraft.roomCode); }catch(_){return null}})();
          const myName = (()=>{ try{ return localStorage.getItem('avalon:myName:'+lobbyDraft.roomCode); }catch(_){return null}})();
          const stillIn = myId ? room.players.some(p=>p.id===myId) : myName ? room.players.some(p=>p.name===myName) : false;
          if (!stillIn) {
            toast('You were kicked from lobby','error');
            // letting app handle redirect to HOME
            setLobbyRoomCache(room);
            queueRender();
            return;
          }
        }
        setLobbyRoomCache(room);
        // host mirrors to draft for offline
        const draft = lobbyDraft;
        if (!isJoinerMode()) {
          draft.players = room.players.map(p=>({id:p.id, name:p.name, isBot:!!p.isBot}));
          draft.extraRoles = room.extraRoles || draft.extraRoles;
          draft.gameId = room.gameId || draft.gameId || 'quest-of-shadows';
          // auto-trim if over cap
          const game = getGame(draft.gameId);
          if (game.config.getMaxExtraEvil) {
            const max = game.config.getMaxExtraEvil(room.players.length);
            const enabled = ['morgana','mordred','oberon'].filter(k=> !!(room.extraRoles||{})[k]).length;
            if (enabled > max) {
              const eff = game.config.getEffectiveExtraRoles(room.players.length, room.extraRoles);
              room.extraRoles = eff;
              draft.extraRoles = eff;
              try{ await net.pushRoom(draft.roomCode, { extraRoles: eff }); }catch(_){}
            }
          }
          saveLobbyDraft(draft);
        } else {
          if (room.extraRoles) draft.extraRoles = room.extraRoles;
          if (room.gameId) draft.gameId = room.gameId;
        }
        const active = document.activeElement;
        const isTyping = active && (active.id==='input-add-player' || active.id==='input-join-name' || active.tagName==='INPUT');
        if (!isTyping) queueRender();
      } catch(_){}
    }, 1500);
  }
  function stopPoll(){ if(lobbyPoll){ clearInterval(lobbyPoll); lobbyPoll=null; } }

  return { startPoll, stopPoll };
}
