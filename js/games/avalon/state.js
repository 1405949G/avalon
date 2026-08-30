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
} from './config.js';
import { shuffle, uid } from './utils.js';

// ——— Initial state factory ———
export function createInitialState() {
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

export function getVision(state, playerId) {
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

export function getPublicState(state) {
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

export function getPrivateState(state, playerId) {
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

export function getAIView(state, botId) {
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
export function reducer(state, action) {
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
export function isGameOver(state) { return state.phase === PHASES.GAME_OVER; }
export function getLeader(state) { return state.players[state.leaderIndex] || null; }
export function getQuest(state) { return state.quests[state.currentQuest] || null; }
