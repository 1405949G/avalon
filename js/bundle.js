// Bundle for file:// - IIFE, no ES modules
(function() {
"use strict";
try { window.__AVALON_BOOTED__ = true; window.__AVALON_BUNDLE_LOADED__ = true; } catch(_) {}
// ---- js\games\avalon\config.js ----
/**
 * js/config.js — Avalon configuration tables (Quest of Shadows) — v3 with extra roles
 * Pure constants, no side effects. Fully commented.
 */

const PHASES = Object.freeze({
  LOBBY: 'LOBBY',
  ROLE_REVEAL: 'ROLE_REVEAL',
  TEAM_PROPOSAL: 'TEAM_PROPOSAL',
  TEAM_VOTE: 'TEAM_VOTE',
  TEAM_VOTE_REVEAL: 'TEAM_VOTE_REVEAL',
  QUEST_VOTE: 'QUEST_VOTE',
  QUEST_REVEAL: 'QUEST_REVEAL',
  ASSASSINATION: 'ASSASSINATION',
  GAME_OVER: 'GAME_OVER',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [PHASES.LOBBY]: ['SETUP_GAME', 'CREATE_ROOM', 'JOIN_ROOM'],
  [PHASES.ROLE_REVEAL]: ['MARK_REVEALED', 'NEXT_REVEAL', 'COMPLETE_REVEAL', 'REVEAL_ROLE'],
  [PHASES.TEAM_PROPOSAL]: ['PROPOSE_TEAM'],
  [PHASES.TEAM_VOTE]: ['SUBMIT_TEAM_VOTE', 'FORCE_TEAM_VOTE_REVEAL', 'TIMER_EXPIRED'],
  [PHASES.TEAM_VOTE_REVEAL]: ['RESOLVE_TEAM_VOTE'],
  [PHASES.QUEST_VOTE]: ['SUBMIT_QUEST_VOTE', 'FORCE_QUEST_REVEAL'],
  [PHASES.QUEST_REVEAL]: ['RESOLVE_QUEST'],
  [PHASES.ASSASSINATION]: ['ASSASSINATE'],
  [PHASES.GAME_OVER]: ['RESET', 'SETUP_GAME'],
});

const QUEST_SIZES = Object.freeze({
  5: Object.freeze([2, 3, 2, 3, 3]),
  6: Object.freeze([2, 3, 4, 3, 4]),
  7: Object.freeze([2, 3, 3, 4, 4]),
  8: Object.freeze([3, 4, 4, 5, 5]),
  9: Object.freeze([3, 4, 4, 5, 5]),
  10: Object.freeze([3, 4, 4, 5, 5]),
});

const FAILS_REQUIRED = Object.freeze({
  5: Object.freeze([1, 1, 1, 1, 1]),
  6: Object.freeze([1, 1, 1, 1, 1]),
  7: Object.freeze([1, 1, 1, 2, 1]),
  8: Object.freeze([1, 1, 1, 2, 1]),
  9: Object.freeze([1, 1, 1, 2, 1]),
  10: Object.freeze([1, 1, 1, 2, 1]),
});

const ROLE_COUNTS = Object.freeze({
  5: Object.freeze({ good: 3, evil: 2, merlin: 1, assassin: 1, loyal: 2, minion: 1 }),
  6: Object.freeze({ good: 4, evil: 2, merlin: 1, assassin: 1, loyal: 3, minion: 1 }),
  7: Object.freeze({ good: 4, evil: 3, merlin: 1, assassin: 1, loyal: 3, minion: 2 }),
  8: Object.freeze({ good: 5, evil: 3, merlin: 1, assassin: 1, loyal: 4, minion: 2 }),
  9: Object.freeze({ good: 6, evil: 3, merlin: 1, assassin: 1, loyal: 5, minion: 2 }),
  10: Object.freeze({ good: 6, evil: 4, merlin: 1, assassin: 1, loyal: 5, minion: 3 }),
});

// Role enum — base + extra (Table Party)
const ROLES = Object.freeze({
  LOYAL: 'LOYAL',
  MERLIN: 'MERLIN',
  PERCIVAL: 'PERCIVAL', // GOOD — sees Merlin (+ Morgana as decoy)
  MINION: 'MINION',
  ASSASSIN: 'ASSASSIN',
  MORGANA: 'MORGANA',   // EVIL — appears as Merlin to Percival
  MORDRED: 'MORDRED',   // EVIL — hidden from Merlin
  OBERON: 'OBERON',     // EVIL — isolated, sees none, none see him
});

// For UI toggles — extensible
const EXTRA_ROLES = Object.freeze([
  { key: 'percival', role: ROLES.PERCIVAL, label: 'Percival', side: 'GOOD', desc: 'Sees Merlin' },
  { key: 'morgana', role: ROLES.MORGANA, label: 'Morgana', side: 'EVIL', desc: 'Fools Percival' },
  { key: 'mordred', role: ROLES.MORDRED, label: 'Mordred', side: 'EVIL', desc: 'Hidden from Merlin' },
  { key: 'oberon', role: ROLES.OBERON, label: 'Oberon', side: 'EVIL', desc: 'Isolated Evil' },
]);

// Balancing: max extra evil roles by player count to keep Good majority
function getMaxExtraEvil(playerCount) {
  if (playerCount <= 6) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}
function getEffectiveExtraRoles(playerCount, opts) {
  const max = getMaxExtraEvil(playerCount);
  const enabled = ['morgana','mordred','oberon'].filter(k=> !!opts[k]);
  if (enabled.length <= max) return { ...opts };
  // Trim to max in priority order: keep earliest enabled, drop overflow
  const trimmed = { ...opts, morgana:false, mordred:false, oberon:false };
  for (let i=0;i<Math.min(enabled.length, max);i++) trimmed[enabled[i]] = true;
  return trimmed;
}

const ALLEGIANCE = Object.freeze({
  GOOD: 'GOOD',
  EVIL: 'EVIL',
});

function allegianceOf(role) {
  if (role === ROLES.LOYAL || role === ROLES.MERLIN || role === ROLES.PERCIVAL) return ALLEGIANCE.GOOD;
  return ALLEGIANCE.EVIL;
}

const MAX_PROPOSAL_TRACKER = 5;
const WIN_THRESHOLD = 3;
const TIMER_SECONDS = 90;
const REVEAL_ANIM_MS = 1200;
const STORAGE_KEY = 'avalon:quest-of-shadows:v3';
const STORAGE_VERSION = 3;
const ROOM_CODE_LENGTH = 4;
const ROOM_STORAGE_PREFIX = 'avalon:room:';

function getQuestSize(playerCount, questIndex) {
  const sizes = QUEST_SIZES[playerCount];
  if (!sizes) throw new Error(`Unsupported player count: ${playerCount}`);
  if (questIndex < 0 || questIndex >= 5) throw new Error(`Invalid quest index: ${questIndex}`);
  return sizes[questIndex];
}

function getFailsRequired(playerCount, questIndex) {
  const fails = FAILS_REQUIRED[playerCount];
  if (!fails) throw new Error(`Unsupported player count: ${playerCount}`);
  return fails[questIndex];
}

/**
 * Build role list for a player count with optional extra roles.
 * @param {number} playerCount 5-10
 * @param {object} opts {percival,morgana,mordred,oberon} booleans
 * @returns {string[]} roles length == playerCount, shuffled not yet
 */
function getRoleList(playerCount, opts = {}) {
  const c = ROLE_COUNTS[playerCount];
  if (!c) throw new Error(`Unsupported player count: ${playerCount}`);
  // Enforce balance: cap evil extras to keep Good majority
  const effective = getEffectiveExtraRoles(playerCount, opts);
  // Base counts
  let loyal = c.loyal;
  let minion = c.minion;
  const roles = [];
  // Always
  roles.push(ROLES.MERLIN);
  roles.push(ROLES.ASSASSIN);

  // Good extra: Percival replaces a Loyal
  if (effective.percival && loyal > 0) {
    roles.push(ROLES.PERCIVAL);
    loyal--;
  }
  // Evil extras replace Minions in priority order: Morgana -> Mordred -> Oberon (capped)
  if (effective.morgana && minion > 0) {
    roles.push(ROLES.MORGANA);
    minion--;
  }
  if (effective.mordred && minion > 0) {
    roles.push(ROLES.MORDRED);
    minion--;
  }
  if (effective.oberon && minion > 0) {
    roles.push(ROLES.OBERON);
    minion--;
  }

  for (let i=0;i<loyal;i++) roles.push(ROLES.LOYAL);
  for (let i=0;i<minion;i++) roles.push(ROLES.MINION);

  // Safety: if roles.length != playerCount due to capping, trim or pad
  while (roles.length < playerCount) roles.push(ROLES.LOYAL);
  while (roles.length > playerCount) {
    const idx = roles.findIndex(r => r===ROLES.LOYAL || r===ROLES.MINION);
    if (idx!==-1) roles.splice(idx,1);
    else break;
  }
  return roles;
}

// Helpers
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O for readability
  let code = '';
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    for (let i=0;i<ROOM_CODE_LENGTH;i++) code += chars[buf[i] % chars.length];
  } else {
    for (let i=0;i<ROOM_CODE_LENGTH;i++) code += chars[Math.floor(Math.random()*chars.length)];
  }
  return code;
}

