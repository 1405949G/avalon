/**
 * js/utils.js — Pure helper utilities.
 * No DOM, no state — safe to use anywhere.
 */

/**
 * Shuffle array in-place using Fisher-Yates.
 * Uses crypto.getRandomValues if available for better randomness (role assignment).
 * Returns new array (does not mutate input).
 */
export function shuffle(array, rng = Math.random) {
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
export function uid(prefix = 'p') {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/**
 * Clamp number between min and max.
 */
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Escape text for safe DOM insertion via textContent (defense against XSS from player names).
 * This is a no-op if used with textContent, but useful if building HTML strings.
 */
export function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Deep clone via JSON — sufficient for our state shape (no functions, no Dates except numbers).
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick random element.
 */
export function sample(arr) {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Simple debounce.
 */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Format quest result text.
 */
export function questResultLabel(status) {
  if (status === 'SUCCESS') return 'Success';
  if (status === 'FAIL') return 'Fail';
  return 'Pending';
}

/**
 * Validate player name: 1-16 chars, alphanumeric + spaces, apostrophes, hyphens.
 * Returns trimmed name or throws.
 */
export function validateName(raw) {
  const name = String(raw).trim();
  if (!name) throw new Error('Name cannot be empty');
  if (name.length > 16) throw new Error('Name too long (max 16)');
  if (!/^[\p{L}\p{N} .'\-]+$/u.test(name)) throw new Error('Name contains invalid characters');
  return name;
}

/**
 * Sleep helper for async AI delays (used in app.js, not reducer).
 */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
