#!/usr/bin/env python3
"""Avalon server — static + real room sync API for cross-device play"""
import http.server, socketserver, mimetypes, sys, pathlib, json, urllib.parse

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('text/html', '.html')

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DIR = pathlib.Path(__file__).parent

# In-memory rooms: code -> {code, players, state, createdAt, updatedAt, hostId}
ROOMS = {}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def guess_type(self, path):
        if path.split('?')[0].endswith('.js'):
            return 'application/javascript'
        if path.split('?')[0].endswith('.css'):
            return 'text/css'
        return super().guess_type(path)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/api/room/'):
            code = parsed.path.split('/')[-1].upper()
            if len(code)==4 and code.isalpha():
                room = ROOMS.get(code)
                if room:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(room).encode())
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error":"Room not found"}).encode())
                return
            else:
                self.send_response(400)
                self.end_headers()
                return
        if parsed.path == '/api/rooms':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(list(ROOMS.keys())).encode())
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/api/room/'):
            code = parsed.path.split('/')[-1].upper()
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b'{}'
            try:
                data = json.loads(body.decode() or '{}')
            except:
                data = {}
            existing = ROOMS.get(code, {})
            # Merge players — handle kicks (incoming smaller) vs adds (union) — use id if available
            incoming_players = data.get("players", None)
            existing_players = existing.get("players", [])
            if incoming_players is not None:
                incoming_ids = {p.get("id") for p in incoming_players if p.get("id")}
                incoming_names = {p.get("name") for p in incoming_players if p.get("name")}
                existing_ids = {p.get("id") for p in existing_players if p.get("id")}
                missing_ids = [p.get("id") for p in existing_players if p.get("id") and p.get("id") not in incoming_ids]
                extra_ids = [p.get("id") for p in incoming_players if p.get("id") and p.get("id") not in existing_ids]
                if len(incoming_players) < len(existing_players) and missing_ids and not extra_ids:
                    # Likely a kick — incoming authoritative
                    merged_players = incoming_players[:10]
                else:
                    merged_players = list(incoming_players)
                    seen_ids = set(incoming_ids)
                    seen_names = set(incoming_names)
                    for p in existing_players:
                        pid = p.get("id")
                        if pid:
                            if pid not in seen_ids:
                                merged_players.append(p)
                                seen_ids.add(pid)
                        else:
                            if p.get("name") not in seen_names:
                                merged_players.append(p)
                                seen_names.add(p.get("name"))
                    merged_players = merged_players[:10]
            else:
                merged_players = existing_players
            # Merge state: if same phase, union votes & revealed to avoid losing concurrent submissions
            incoming_state = data.get("state", None)
            existing_state = existing.get("state", None)
            merged_state = incoming_state if incoming_state is not None else existing_state
            if existing_state and incoming_state and existing_state.get("phase") == incoming_state.get("phase"):
                try:
                    ms = dict(incoming_state)
                    # Merge proposal.votes
                    ep = existing_state.get("proposal", {})
                    ip = incoming_state.get("proposal", {})
                    if ep.get("votes") or ip.get("votes"):
                        mv = {}
                        if ep.get("votes"): mv.update(ep["votes"])
                        if ip.get("votes"): mv.update(ip["votes"])
                        ms["proposal"] = dict(ip) if ip else dict(ep)
                        ms["proposal"]["votes"] = mv
                    # Merge questVotes
                    eqv = existing_state.get("questVotes", {})
                    iqv = incoming_state.get("questVotes", {})
                    if eqv or iqv:
                        mv = {}
                        mv.update(eqv)
                        mv.update(iqv)
                        ms["questVotes"] = mv
                    # Merge revealed (OR)
                    er = existing_state.get("revealed")
                    ir = incoming_state.get("revealed")
                    if isinstance(er, list) and isinstance(ir, list):
                        maxlen = max(len(er), len(ir))
                        mr = [False]*maxlen
                        for i in range(maxlen):
                            ev = er[i] if i < len(er) else False
                            iv = ir[i] if i < len(ir) else False
                            mr[i] = bool(ev or iv)
                        ms["revealed"] = mr
                    merged_state = ms
                except Exception as e:
                    print(f"[merge] error {e}")
                    merged_state = incoming_state
            elif incoming_state is None and existing_state is not None:
                merged_state = existing_state
            # Merge extraRoles / gameId / gameOptions — host is source of truth; incoming wins if present
            incoming_extra = data.get("extraRoles", None)
            existing_extra = existing.get("extraRoles", None)
            merged_extra = incoming_extra if incoming_extra is not None else existing_extra
            incoming_gameId = data.get("gameId", None)
            existing_gameId = existing.get("gameId", None)
            merged_gameId = incoming_gameId if incoming_gameId is not None else existing_gameId
            incoming_gameOptions = data.get("gameOptions", None)
            existing_gameOptions = existing.get("gameOptions", None)
            merged_gameOptions = incoming_gameOptions if incoming_gameOptions is not None else existing_gameOptions
            room = {
                "code": code,
                "players": merged_players,
                "state": merged_state,
                "hostId": data.get("hostId", existing.get("hostId", None)),
                "gameId": merged_gameId,
                "gameOptions": merged_gameOptions,
                "extraRoles": merged_extra,
                "createdAt": existing.get("createdAt", data.get("createdAt", 0)) or __import__('time').time()*1000,
                "updatedAt": __import__('time').time()*1000,
            }
            ROOMS[code] = room
            print(f"POST {code} stored {list(ROOMS.keys())} room {room.get('players')}", flush=True)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(room).encode())
            return
        self.send_response(404)
        self.end_headers()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/api/room/'):
            code = parsed.path.split('/')[-1].upper()
            if code in ROOMS:
                del ROOMS[code]
                print(f"DELETE {code} remaining {list(ROOMS.keys())}", flush=True)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "code": code}).encode())
            return
        self.send_response(404)
        self.end_headers()

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Serving Avalon at http://0.0.0.0:{PORT}  (also http://localhost:{PORT})")
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        print(f"On your phones (same WiFi): http://{ip}:{PORT}")
        print(f"API: http://{ip}:{PORT}/api/room/EQKH")
    except: pass
    print("Press Ctrl+C to stop")
    httpd.serve_forever()