function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-Z]{4}$/.test(code);
}

// ---- js\utils.js ----
/**
 * js/utils.js — Pure helper utilities.
 * No DOM, no state — safe to use anywhere.
 */

/**
 * Shuffle array in-place using Fisher-Yates.
 * Uses crypto.getRandomValues if available for better randomness (role assignment).
 * Returns new array (does not mutate input).
 */
function shuffle(array, rng = Math.random) {
  const a = array.slice();
  // Prefer crypto for role assignment unpredictability
  const useCrypto = typeof crypto !== 'undefined' && crypto.getRandomValues;
  for (let i = a.length - 1; i > 0; i--) {
    let j;
    if (useCrypto) {
      // Use crypto random in [0, i]
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      j = buf[0] % (i + 1);
    } else {
      j = Math.floor(rng() * (i + 1));
    }
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a short random id (for players).
 */
function uid(prefix = 'p') {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/**
 * Clamp number between min and max.
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Escape text for safe DOM insertion via textContent (defense against XSS from player names).
 * This is a no-op if used with textContent, but useful if building HTML strings.
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Deep clone via JSON — sufficient for our state shape (no functions, no Dates except numbers).
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick random element.
 */
function sample(arr) {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Simple debounce.
 */
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Format quest result text.
 */
function questResultLabel(status) {
  if (status === 'SUCCESS') return 'Success';
  if (status === 'FAIL') return 'Fail';
  return 'Pending';
}

/**
 * Validate player name: 1-16 chars, alphanumeric + spaces, apostrophes, hyphens.
 * Returns trimmed name or throws.
 */
function validateName(raw) {
  const name = String(raw).trim();
  if (!name) throw new Error('Name cannot be empty');
  if (name.length > 16) throw new Error('Name too long (max 16)');
  if (!/^[\p{L}\p{N} .'\-]+$/u.test(name)) throw new Error('Name contains invalid characters');
  return name;
}

/**
 * Sleep helper for async AI delays (used in app.js, not reducer).
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- js\games\avalon\state.js ----
/**
 * js/state.js — Game mechanics engine (PURE STATE MACHINE)
 * ------------------------------------------------------------------
 * Centralized, robust, immutable reducer for Avalon: Quest of Shadows.
 * No DOM, no setTimeout, no side effects. All side effects (AI scheduling,
 * timers, storage) are handled by app.js via side-effect descriptors.
 *
 * State shape, phases, and transitions are documented inline.
 * Aggressively guards against phase-desync (D1-D10) and state leakage (L1-L8).
 *
 * Exports:
 *   - createInitialState()
 *   - reducer(state, action) -> { state, effects }
 *   - getPublicState(state)
 *   - getPrivateState(state, playerId)
 *   - getAIView(state, botId)
 *   - selectors: getVision, isGameOver, countWins, etc.
 *
 * Action types:
 *   SETUP_GAME, MARK_REVEALED, NEXT_REVEAL, COMPLETE_REVEAL,
 *   PROPOSE_TEAM, SUBMIT_TEAM_VOTE, FORCE_TEAM_VOTE_REVEAL, RESOLVE_TEAM_VOTE,
 *   SUBMIT_QUEST_VOTE, FORCE_QUEST_REVEAL, RESOLVE_QUEST,
 *   ASSASSINATE, RESET, TIMER_EXPIRED
 */

import {
  PHASES, ALLOWED_TRANSITIONS, QUEST_SIZES, FAILS_REQUIRED,
  ROLES, ALLEGIANCE, allegianceOf, getQuestSize, getFailsRequired,
  getRoleList, MAX_PROPOSAL_TRACKER, WIN_THRESHOLD, STORAGE_VERSION,

// import inlined
// ——— Initial state factory ———
function createInitialState() {
  return Object.freeze({
    version: STORAGE_VERSION,
    phase: PHASES.LOBBY,
    players: [], // {id,name,isBot,role,allegiance,isLeader}
    currentQuest: 0, // 0..4
    leaderIndex: 0,
    quests: [], // built on SETUP_GAME
    proposal: Object.freeze({ teamIds: [], votes: Object.freeze({}), result: null, revealed: false }),
    questVotes: Object.freeze({}), // {playerId: 'SUCCESS'|'FAIL'} — only during QUEST_VOTE
    proposalTracker: 0, // 0..5 rejections
    revealIndex: 0,
    revealed: Object.freeze([]), // bool per player
    voteGeneration: 0, // increments each new proposal — guards AI callbacks (D2)
    phaseLock: false, // true during reveal animations — timer ignored (D4)
    log: Object.freeze([]), // {id, t, type, text}
    winner: null, // 'GOOD'|'EVIL'|null
    winReason: null, // 'QUESTS'|'TRACKER'|'ASSASSINATION'
    assassination: Object.freeze({ targetId: null, success: null }),
    extraRoles: Object.freeze({ percival: false, morgana: false, mordred: false, oberon: false }), // for UI + replays
    roomCode: null, // e.g., 'EQKH' — persisted for distributed play
  });
}

// ——— Helpers (pure) ———

function cloneQuests(playerCount) {
  const sizes = QUEST_SIZES[playerCount];
  const fails = FAILS_REQUIRED[playerCount];
  return sizes.map((size, i) => Object.freeze({
    index: i,
    size,
    failsRequired: fails[i],
    status: 'PENDING', // PENDING | SUCCESS | FAIL
    teamIds: Object.freeze([]),
    failCount: null,
    votesShuffled: Object.freeze([]), // e.g., ['SUCCESS','FAIL'] shuffled
  }));
}

function nextLeaderIndex(state) {
  return (state.leaderIndex + 1) % state.players.length;
}

function countWins(quests) {
  let good = 0, evil = 0;
  for (const q of quests) {
    if (q.status === 'SUCCESS') good++;
    else if (q.status === 'FAIL') evil++;
  }
  return { good, evil };
}

function getVision(state, playerId) {
  const me = state.players.find(p => p.id === playerId);
  if (!me) return Object.freeze({ sees: [], seesRoles: {} });

  // Percival sees Merlin (+ Morgana if present)
  if (me.role === ROLES.PERCIVAL) {
    const merlins = state.players.filter(p => p.role === ROLES.MERLIN).map(p => p.id);
    const morganas = state.players.filter(p => p.role === ROLES.MORGANA).map(p => p.id);
    const sees = [...merlins, ...morganas];
    // Shuffle for UI so order doesn't hint
    const roles = {};
    merlins.forEach(id => roles[id] = ROLES.MERLIN);
    morganas.forEach(id => roles[id] = ROLES.MORGANA); // but UI will show both as "Merlin?" to Percival
    return Object.freeze({ sees: shuffle(sees), seesRoles: roles, reason: 'PERCIVAL_SEES_MERLIN' });
  }

  // Evil sees other Evil, but Oberon is isolated: Evil doesn't see Oberon, Oberon sees no one
  if (me.allegiance === ALLEGIANCE.EVIL) {
    if (me.role === ROLES.OBERON) {
      return Object.freeze({ sees: [], seesRoles: {}, reason: 'OBERON_ISOLATED' });
    }
    // Other Evil: see all Evil except self and Oberon
    const evils = state.players.filter(p => p.allegiance === ALLEGIANCE.EVIL && p.id !== playerId && p.role !== ROLES.OBERON).map(p => p.id);
    const roles = {};
    evils.forEach(id => {
      const r = state.players.find(x => x.id === id)?.role;
      roles[id] = r;
    });
    return Object.freeze({ sees: evils, seesRoles: roles, reason: 'EVIL_SEES_EVIL' });
  }

  // Merlin sees all Evil EXCEPT Mordred (Mordred is hidden)
  if (me.role === ROLES.MERLIN) {
    const evils = state.players.filter(p => p.allegiance === ALLEGIANCE.EVIL && p.role !== ROLES.MORDRED).map(p => p.id);
    const roles = {};
    evils.forEach(id => roles[id] = state.players.find(x=>x.id===id)?.role);
    return Object.freeze({ sees: evils, seesRoles: roles, reason: 'MERLIN_SEES_EVIL' });
  }

  // Loyal, Minion, Assassin (non-Oberon, non-Perci, non-Merlin) see nothing
  return Object.freeze({ sees: [], seesRoles: {}, reason: 'NONE' });
}

// ——— Public / Private / AI views (anti-leakage L1, L4) ———

function getPublicState(state) {
  // Strip roles and secret votes — safe for general UI
  const publicPlayers = state.players.map(p => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    isLeader: state.players[state.leaderIndex]?.id === p.id,
    // Never expose role/allegiance publicly (L1)
  }));
  // Quest views: hide fail attribution (L3) — only status & failCount public
  const publicQuests = state.quests.map(q => ({
    index: q.index,
    size: q.size,
    failsRequired: q.failsRequired,
    status: q.status,
    teamIds: q.teamIds,
    failCount: q.failCount, // only after reveal
  }));
  // Proposal votes: only reveal after TEAM_VOTE_REVEAL fully resolved; during vote, hide
  const proposalPublic = {
    teamIds: state.proposal.teamIds,
    result: state.proposal.result,
    revealed: state.proposal.revealed,
    // votes hidden unless revealed (L8)
    votes: state.proposal.revealed ? state.proposal.votes : null,
    voteCount: Object.keys(state.proposal.votes).length,
  };
  return Object.freeze({
    version: state.version,
    phase: state.phase,
    players: Object.freeze(publicPlayers),
    currentQuest: state.currentQuest,
    leaderIndex: state.leaderIndex,
    leaderId: state.players[state.leaderIndex]?.id || null,
    quests: Object.freeze(publicQuests),
    proposal: Object.freeze(proposalPublic),
    proposalTracker: state.proposalTracker,
    revealIndex: state.revealIndex,
    revealed: state.revealed,
    phaseLock: state.phaseLock,
    log: state.log,
    winner: state.winner,
    winReason: state.winReason,
    assassination: state.assassination,
    voteGeneration: state.voteGeneration,
    extraRoles: state.extraRoles,
    roomCode: state.roomCode,
  });
}

function getPrivateState(state, playerId) {
  const me = state.players.find(p => p.id === playerId);
  if (!me) throw new Error(`Unknown playerId: ${playerId}`);
  const vision = getVision(state, playerId);
  return Object.freeze({
    ...getPublicState(state),
    self: Object.freeze({ id: me.id, name: me.name, role: me.role, allegiance: me.allegiance }),
    vision,
    // During QUEST_VOTE, include own quest vote if submitted
    myQuestVote: state.questVotes[playerId] || null,
    // During TEAM_VOTE, include own team vote if submitted
    myTeamVote: state.proposal.votes[playerId] || null,
  });
}

function getAIView(state, botId) {
  // Knowledge-scoped view for AI (L4, L7): only what that bot should know
  const me = state.players.find(p => p.id === botId);
  if (!me) throw new Error(`Unknown botId: ${botId}`);
  const vision = getVision(state, botId);
  // AI sees public state + own role + vision (evil sees evils, merlin sees evils)
  // AI must NOT see other players' quest votes until reveal, nor Merlin identity if Evil.
  // For Assassin guess, AI must infer Merlin from behavior, not direct role.
  return Object.freeze({
    public: getPublicState(state),
    self: Object.freeze({ id: me.id, role: me.role, allegiance: me.allegiance }),
    vision,
    questVotes: null, // never reveal private quest votes to AI before resolve
    proposalVotes: null,
  });
}

// ——— Log helper ———
function appendLog(log, type, text) {
  const entry = Object.freeze({ id: uid('log'), t: Date.now(), type, text });
  return Object.freeze([...log, entry]);
}

// ——— Guard helpers ———
function assertPhase(state, allowedPhases) {
  if (!allowedPhases.includes(state.phase)) {
    throw new Error(`Action not allowed in phase ${state.phase}. Allowed: ${allowedPhases.join(',')}`);
  }
}

function assertPlayerExists(state, playerId) {
  if (!state.players.some(p => p.id === playerId)) throw new Error(`Player not found: ${playerId}`);
}

// ——— Reducer ———
/**
 * Pure reducer: (state, action) => { state: newState, effects: [] }
 * Effects are declarative side-effect requests for app.js to execute:
 *   { type: 'SCHEDULE_AI_TEAM_VOTE', generation: number }
 *   { type: 'SCHEDULE_REVEAL', ms: number }
 * Reducer never calls setTimeout / fetch / DOM.
 */
function reducer(state, action) {
  if (!state) state = createInitialState();
  if (!action || !action.type) throw new Error('Action must have a type');

  // Enforce allowed transitions (defense against desync)
  // We allow some meta actions like RESET from any phase via explicit check
  const allowedForPhase = ALLOWED_TRANSITIONS[state.phase] || [];
  const isGlobalReset = action.type === 'RESET';
  if (!isGlobalReset && !allowedForPhase.includes(action.type)) {
    // Also allow FORCE actions as escape hatches (still guarded by phase)
    // If not allowed, we treat as no-op but return error effect for toast
    // To be strict, throw — app.js will catch and toast
    throw new Error(`Action ${action.type} not allowed in phase ${state.phase}`);
  }

  // Freeze check: phaseLock prevents certain actions during animations (D4)
  const lockBlocking = ['SUBMIT_TEAM_VOTE', 'SUBMIT_QUEST_VOTE', 'PROPOSE_TEAM', 'ASSASSINATE'];
  if (state.phaseLock && lockBlocking.includes(action.type)) {
    throw new Error(`Phase locked — action ${action.type} blocked until reveal completes`);
  }

  switch (action.type) {
    // ——— LOBBY: setup game ———
    case 'SETUP_GAME': {
      assertPhase(state, [PHASES.LOBBY, PHASES.GAME_OVER]);
      const { players, opts, roomCode } = action.payload || {};
      if (!Array.isArray(players) || players.length < 5 || players.length > 10) {
        throw new Error('Players must be 5-10');
      }
      // Validate names
      const names = players.map(p => String(p.name || '').trim());
      if (names.some(n => !n)) throw new Error('All players need names');
      if (new Set(names).size !== names.length) throw new Error('Duplicate names not allowed');
      if (names.some(n => n.length > 16)) throw new Error('Name too long (max 16)');

      const playerCount = players.length;
      const roles = shuffle(getRoleList(playerCount, opts || {}));
      const builtPlayers = players.map((p, i) => {
        const role = roles[i];
        return Object.freeze({
          id: p.id || uid('p'),
          name: String(p.name).trim(),
          isBot: !!p.isBot,
          role,
          allegiance: allegianceOf(role),
          isLeader: false, // leader tracked via leaderIndex
        });
      });
      // Randomize leader
      const leaderIndex = Math.floor(Math.random() * builtPlayers.length);
      const quests = cloneQuests(playerCount);

      let newState = {
        ...createInitialState(),
        version: STORAGE_VERSION,
        phase: PHASES.ROLE_REVEAL,
        players: Object.freeze(builtPlayers),
        quests: Object.freeze(quests),
        leaderIndex,
        revealIndex: 0,
        revealed: Object.freeze(builtPlayers.map(() => false)),
        voteGeneration: 0,
        phaseLock: false,
        extraRoles: Object.freeze({ percival: !!opts?.percival, morgana: !!opts?.morgana, mordred: !!opts?.mordred, oberon: !!opts?.oberon }),
        roomCode: roomCode || null,
        log: appendLog([], 'SETUP', `Game started with ${playerCount} players. Leader: ${builtPlayers[leaderIndex].name}. Roles: Merlin+Assassin${opts?.percival?' + Percival':''}${opts?.morgana?' + Morgana':''}${opts?.mordred?' + Mordred':''}${opts?.oberon?' + Oberon':''}`),
      };
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_ROLE_REVEAL' }]) };
    }

    // ——— ROLE_REVEAL: sequential pass-and-play ———
    case 'MARK_REVEALED': {
      assertPhase(state, [PHASES.ROLE_REVEAL]);
      const idx = state.revealIndex;
      if (idx < 0 || idx >= state.players.length) throw new Error('Reveal index out of bounds');
      if (state.revealed[idx]) {
        // Already marked — no-op to avoid double count
        return { state, effects: Object.freeze([]) };
      }
      const nextRevealed = state.revealed.slice();
      nextRevealed[idx] = true;
      const newState = {
        ...state,
        revealed: Object.freeze(nextRevealed),
        log: appendLog(state.log, 'REVEAL', `${state.players[idx].name} viewed their role.`),
      };
      return { state: Object.freeze(newState), effects: Object.freeze([]) };
    }

    case 'NEXT_REVEAL': {
      assertPhase(state, [PHASES.ROLE_REVEAL]);
      // Must have marked current as revealed before advancing (barrier D8)
      if (!state.revealed[state.revealIndex]) {
        throw new Error('Must view role before passing device');
      }
      if (state.revealIndex >= state.players.length - 1) {
        throw new Error('Already at last player — use COMPLETE_REVEAL');
      }
      const newState = {
        ...state,
        revealIndex: state.revealIndex + 1,
      };
      return { state: Object.freeze(newState), effects: Object.freeze([]) };
    }

    case 'COMPLETE_REVEAL': {
      assertPhase(state, [PHASES.ROLE_REVEAL]);
      if (!state.revealed.every(Boolean)) {
        throw new Error('All players must view their roles before starting');
      }
      const newState = {
        ...state,
        phase: PHASES.TEAM_PROPOSAL,
        log: appendLog(state.log, 'PHASE', 'All roles viewed. Quest 1 — Leader proposes a team.'),
      };
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_TEAM_PROPOSAL' }]) };
    }

    case 'REVEAL_ROLE': {
      // Per-device private reveal — no passing needed. Any player can mark themselves as having seen role.
      assertPhase(state, [PHASES.ROLE_REVEAL]);
      const { playerId } = action.payload || {};
      assertPlayerExists(state, playerId);
      const idx = state.players.findIndex(p => p.id === playerId);
      if (state.revealed[idx]) return { state, effects: Object.freeze([]) };
      const nextRevealed = state.revealed.slice();
      nextRevealed[idx] = true;
      const newState = {
        ...state,
        revealed: Object.freeze(nextRevealed),
        log: appendLog(state.log, 'REVEAL', `${state.players[idx].name} viewed their role (private).`),
      };
      // Auto-complete if all have viewed
      if (nextRevealed.every(Boolean)) {
        const autoState = {
          ...newState,
          phase: PHASES.TEAM_PROPOSAL,
          log: appendLog(newState.log, 'PHASE', 'All roles viewed (distributed). Quest 1 — Leader proposes.'),
        };
        return { state: Object.freeze(autoState), effects: Object.freeze([{ type: 'ENTER_TEAM_PROPOSAL' }]) };
      }
      return { state: Object.freeze(newState), effects: Object.freeze([]) };
    }

    // ——— TEAM_PROPOSAL: leader picks team ———
    case 'PROPOSE_TEAM': {
      assertPhase(state, [PHASES.TEAM_PROPOSAL]);
      const { teamIds } = action.payload || {};
      if (!Array.isArray(teamIds)) throw new Error('teamIds must be array');
      const quest = state.quests[state.currentQuest];
      if (!quest) throw new Error('No current quest');
      if (teamIds.length !== quest.size) throw new Error(`Team must be exactly ${quest.size} players (quest ${state.currentQuest + 1})`);
      if (new Set(teamIds).size !== teamIds.length) throw new Error('Duplicate players in team');
      for (const id of teamIds) assertPlayerExists(state, id);
      // Verify caller is leader (if payload has proposerId, enforce)
      if (action.payload.proposerId) {
        const leaderId = state.players[state.leaderIndex].id;
        if (action.payload.proposerId !== leaderId) throw new Error('Only the Leader may propose');
      }
      const leaderName = state.players[state.leaderIndex].name;
      const teamNames = teamIds.map(id => state.players.find(p => p.id === id).name).join(', ');
      const newState = {
        ...state,
        phase: PHASES.TEAM_VOTE,
        voteGeneration: state.voteGeneration + 1,
        proposal: Object.freeze({ teamIds: Object.freeze(teamIds.slice()), votes: Object.freeze({}), result: null, revealed: false }),
        questVotes: Object.freeze({}),
        phaseLock: false,
        log: appendLog(state.log, 'PROPOSAL', `${leaderName} proposed: ${teamNames} for Quest ${state.currentQuest + 1}. Vote now.`),
      };
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_TEAM_VOTE', generation: newState.voteGeneration }]) };
    }

    // ——— TEAM_VOTE: simultaneous approve/reject ———
    case 'SUBMIT_TEAM_VOTE': {
      assertPhase(state, [PHASES.TEAM_VOTE]);
      const { playerId, vote } = action.payload || {};
      assertPlayerExists(state, playerId);
      if (vote !== 'APPROVE' && vote !== 'REJECT') throw new Error('Vote must be APPROVE or REJECT');
      if (state.proposal.votes[playerId]) throw new Error('Already voted');
      if (state.proposal.teamIds.length === 0) throw new Error('No team proposed');

      const newVotes = Object.freeze({ ...state.proposal.votes, [playerId]: vote });
      const allVoted = Object.keys(newVotes).length === state.players.length;

      let newState = {
        ...state,
        proposal: Object.freeze({ ...state.proposal, votes: newVotes }),
      };

      const effects = [];
      if (allVoted) {
        // Auto-advance to reveal phase (atomic transition — D2)
        newState = {
          ...newState,
          phase: PHASES.TEAM_VOTE_REVEAL,
          phaseLock: true,
        };
        effects.push({ type: 'SCHEDULE_TEAM_VOTE_RESOLVE', ms: 1400, generation: state.voteGeneration });
      }
      return { state: Object.freeze(newState), effects: Object.freeze(effects) };
    }

    case 'FORCE_TEAM_VOTE_REVEAL': {
      // Fallback if timer or AI stall (D9, risk mitigation) — only if some votes missing
      assertPhase(state, [PHASES.TEAM_VOTE]);
      // Fill missing votes randomly (should be rare)
      const missing = state.players.filter(p => !state.proposal.votes[p.id]);
      if (missing.length === 0) {
        // Already all voted — just advance
        const newState = { ...state, phase: PHASES.TEAM_VOTE_REVEAL, phaseLock: true };
        return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'SCHEDULE_TEAM_VOTE_RESOLVE', ms: 600 }]) };
      }
      const filled = { ...state.proposal.votes };
      for (const p of missing) filled[p.id] = Math.random() > 0.5 ? 'APPROVE' : 'REJECT';
      const newState = {
        ...state,
        proposal: Object.freeze({ ...state.proposal, votes: Object.freeze(filled) }),
        phase: PHASES.TEAM_VOTE_REVEAL,
        phaseLock: true,
      };
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'SCHEDULE_TEAM_VOTE_RESOLVE', ms: 600 }]) };
    }

    case 'RESOLVE_TEAM_VOTE': {
      assertPhase(state, [PHASES.TEAM_VOTE_REVEAL]);
      const votes = state.proposal.votes;
      let approve = 0, reject = 0;
      for (const v of Object.values(votes)) {
        if (v === 'APPROVE') approve++;
        else reject++;
      }
      const passed = approve > reject; // tie = reject (RAW)
      const voteStr = `${approve}-${reject}`;

      if (passed) {
        const teamNames = state.proposal.teamIds.map(id => state.players.find(p => p.id === id).name).join(', ');
        const newState = {
          ...state,
          phase: PHASES.QUEST_VOTE,
          proposal: Object.freeze({ ...state.proposal, result: 'APPROVED', revealed: true }),
          questVotes: Object.freeze({}),
          phaseLock: false,
          log: appendLog(state.log, 'VOTE', `Team approved ${voteStr}. Quest team: ${teamNames}. Quest voting begins.`),
        };
        return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_QUEST_VOTE' }]) };
      } else {
        const nextTracker = state.proposalTracker + 1;
        if (nextTracker >= MAX_PROPOSAL_TRACKER) {
          // 5th reject → Evil wins instantly (D6)
          const newState = {
            ...state,
            proposalTracker: nextTracker,
            proposal: Object.freeze({ ...state.proposal, result: 'REJECTED', revealed: true }),
            phase: PHASES.GAME_OVER,
            winner: ALLEGIANCE.EVIL,
            winReason: 'TRACKER',
            phaseLock: false,
            log: appendLog(state.log, 'VOTE', `Team rejected ${voteStr}. 5th rejection — Evil wins by deadlock!`),
          };
          return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_GAME_OVER' }]) };
        }
        // Advance leader, reset proposal, stay in TEAM_PROPOSAL
        const nextLeader = nextLeaderIndex(state);
        const leaderName = state.players[nextLeader].name;
        const newState = {
          ...state,
          proposalTracker: nextTracker,
          leaderIndex: nextLeader,
          proposal: Object.freeze({ teamIds: [], votes: Object.freeze({}), result: 'REJECTED', revealed: true }),
          phase: PHASES.TEAM_PROPOSAL,
          phaseLock: false,
          log: appendLog(state.log, 'VOTE', `Team rejected ${voteStr} (${nextTracker}/5). Leader → ${leaderName}.`),
        };
        // Log reveal then new proposal — need to keep history
        // We also store voteHistory implicitly via log; could add explicit array but log suffices
        return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_TEAM_PROPOSAL' }]) };
      }
    }

    // ——— QUEST_VOTE: team secretly votes Success/Fail ———
    case 'SUBMIT_QUEST_VOTE': {
      assertPhase(state, [PHASES.QUEST_VOTE]);
      const { playerId, vote } = action.payload || {};
      assertPlayerExists(state, playerId);
      if (!state.proposal.teamIds.includes(playerId)) throw new Error('Only team members may quest-vote');
      if (vote !== 'SUCCESS' && vote !== 'FAIL') throw new Error('Quest vote must be SUCCESS or FAIL');
      if (state.questVotes[playerId]) throw new Error('Already quest-voted');
      const me = state.players.find(p => p.id === playerId);
      if (me.allegiance === ALLEGIANCE.GOOD && vote === 'FAIL') {
        throw new Error('Good players must play Success');
      }
      const newQuestVotes = Object.freeze({ ...state.questVotes, [playerId]: vote });
      const allVoted = Object.keys(newQuestVotes).length === state.proposal.teamIds.length;

      let newState = {
        ...state,
        questVotes: newQuestVotes,
      };
      const effects = [];
      if (allVoted) {
        newState = { ...newState, phase: PHASES.QUEST_REVEAL, phaseLock: true };
        effects.push({ type: 'SCHEDULE_QUEST_RESOLVE', ms: 1600 });
      }
      return { state: Object.freeze(newState), effects: Object.freeze(effects) };
    }

    case 'FORCE_QUEST_REVEAL': {
      assertPhase(state, [PHASES.QUEST_VOTE]);
      const missing = state.proposal.teamIds.filter(id => !state.questVotes[id]);
      const filled = { ...state.questVotes };
      for (const id of missing) {
        const p = state.players.find(x => x.id === id);
        // Good must Success, Evil random
        filled[id] = p.allegiance === ALLEGIANCE.GOOD ? 'SUCCESS' : (Math.random() > 0.5 ? 'FAIL' : 'SUCCESS');
      }
      const newState = {
        ...state,
        questVotes: Object.freeze(filled),
        phase: PHASES.QUEST_REVEAL,
        phaseLock: true,
      };
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'SCHEDULE_QUEST_RESOLVE', ms: 600 }]) };
    }

    case 'RESOLVE_QUEST': {
      assertPhase(state, [PHASES.QUEST_REVEAL]);
      const questIdx = state.currentQuest;
      const quest = state.quests[questIdx];
      if (!quest) throw new Error('No current quest');

      // Count fails (values, shuffled for public view — L3)
      const votesArr = Object.values(state.questVotes);
      const failCount = votesArr.filter(v => v === 'FAIL').length;
      const failsRequired = quest.failsRequired;
      const success = failCount < failsRequired;
      const status = success ? 'SUCCESS' : 'FAIL';
      const shuffled = shuffle(votesArr);

      const newQuests = state.quests.slice();
      newQuests[questIdx] = Object.freeze({
        ...quest,
        status,
        teamIds: Object.freeze(state.proposal.teamIds.slice()),
        failCount,
        votesShuffled: Object.freeze(shuffled),
      });

      const { good, evil } = countWins(newQuests);
      let winner = null;
      let winReason = null;
      let nextPhase = null;

      if (good >= WIN_THRESHOLD) {
        // Good reached 3 — go to assassination, not immediate win (D7)
        winner = null;
        nextPhase = PHASES.ASSASSINATION;
      } else if (evil >= WIN_THRESHOLD) {
        winner = ALLEGIANCE.EVIL;
        winReason = 'QUESTS';
        nextPhase = PHASES.GAME_OVER;
      } else if (questIdx >= 4) {
        // All 5 quests done (should have 3 wins already, but fallback)
        winner = good > evil ? ALLEGIANCE.GOOD : ALLEGIANCE.EVIL;
        winReason = 'QUESTS';
        nextPhase = PHASES.GAME_OVER;
      } else {
        nextPhase = PHASES.TEAM_PROPOSAL;
      }

      const questLabel = `Quest ${questIdx + 1}`;
      const resultText = success
        ? `${questLabel} succeeded with ${failCount} fail(s).`
        : `${questLabel} failed with ${failCount} fail(s) (needed ${failsRequired} to fail).`;

      let newState = {
        ...state,
        quests: Object.freeze(newQuests),
        proposalTracker: 0, // reset tracker after quest resolves (D6 correct timing)
        questVotes: Object.freeze({}),
        proposal: Object.freeze({ teamIds: [], votes: Object.freeze({}), result: null, revealed: false }),
        phaseLock: false,
        log: appendLog(state.log, success ? 'QUEST_SUCCESS' : 'QUEST_FAIL', resultText),
      };

      if (nextPhase === PHASES.ASSASSINATION) {
        newState = {
          ...newState,
          phase: PHASES.ASSASSINATION,
          currentQuest: questIdx + 1, // advance for display, but game in assassination
          log: appendLog(newState.log, 'PHASE', 'Good reached 3 quests! Assassin may now guess Merlin.'),
        };
        return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_ASSASSINATION' }]) };
      } else if (nextPhase === PHASES.GAME_OVER) {
        newState = {
          ...newState,
          phase: PHASES.GAME_OVER,
          winner,
          winReason,
          currentQuest: questIdx + 1,
          log: appendLog(newState.log, 'GAME_OVER', winner === ALLEGIANCE.GOOD ? 'Good wins by quests!' : 'Evil wins by quests!'),
        };
        return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_GAME_OVER' }]) };
      } else {
        // Advance leader and quest
        const nextLeader = nextLeaderIndex(state);
        const leaderName = state.players[nextLeader].name;
        newState = {
          ...newState,
          phase: PHASES.TEAM_PROPOSAL,
          currentQuest: questIdx + 1,
          leaderIndex: nextLeader,
          log: appendLog(newState.log, 'PHASE', `Next: Quest ${questIdx + 2} — Leader ${leaderName} proposes.`),
        };
        return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_TEAM_PROPOSAL' }]) };
      }
    }

    // ——— ASSASSINATION ———
    case 'ASSASSINATE': {
      assertPhase(state, [PHASES.ASSASSINATION]);
      const { targetId } = action.payload || {};
      assertPlayerExists(state, targetId);
      const target = state.players.find(p => p.id === targetId);
      if (target.allegiance !== ALLEGIANCE.GOOD) throw new Error('Can only assassinate Good players');
      // Verify assassin is Evil? In simulated host, any dispatch allowed, but we check target validity
      const success = target.role === ROLES.MERLIN;
      const winner = success ? ALLEGIANCE.EVIL : ALLEGIANCE.GOOD;
      const newState = {
        ...state,
        phase: PHASES.GAME_OVER,
        winner,
        winReason: 'ASSASSINATION',
        assassination: Object.freeze({ targetId, success }),
        phaseLock: false,
        log: appendLog(state.log, 'ASSASSINATION', success
          ? `Assassin killed Merlin (${target.name}) — Evil wins!`
          : `Assassin shot ${target.name} — not Merlin. Good wins!`),
      };
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_GAME_OVER' }]) };
    }

    // ——— TIMER_EXPIRED (view-only, not authoritative) ———
    case 'TIMER_EXPIRED': {
      if (state.phaseLock) {
        // Ignore during reveal animations (D4)
        return { state, effects: Object.freeze([]) };
      }
      if (state.phase === PHASES.TEAM_VOTE) {
        // Auto-fill remaining team votes
        return reducer(state, { type: 'FORCE_TEAM_VOTE_REVEAL' });
      }
      if (state.phase === PHASES.QUEST_VOTE) {
        return reducer(state, { type: 'FORCE_QUEST_REVEAL' });
      }
      return { state, effects: Object.freeze([]) };
    }

    case 'RESET': {
      const newState = createInitialState();
      return { state: Object.freeze(newState), effects: Object.freeze([{ type: 'ENTER_LOBBY' }]) };
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

// ——— Selectors for UI ———
function isGameOver(state) { return state.phase === PHASES.GAME_OVER; }
function getLeader(state) { return state.players[state.leaderIndex] || null; }
function getQuest(state) { return state.quests[state.currentQuest] || null; }

// ---- js\storage.js ----
/**
 * js/storage.js — Persistence abstraction (versioned snapshot)
 * Saves entire state to localStorage; validates on load.
 * Handles quota errors gracefully (fallback to memory-only).
 */
// import inlined
// import inlined
/**
 * Save state snapshot. Wraps localStorage with try/catch for private mode / quota.
 * Returns true if saved, false if failed (caller may toast).
 */
function save(state) {
  try {
    const payload = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (e) {
    console.warn('[storage] save failed:', e);
    return false;
  }
}

/**
 * Load persisted state, validate schema version and shape.
 * Returns null if missing/invalid (caller should use createInitialState).
 */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    // Version check — discard stale snapshots
    if (data.version !== STORAGE_VERSION) {
      console.info('[storage] version mismatch, discarding', data.version, 'vs', STORAGE_VERSION);
      clear();
      return null;
    }
    // Basic shape validation (cheap but catches corruption)
    if (!Array.isArray(data.players) || data.players.length < 5 || data.players.length > 10) {
      // Allow empty lobby state (players may be [] in initial state after reset? Actually initial has [])
      // But persisted game should have 5-10; if 0 players, it's okay to keep if phase LOBBY
      if (data.phase !== 'LOBBY' && data.players.length !== 0) return null;
    }
    if (typeof data.phase !== 'string') return null;
    if (typeof data.currentQuest !== 'number' || data.currentQuest < 0 || data.currentQuest > 5) return null;
    if (typeof data.proposalTracker !== 'number' || data.proposalTracker < 0 || data.proposalTracker > 5) return null;
    // Re-freeze shallowly is not needed; reducer will treat as mutable input then freeze outputs
    return data;
  } catch (e) {
    console.warn('[storage] load failed:', e);
    return null;
  }
}

