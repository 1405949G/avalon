/**
 * js/games/registry.js — Table Party game registry
 * Avalon is one module; add more games here and lobby will pick them up.
 */
import * as avalonConfig from './avalon/config.js';
import * as avalonState from './avalon/state.js';
import * as avalonAI from './avalon/ai.js';
import { renderQuestTrack, renderProposalTracker, renderTimer, renderPlayerGrid } from '../ui/components.js'; // generic + avalon exact will be in avalon/ui.js

export const GAMES = {
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

export function getGame(id) {
  return GAMES[id] || GAMES['quest-of-shadows'];
}
export function listGames() {
  return Object.values(GAMES);
}
