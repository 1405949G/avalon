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

import { ALLEGIANCE, ROLES } from './config.js';
import { sample, shuffle } from './utils.js';

/**
 * Propose a team (leader is bot).
 * @param {object} aiView
 * @returns {string[]} teamIds (size = quest size)
 */
export function aiProposeTeam(aiView) {
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
export function aiTeamVote(aiView, proposedTeam) {
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
export function aiQuestVote(aiView) {
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
export function aiAssassinate(aiView, allPlayersPublic, pub) {
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
