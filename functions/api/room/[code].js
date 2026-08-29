/**
 * Cloudflare Pages Function — /api/room/:code
 * Handles cross-device lobby + game state for Avalon.
 * Uses KV if bound (AVALON_ROOMS), else in-memory fallback for local preview.
 */

// In-memory fallback for `wrangler pages dev` without KV
const MEM = globalThis.__AVALON_MEM__ || (globalThis.__AVALON_MEM__ = new Map());

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ params, env }) {
  const code = (params.code || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }
  try {
    let room = null;
    if (env && env.AVALON_ROOMS) {
      const raw = await env.AVALON_ROOMS.get(`room:${code}`);
      if (raw) room = JSON.parse(raw);
    } else {
      room = MEM.get(code) || null;
    }
    if (!room) {
      return new Response(JSON.stringify({ error: 'Room not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    return new Response(JSON.stringify(room), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() });
  }
}

function mergeStatesCf(oldState, incomingState) {
  if (!oldState || !incomingState) return incomingState || oldState;
  if (oldState.phase !== incomingState.phase) return incomingState;
  const merged = { ...incomingState };
  try {
    const ep = oldState.proposal || {};
    const ip = incomingState.proposal || {};
    if ((ep.votes && Object.keys(ep.votes).length) || (ip.votes && Object.keys(ip.votes).length)) {
      const mv = { ...(ep.votes||{}), ...(ip.votes||{}) };
      merged.proposal = { ...(ip||ep), votes: mv };
    }
    const eqv = oldState.questVotes || {};
    const iqv = incomingState.questVotes || {};
    if (Object.keys(eqv).length || Object.keys(iqv).length) {
      merged.questVotes = { ...eqv, ...iqv };
    }
    if (Array.isArray(oldState.revealed) && Array.isArray(incomingState.revealed)) {
      const maxlen = Math.max(oldState.revealed.length, incomingState.revealed.length);
      const mr = Array.from({length: maxlen}, (_,i)=> !!(oldState.revealed[i] || incomingState.revealed[i]));
      merged.revealed = mr;
    }
  } catch(_){}
  return merged;
}

export async function onRequestPost({ request, params, env }) {
  const code = (params.code || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }
  try {
    const body = await request.json();
    // Load existing for merge (KV or memory)
    let existing = null;
    if (env && env.AVALON_ROOMS) {
      const raw = await env.AVALON_ROOMS.get(`room:${code}`);
      if (raw) try{ existing = JSON.parse(raw); }catch(_){}
    } else {
      existing = MEM.get(code) || null;
    }
    // Merge players by name union
    let mergedPlayers = Array.isArray(body.players) ? body.players.slice(0,10) : null;
    if (existing && Array.isArray(existing.players) && mergedPlayers) {
      const seen = new Set(mergedPlayers.map(p=>p.name));
      for (const p of existing.players) {
        if (!seen.has(p.name) && mergedPlayers.length < 10) { mergedPlayers.push(p); seen.add(p.name); }
      }
    } else if (!mergedPlayers && existing && Array.isArray(existing.players)) {
      mergedPlayers = existing.players;
    } else if (!mergedPlayers) {
      mergedPlayers = [];
    }
    // Merge state
    let mergedState = body.state !== undefined ? body.state : (existing ? existing.state : null);
    if (existing && existing.state && body.state && existing.state.phase === body.state.phase) {
      mergedState = mergeStatesCf(existing.state, body.state);
    } else if (body.state === undefined && existing && existing.state) {
      mergedState = existing.state;
    }
    const room = {
      code,
      players: mergedPlayers,
      state: mergedState,
      hostId: body.hostId || (existing ? existing.hostId : null),
      createdAt: body.createdAt || (existing ? existing.createdAt : Date.now()),
      updatedAt: Date.now(),
    };
    if (env && env.AVALON_ROOMS) {
      await env.AVALON_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: 60 * 60 * 6 }); // 6h
    } else {
      MEM.set(code, room);
    }
    return new Response(JSON.stringify(room), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() });
  }
}
