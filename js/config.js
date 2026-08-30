/**
 * js/config.js — Avalon configuration tables (Quest of Shadows) — v3 with extra roles
 * Pure constants, no side effects. Fully commented.
 */

export const PHASES = Object.freeze({
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

export const ALLOWED_TRANSITIONS = Object.freeze({
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

export const QUEST_SIZES = Object.freeze({
  5: Object.freeze([2, 3, 2, 3, 3]),
  6: Object.freeze([2, 3, 4, 3, 4]),
  7: Object.freeze([2, 3, 3, 4, 4]),
  8: Object.freeze([3, 4, 4, 5, 5]),
  9: Object.freeze([3, 4, 4, 5, 5]),
  10: Object.freeze([3, 4, 4, 5, 5]),
});

export const FAILS_REQUIRED = Object.freeze({
  5: Object.freeze([1, 1, 1, 1, 1]),
  6: Object.freeze([1, 1, 1, 1, 1]),
  7: Object.freeze([1, 1, 1, 2, 1]),
  8: Object.freeze([1, 1, 1, 2, 1]),
  9: Object.freeze([1, 1, 1, 2, 1]),
  10: Object.freeze([1, 1, 1, 2, 1]),
});

export const ROLE_COUNTS = Object.freeze({
  5: Object.freeze({ good: 3, evil: 2, merlin: 1, assassin: 1, loyal: 2, minion: 1 }),
  6: Object.freeze({ good: 4, evil: 2, merlin: 1, assassin: 1, loyal: 3, minion: 1 }),
  7: Object.freeze({ good: 4, evil: 3, merlin: 1, assassin: 1, loyal: 3, minion: 2 }),
  8: Object.freeze({ good: 5, evil: 3, merlin: 1, assassin: 1, loyal: 4, minion: 2 }),
  9: Object.freeze({ good: 6, evil: 3, merlin: 1, assassin: 1, loyal: 5, minion: 2 }),
  10: Object.freeze({ good: 6, evil: 4, merlin: 1, assassin: 1, loyal: 5, minion: 3 }),
});

// Role enum — base + extra (Table Party)
export const ROLES = Object.freeze({
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
export const EXTRA_ROLES = Object.freeze([
  { key: 'percival', role: ROLES.PERCIVAL, label: 'Percival', side: 'GOOD', desc: 'Sees Merlin' },
  { key: 'morgana', role: ROLES.MORGANA, label: 'Morgana', side: 'EVIL', desc: 'Fools Percival' },
  { key: 'mordred', role: ROLES.MORDRED, label: 'Mordred', side: 'EVIL', desc: 'Hidden from Merlin' },
  { key: 'oberon', role: ROLES.OBERON, label: 'Oberon', side: 'EVIL', desc: 'Isolated Evil' },
]);

// Balancing: max extra evil roles by player count to keep Good majority
export function getMaxExtraEvil(playerCount) {
  if (playerCount <= 6) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}
export function getEffectiveExtraRoles(playerCount, opts) {
  const max = getMaxExtraEvil(playerCount);
  const enabled = ['morgana','mordred','oberon'].filter(k=> !!opts[k]);
  if (enabled.length <= max) return { ...opts };
  // Trim to max in priority order: keep earliest enabled, drop overflow
  const trimmed = { ...opts, morgana:false, mordred:false, oberon:false };
  for (let i=0;i<Math.min(enabled.length, max);i++) trimmed[enabled[i]] = true;
  return trimmed;
}

export const ALLEGIANCE = Object.freeze({
  GOOD: 'GOOD',
  EVIL: 'EVIL',
});

export function allegianceOf(role) {
  if (role === ROLES.LOYAL || role === ROLES.MERLIN || role === ROLES.PERCIVAL) return ALLEGIANCE.GOOD;
  return ALLEGIANCE.EVIL;
}

export const MAX_PROPOSAL_TRACKER = 5;
export const WIN_THRESHOLD = 3;
export const TIMER_SECONDS = 90;
export const REVEAL_ANIM_MS = 1200;
export const STORAGE_KEY = 'avalon:quest-of-shadows:v3';
export const STORAGE_VERSION = 3;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_STORAGE_PREFIX = 'avalon:room:';

export function getQuestSize(playerCount, questIndex) {
  const sizes = QUEST_SIZES[playerCount];
  if (!sizes) throw new Error(`Unsupported player count: ${playerCount}`);
  if (questIndex < 0 || questIndex >= 5) throw new Error(`Invalid quest index: ${questIndex}`);
  return sizes[questIndex];
}

export function getFailsRequired(playerCount, questIndex) {
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
export function getRoleList(playerCount, opts = {}) {
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
export function generateRoomCode() {
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

export function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-Z]{4}$/.test(code);
}
