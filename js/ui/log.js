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
export function renderLog(log) {
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