function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[storage] clear failed:', e);
  }
}

// ---- js\net.js ----
/**
 * js/net.js — Backend abstraction for distributed play (own phones)
 * Supports:
 *  - localStorage + BroadcastChannel (same browser, demo)
 *  - HTTP API /api/room/<CODE> via serve.py (real cross-device on same WiFi)
 *  - Falls back gracefully when API not available (Netlify etc.)
 */
// import inlined
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

async function pushRoom(code, roomData) {
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

async function createRoom(code, hostPlayer) {
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

function getRoom(code) {
  // Sync version — checks local only (for immediate render)
  return getLocalRoom(code);
}

async function getRoomAsync(code) {
  return await fetchRoom(code);
}

async function joinRoom(code, player) {
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

async function updateRoomState(code, newState) {
  let room = await fetchRoom(code);
  if (!room) room = { code, createdAt: Date.now(), players: [], hostId: null };
  // Merge with server state to avoid losing concurrent votes
  if (room.state) newState = mergeStates(room.state, newState);
  room.state = newState;
  room.updatedAt = Date.now();
  await pushRoom(code, room);
}

function updateRoomStateSync(code, newState) {
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

function subscribe(code, callback) {
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

function leaveRoom(code, playerId) {
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

async function deleteRoom(code) {
  if (!isValidRoomCode(code)) return;
  try {
    await fetch(`/api/room/${code}`, { method: 'DELETE' });
  } catch(_){}
  try { localStorage.removeItem(roomKey(code)); } catch(_){}
  const ch = getChannel(code);
  if (ch) ch.postMessage({ type: 'ROOM_DELETED', code });
}

function generateInviteLink(code) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

function parseInviteCode() {
  try {
    const url = new URL(window.location.href);
    const c = url.searchParams.get('room');
    if (c && isValidRoomCode(c.toUpperCase())) return c.toUpperCase();
  } catch(_){}
  return null;
}

// ---- js\games\avalon\ai.js ----
/**
 * js/ai.js — Intelligent bot decisioning (knowledge-scoped)
 * ------------------------------------------------------------------
 * Every function receives ONLY the knowledge that bot should have:
 *   aiView = getAIView(state, botId)  -> { public, self, vision }
 * Bots never see full state, never see other players' private quest votes,
 * and Evil bots do NOT know Merlin identity (L4, L7).
 * This isolation is enforced by state.js; ai.js trusts the view.
 *
 * Strategies are lightweight heuristics that feel human, not optimal solvers.
 */
// import inlined
// import inlined
/**
 * Propose a team (leader is bot).
 * @param {object} aiView
 * @returns {string[]} teamIds (size = quest size)
 */
function aiProposeTeam(aiView) {
  const { public: pub, self, vision } = aiView;
  const quest = pub.quests[pub.currentQuest];
  if (!quest) throw new Error('No quest for AI propose');
  const need = quest.size;
  const allIds = pub.players.map(p => p.id);

  // Good bot: try to propose other Goods it trusts (it doesn't know Evil except Merlin)
  // Evil bot: try to include itself + maybe one Good to blend, or stack Evil if close to win
  const isEvil = self.allegiance === ALLEGIANCE.EVIL;

  // Build trust scores from history: approves correlate with trust
  // Simple: prefer players who were on successful quests
  const goodMemory = new Map();
  for (const p of pub.players) goodMemory.set(p.id, 0);
  // Bonus for leader self
  goodMemory.set(self.id, 2);

  for (const q of pub.quests) {
    if (q.status === 'SUCCESS' && q.teamIds?.length) {
      for (const id of q.teamIds) goodMemory.set(id, (goodMemory.get(id) || 0) + 1);
    } else if (q.status === 'FAIL' && q.teamIds?.length) {
      for (const id of q.teamIds) goodMemory.set(id, (goodMemory.get(id) || 0) - 1);
    }
  }

  if (!isEvil) {
    // Good AI: pick highest trusted, includes self
    // If Merlin, avoid picking known Evils (vision.sees)
    const evils = new Set(vision.sees);
    let pool = allIds.filter(id => !evils.has(id));
    // If not enough pool (should not happen), fallback to all
    if (pool.length < need) pool = allIds.slice();
    // Sort by trust desc, then random
    pool = shuffle(pool);
    pool.sort((a, b) => (goodMemory.get(b) || 0) - (goodMemory.get(a) || 0));
    // Ensure self included if Good (feels natural)
    const team = [];
    if (pool.includes(self.id)) team.push(self.id);
    for (const id of pool) {
      if (team.length >= need) break;
      if (!team.includes(id)) team.push(id);
    }
    // Fill if still short
    while (team.length < need) {
      const pick = sample(allIds.filter(id => !team.includes(id)));
      if (!pick) break;
      team.push(pick);
    }
    return team.slice(0, need);
  } else {
    // Evil AI: include self, maybe one other Evil, blend with Good
    const otherEvil = vision.sees; // other evils
    const evilsSet = new Set([self.id, ...otherEvil]);
    const goods = allIds.filter(id => !evilsSet.has(id));

    // Strategy: 60% blend (1 evil + goods), 30% stack 2 evils if need>=3, 10% all goods (deep cover)
    const roll = Math.random();
    let team = [];
    if (roll < 0.6) {
      team.push(self.id);
      // Fill remainder with highest trusted Goods (to appear good)
      const goodPool = shuffle(goods.slice()).sort((a, b) => (goodMemory.get(b) || 0) - (goodMemory.get(a) || 0));
      for (const id of goodPool) {
        if (team.length >= need) break;
        team.push(id);
      }
      // If need more and we have other evil to include, maybe include
      if (team.length < need && otherEvil.length > 0 && Math.random() < 0.3) {
        team[team.length - 1] = sample(otherEvil);
      }
    } else if (roll < 0.9 && otherEvil.length > 0 && need >= 3) {
      // Stack evils
      team.push(self.id);
      team.push(sample(otherEvil));
      const goodPool = shuffle(goods.slice());
      for (const id of goodPool) {
        if (team.length >= need) break;
        team.push(id);
      }
    } else {
      // Deep cover: propose all goods (no self) — rare
      const goodPool = shuffle(goods.slice());
      team = goodPool.slice(0, need);
      if (team.length < need) team.push(self.id);
    }
    // Ensure size and uniqueness
    team = [...new Set(team)];
    while (team.length < need) {
      const pick = sample(allIds.filter(id => !team.includes(id)));
      if (!pick) break;
      team.push(pick);
    }
    // If still includes duplicates, fill
    return shuffle(team).slice(0, need);
  }
}

/**
 * Team vote: approve or reject.
 * @param {object} aiView
 * @param {string[]} proposedTeam
 * @returns {'APPROVE'|'REJECT'}
 */
function aiTeamVote(aiView, proposedTeam) {
  const { public: pub, self, vision } = aiView;
  const isEvil = self.allegiance === ALLEGIANCE.EVIL;
  const evils = new Set([self.id, ...vision.sees]);
  // Good knows evils only if Merlin; otherwise uses heuristics
  const knownEvils = self.role === ROLES.MERLIN ? new Set(vision.sees) : new Set();
  // Count how many proposed are known evils (for Merlin) or suspected via history
  let evilCountInTeam = 0;
  for (const id of proposedTeam) {
    if (knownEvils.has(id)) evilCountInTeam++;
  }
  // For non-Merlin Good, suspect those who were on failed quests
  if (self.role !== ROLES.MERLIN && self.allegiance === ALLEGIANCE.GOOD) {
    const failPenalty = new Map();
    for (const q of pub.quests) {
      if (q.status === 'FAIL' && q.failCount > 0) {
        for (const id of q.teamIds) failPenalty.set(id, (failPenalty.get(id) || 0) + 1);
      }
    }
    for (const id of proposedTeam) {
      if ((failPenalty.get(id) || 0) > 0 && !proposedTeam.includes(self.id)) {
        // Suspicion without proof — slight bias
        evilCountInTeam += 0.4;
      }
    }
  }

  if (!isEvil) {
    // Good: approve if team looks clean and includes trusted members
    if (self.role === ROLES.MERLIN) {
      return evilCountInTeam === 0 ? 'APPROVE' : 'REJECT';
    }
    // Loyal: approve if evilCount low, or if near tracker 4 (must not deadlock)
    if (pub.proposalTracker >= 4) return 'APPROVE'; // avoid Evil tracker win
    if (evilCountInTeam >= 1) return Math.random() < 0.2 ? 'APPROVE' : 'REJECT'; // mostly reject dirty teams
    // Also reject teams that exclude self too often? Slight bias to approve self-including
    if (proposedTeam.includes(self.id)) return Math.random() < 0.85 ? 'APPROVE' : 'REJECT';
    return Math.random() < 0.6 ? 'APPROVE' : 'REJECT';
  } else {
    // Evil: approve if on team (want quest to happen to sabotage) or if team has enough Evil
    const onTeam = proposedTeam.includes(self.id);
    const evilInTeam = proposedTeam.filter(id => evils.has(id)).length;
    if (onTeam) {
      // Sometimes reject to blend as Good (20%)
      return Math.random() < 0.8 ? 'APPROVE' : 'REJECT';
    } else {
      // Off team: reject if tracker low to force own leadership later, but not if tracker high
      if (pub.proposalTracker >= 3) return Math.random() < 0.5 ? 'APPROVE' : 'REJECT';
      // Approve small good teams to let quest succeed and hide? Mixed
      return evilInTeam > 0 ? 'APPROVE' : (Math.random() < 0.45 ? 'APPROVE' : 'REJECT');
    }
  }
}

/**
 * Quest vote: Success or Fail (only called for team members, Evil may choose).
 * @param {object} aiView
 * @returns {'SUCCESS'|'FAIL'}
 */
function aiQuestVote(aiView) {
  const { public: pub, self } = aiView;
  if (self.allegiance === ALLEGIANCE.GOOD) return 'SUCCESS'; // Good must
  // Evil: decide to Fail or bluff Success
  const quest = pub.quests[pub.currentQuest];
  const evilWins = pub.quests.filter(q => q.status === 'FAIL').length;
  const goodWins = pub.quests.filter(q => q.status === 'SUCCESS').length;

  // If this is game point for Evil (2 wins already), always Fail if possible
  if (evilWins === 2) return 'FAIL';
  // If quest requires 2 fails and only one Evil on team, bluff Success to avoid waste (30% bluff)
  const evilsOnTeam = pub.proposal.teamIds.filter(id => {
    // Count using vision — but Evil knows other evils on team?
    // We approximate: if self is Evil and there are other team members who are Evil per vision
    const v = aiView.vision.sees;
    const evilSet = new Set([self.id, ...v]);
    return evilSet.has(id);
  }).length;
  if (quest && quest.failsRequired === 2 && evilsOnTeam === 1) {
    return Math.random() < 0.5 ? 'FAIL' : 'SUCCESS'; // sometimes save for next
  }
  // Early quests: 30% bluff Success to obscure
  if (pub.currentQuest <= 1 && Math.random() < 0.3) return 'SUCCESS';
  // Generally Fail 75% of time when Evil on quest
  return Math.random() < 0.75 ? 'FAIL' : 'SUCCESS';
}

/**
 * Assassination: pick a Good player to kill. Scores Good players by merlin-likeness.
 * Evil does NOT know Merlin directly — must infer (L7). So we score heuristics.
 * @param {object} aiView — Assassin's view (Evil, sees other Evils, knows Good set)
 * @param {Array} allPlayersPublic — pub.players
 * @param {object} pub — public state (for history)
 * @returns {string} targetId
 */
function aiAssassinate(aiView, allPlayersPublic, pub) {
  const evilSet = new Set([aiView.self.id, ...aiView.vision.sees]);
  const goodIds = pub.players.filter(p => !evilSet.has(p.id)).map(p => p.id);
  if (goodIds.length === 0) return pub.players[0].id;
  if (goodIds.length === 1) return goodIds[0];

  // Score each Good by: never on failed quest + high approval accuracy + leader proposals that were clean
  const scores = new Map(goodIds.map(id => [id, 0]));

  // Bonus for not being on any failed quest team (Merlin behavior: avoids evil teams)
  for (const id of goodIds) {
    let failsOn = 0;
    for (const q of pub.quests) {
      if (q.status === 'FAIL' && q.teamIds.includes(id)) failsOn++;
    }
    scores.set(id, scores.get(id) - failsOn * 2);
  }

  // Bonus for proposing clean teams (if that Good was leader)
  // We use log text heuristics: not robust, so just add small random to simulate uncertainty
  for (const id of goodIds) {
    // Loyal servants often approve dirty teams; Merlin rejects dirty teams consistently
    // We simulate: Merlin-like players have high reject rate on teams that later failed
    // Since we don't have per-player vote history in public view (votes only revealed after),
    // we approximate with random + slight bias: Assassin guesses the quiet, consistent player
    scores.set(id, scores.get(id) + Math.random() * 1.5);
  }

  // Slight bias: middle player in list often not Merlin in random assignment, but ignore

  // Pick highest score
  let best = goodIds[0];
  let bestScore = -Infinity;
  for (const id of goodIds) {
    const s = scores.get(id) + (Math.random() * 0.4); // jitter
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best;
}

// ---- js\lobby\storage.js ----
/**
 * js/lobby/storage.js — Generic lobby persistence (room code + draft)
 * Single source for roomCode, no player merge — KV is authoritative.
 */
// import inlined
function lobbyPlayerId() {
  return `lobby_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2,6)}`;
}
function ensureLobbyIds(players) {
  for (const p of players) if (!p.id) p.id = lobbyPlayerId();
}

function defaultLobby() {
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

function persistLobbyCode(code) {
  try { localStorage.setItem('avalon:lastRoomCode', code); } catch(_) {}
}
function saveLobbyDraft(draft) {
  try { ensureLobbyIds(draft.players); localStorage.setItem('avalon:lobby:' + draft.roomCode, JSON.stringify({ players: draft.players, extraRoles: draft.extraRoles, gameId: draft.gameId })); } catch(_){}
}

// ---- js\lobby\ui.js ----
/**
 * js/lobby/ui.js — Generic Table Party lobby shell
 * Renders invite card, avatar row, player count. Delegates game-specific options to game module.
 */
import { EXTRA_ROLES } from '../games/avalon/config.js'; // fallback, real per-game via registry

function renderLobbyShell(ctx) {
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

// ---- js\games\avalon\ui.js ----
/**
 * js/games/avalon/ui.js — Avalon-specific lobby options + in-game UI helpers
 */
// import inlined
function renderAvalonOptions(extraRoles, playerCount, isJoiner) {
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

// ---- js\games\registry.js ----
/**
 * js/games/registry.js — Table Party game registry
 * Avalon is one module; add more games here and lobby will pick them up.
 */
// import inlined
// import inlined
// import inlined
import { renderQuestTrack, renderProposalTracker, renderTimer, renderPlayerGrid } from '../ui/components.js'; // generic + avalon exact will be in avalon/ui.js

const GAMES = {
  'quest-of-shadows': {
    id: 'quest-of-shadows',
    label: 'Quest of Shadows',
    subtitle: 'Good outnumbers evil, but evil knows...',
    desc: 'Good outnumbers evil, but evil knows exactly who everyone is. Merlin knows too.',
    icon: '🗡️',
    iconBg: 'bg-[#2a4a5a]',
    minPlayers: 5,
    maxPlayers: 10,
    config: avalonConfig,
    state: avalonState,
    ai: avalonAI,
    // Lobby options schema — used by lobby/ui to render per-game controls
    optionsSchema: [
      { key: 'percival', label: 'Percival', side: 'GOOD' },
      { key: 'morgana', label: 'Morgana', side: 'EVIL' },
      { key: 'mordred', label: 'Mordred', side: 'EVIL' },
      { key: 'oberon', label: 'Oberon', side: 'EVIL' },
    ],
    defaultOptions: { percival: true, morgana: true, mordred: false, oberon: false },
  },
  // TODO: add more games here: { id: 'fake-answers', ... }
};

function getGame(id) {
  return GAMES[id] || GAMES['quest-of-shadows'];
}
function listGames() {
  return Object.values(GAMES);
}

// ---- js\ui\log.js ----
/**
 * js/ui/log.js — Live Game Logs renderer (floating/sidebar panel)
 * Pure render function: (logEntries) -> HTMLElement string
 * Auto-scroll handled by caller.
 */

const TYPE_ICON = {
  SETUP: '⚙️',
  REVEAL: '👁️',
  PROPOSAL: '🛡️',
  VOTE: '🗳️',
  QUEST_SUCCESS: '⚔️',
  QUEST_FAIL: '💀',
  PHASE: '📜',
  ASSASSINATION: '🗡️',
  GAME_OVER: '👑',
  DEFAULT: '•',
};

function iconFor(type) {
  return TYPE_ICON[type] || TYPE_ICON.DEFAULT;
}

/**
 * Render log panel container.
 * @param {Array} log - state.log
 * @returns {string} HTML
 */
function renderLog(log) {
  const entries = log.slice(-40).reverse(); // show latest 40, newest top
  if (entries.length === 0) {
    return `
      <div class="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
        <p class="text-sm text-stone-500 italic">No events yet. The council awaits…</p>
      </div>
    `;
  }
  const rows = entries.map(e => {
    const icon = iconFor(e.type);
    const time = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // Escape text via DOM textContent safety — here we interpolate as text, so escape
    const text = escape(e.text);
    const cls = e.type === 'QUEST_FAIL' ? 'text-evil' : e.type === 'QUEST_SUCCESS' ? 'text-good' : 'text-stone-200';
    return `
      <div class="log-entry flex gap-3 py-2.5 px-3 rounded-xl hover:bg-white/[0.04] transition-colors border border-transparent hover:border-white/[0.04]">
        <span class="shrink-0 w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[13px]">${icon}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[13px] leading-snug ${cls}">${text}</p>
          <p class="text-[11px] text-stone-500 font-mono mt-0.5">${time} · ${e.type}</p>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="rounded-2xl bg-[#0f172a]/80 border border-white/[0.08] backdrop-blur-xl overflow-hidden shadow-xl">
      <div class="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <h3 class="font-display font-bold text-[13px] tracking-[0.14em] text-white">LIVE LOG</h3>
        <span class="text-[11px] font-medium px-2 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-stone-400">${log.length} events</span>
      </div>
      <div id="log-scroll" class="max-h-[320px] overflow-auto divide-y divide-white/[0.03] logs-drawer scrollbar-thin">
        ${rows}
      </div>
    </div>
  `;
}

function escape(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- js\ui\modals.js ----
/**
 * js/ui/modals.js — Secure overlay modal system (anti-leakage L2)
 * All modals are created then DOM-removed on hide (not display:none).
 * Role cards are ephemeral — never persisted as data-attributes.
 */
// import inlined
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
function showRoleReveal({ playerName, role, allegiance, visionIds, allPlayers, onHide, onNext, isLast }) {
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
function showQuestVote({ playerName, isEvil, onSubmit }) {
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
function showConfirm({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, variant = 'default' }) {
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

// ---- js\ui\components.js ----
/**
 * js/ui/components.js — Pure render helpers for Quest Track, Player Grid, Proposal Tracker, Timer, etc.
 * Each export is a function (publicState, dispatch) => HTML string or DOM helper.
 * No state mutation, no side effects beyond string generation.
 * Updated for Table Party blended lobby + extra roles.
 */
// import inlined
// ——— Quest Track ———
function renderQuestTrack(pub) {
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
function renderProposalTracker(pub) {
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
function renderTimer(pub, remainingSec, totalSec) {
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
function renderPlayerGrid(pub, selectedIds = []) {
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
function renderLobby(ctx) {
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

function renderPrivateRole(pub, myId) {
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

function renderRoleReveal(pub) {
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

function renderExactHeader(current, total) {
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

function renderExactQuestTrack(pub) {
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

function renderExactAllegiance(pub, myId, opts={}) {
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

function renderExactVision(pub, myId) {
  // For exact, we need vision info — caller will provide via getVision
  // This is a placeholder that app.js will fill with actual names
  // We keep it generic here and let app.js pass HTML
  return ``;
}

function renderExactTableSummary(pub) {
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

function renderExactAvatarRow(pub, myId, statusMap) {
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

function renderExactBottomButton(text, id, opts={}) {
  const variant = opts.variant || 'primary'; // primary = light blue, danger = red, ghost
  let cls = 'w-full py-4 rounded-full bg-[#7ec8e6] hover:bg-[#a0d8ef] text-[#0a1e2e] font-black tracking-wide shadow-xl';
  if (variant==='danger') cls='w-full py-4 rounded-full bg-[#1a2a3a] border border-rose-400/50 text-rose-300 font-bold';
  if (variant==='ghost') cls='w-full py-4 rounded-full bg-white/5 border border-white/10 text-white/70 font-bold';
  const disabled = opts.disabled ? 'disabled opacity-50 cursor-not-allowed' : '';
  return `<button id="${id}" ${disabled} class="${cls} transition-colors">${escape(text)}</button>`;
}

// ——— TABLE PARTY HOME (Pick a game) ———
const HOME_GAMES = [
  { id:'quest-of-shadows', title:'Quest of Shadows', subtitle:'Good outnumbers evil, but evil knows...', desc:'Good outnumbers evil, but evil knows exactly who everyone is. Merlin knows too — and has to spend the whole game making sure nobody works out that he does.', inspired:'Inspired by The Resistance: Avalon', icon:'🗡️', iconBg:'bg-[#2a4a5a]', players:'5-10', time:'15-25', type:'Deduction', enabled:true },
  { id:'fake-answers', title:'Fake Answers', subtitle:'Inspired by Psych!', players:'3-12', time:'10 min', icon:'🔥', iconBg:'bg-[#3a2a1a]', enabled:false },
  { id:'boggle', title:'Boggle', subtitle:'Shake. Hunt. Don\'t match.', players:'1-12', time:'10 min', icon:'🎲', iconBg:'bg-[#2a3a1a]', enabled:false },
  { id:'quip', title:'Quip Battle', subtitle:'Inspired by Quiplash', players:'3-12', time:'15 min', icon:'💬', iconBg:'bg-[#1a3a4a]', enabled:false },
];

function renderHome(searchQuery='') {
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

function renderGamePopup(hostName='') {
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

function renderJoinCodeScreen(code='') {
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

// ---- js\app.js ----
/**
 * js/app.js — Core router (v3) — Distributed play (own devices) + Table Party lobby
 * Each player on own device sees private role, no passing.
 * Keeps pure reducer orchestration + backend abstraction via net.js
 */
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
// import inlined
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

})();