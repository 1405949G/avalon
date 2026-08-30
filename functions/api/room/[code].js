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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
    // Merge players — handle kicks vs adds — use id if available
    let mergedPlayers = Array.isArray(body.players) ? body.players.slice(0,10) : null;
    if (existing && Array.isArray(existing.players) && mergedPlayers) {
      const incomingIds = new Set(mergedPlayers.map(p=>p.id).filter(Boolean));
      const existingIds = new Set(existing.players.map(p=>p.id).filter(Boolean));
      const missingIds = existing.players.filter(p=> p.id && !incomingIds.has(p.id)).map(p=>p.id);
      const extraIds = mergedPlayers.filter(p=> p.id && !existingIds.has(p.id)).map(p=>p.id);
      if (mergedPlayers.length < existing.players.length && missingIds.length && extraIds.length===0) {
        // Kick — incoming authoritative
      } else {
        const seenIds = new Set(mergedPlayers.map(p=>p.id).filter(Boolean));
        const seenNames = new Set(mergedPlayers.map(p=>p.name));
        for (const p of existing.players) {
          if (p.id) {
            if (!seenIds.has(p.id) && mergedPlayers.length < 10) { mergedPlayers.push(p); seenIds.add(p.id); }
          } else {
            if (!seenNames.has(p.name) && mergedPlayers.length < 10) { mergedPlayers.push(p); seenNames.add(p.name); }
          }
        }
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
    // Merge extraRoles / gameId / gameOptions — host is source of truth; incoming wins if present
    let mergedExtra = null;
    if (body.extraRoles !== undefined) mergedExtra = body.extraRoles;
    else if (existing && existing.extraRoles !== undefined) mergedExtra = existing.extraRoles;
    let mergedGameId = null;
    if (body.gameId !== undefined) mergedGameId = body.gameId;
    else if (existing && existing.gameId !== undefined) mergedGameId = existing.gameId;
    let mergedGameOptions = null;
    if (body.gameOptions !== undefined) mergedGameOptions = body.gameOptions;
    else if (existing && existing.gameOptions !== undefined) mergedGameOptions = existing.gameOptions;
    const room = {
      code,
      players: mergedPlayers,
      state: mergedState,
      hostId: body.hostId || (existing ? existing.hostId : null),
      gameId: mergedGameId,
      gameOptions: mergedGameOptions,
      extraRoles: mergedExtra,
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

export async function onRequestDelete({ params, env }) {
  const code = (params.code || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }
  try {
    if (env && env.AVALON_ROOMS) {
      await env.AVALON_ROOMS.delete(`room:${code}`);
    } else {
      MEM.delete(code);
    }
    return new Response(JSON.stringify({ ok: true, code }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders() });
  }
}
