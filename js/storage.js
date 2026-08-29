/**
 * js/storage.js — Persistence abstraction (versioned snapshot)
 * Saves entire state to localStorage; validates on load.
 * Handles quota errors gracefully (fallback to memory-only).
 */

import { STORAGE_KEY, STORAGE_VERSION } from './config.js';
import { createInitialState } from './state.js';

/**
 * Save state snapshot. Wraps localStorage with try/catch for private mode / quota.
 * Returns true if saved, false if failed (caller may toast).
 */
export function save(state) {
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
export function load() {
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

export function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[storage] clear failed:', e);
  }
}
