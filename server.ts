import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import express, {type Request, type Response} from 'express';
import {WebSocketServer} from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_DEV = process.env.DEV_SERVER === '1';
const PLAYER_COOKIE_NAME = 'fisle_player_id';
const CLIENT_ID_HEADER = 'x-fisle-client-id';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseClientHeaderId(req: Request): string | null {
  const raw = req.headers[CLIENT_ID_HEADER];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (typeof val === 'string' && UUID_RE.test(val.trim())) {
    return val.trim();
  }
  return null;
}

function parseWsQueryClientId(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const val = parsed.searchParams.get('clientId')?.trim();
    if (val && UUID_RE.test(val)) {
      return val;
    }
  } catch {
    // Ignore malformed query string
  }
  return null;
}

function parsePlayerCookieId(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== PLAYER_COOKIE_NAME) continue;
    const val = decodeURIComponent(part.slice(eq + 1).trim());
    if (UUID_RE.test(val)) {
      return val;
    }
  }
  return null;
}

function resolveExistingClientId(req: Request): string | null {
  return parseClientHeaderId(req) ?? parsePlayerCookieId(req.headers.cookie);
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https';
}

function setPlayerCookie(req: Request, res: Response, id: string): void {
  const attrs = isHttpsRequest(req)
    ? `${PLAYER_COOKIE_NAME}=${id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None; Partitioned`
    : `${PLAYER_COOKIE_NAME}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
  res.append('Set-Cookie', attrs);
}

function ensurePlayerCookie(req: Request, res: Response): string {
  const headerId = parseClientHeaderId(req);
  const cookieId = parsePlayerCookieId(req.headers.cookie);
  if (headerId) {
    if (cookieId !== headerId) {
      setPlayerCookie(req, res, headerId);
    }
    return headerId;
  }
  if (cookieId) {
    return cookieId;
  }
  const id = crypto.randomUUID();
  setPlayerCookie(req, res, id);
  return id;
}

async function loadRoomManagerClass() {
  const bundledPath = path.resolve(__dirname, 'dist', 'roomManager.mjs');
  if (!IS_DEV && fs.existsSync(bundledPath)) {
    const mod = await import(pathToFileURL(bundledPath).href);
    return mod.RoomManager;
  }
  const sourcePath = path.resolve(__dirname, 'server', 'roomManager.ts');
  const mod = await import(pathToFileURL(sourcePath).href);
  return mod.RoomManager;
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  // Automatically issue persistent player ID cookie on first page visit or API request
  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      (req.path === '/' ||
        req.path === '/index.html' ||
        req.path.startsWith('/api/'))
    ) {
      ensurePlayerCookie(req, res);
    }
    next();
  });

  const RoomManagerClass = await loadRoomManagerClass();
  const roomManager = new RoomManagerClass();

  app.get('/api/player/identity', (req, res) => {
    ensurePlayerCookie(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ready: true});
  });

  app.get('/api/rooms/history', (req, res) => {
    const cookieId = ensurePlayerCookie(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.json(roomManager.getPlayerRoomHistory(cookieId));
  });

  // REST endpoint for previewing a room before joining (available colors, slots, status)
  app.get('/api/rooms/:code', (req, res) => {
    const preview = roomManager.getRoomPreview(req.params.code);
    if (!preview) {
      res.status(404).json({error: 'Комната не найдена.'});
      return;
    }
    res.json(preview);
  });

  // REST endpoint for verifying room password before character selection step
  app.post('/api/rooms/:code/verify-password', (req, res) => {
    const rawPassword =
      typeof req.body?.password === 'string' ? req.body.password : '';
    const result = roomManager.verifyRoomPassword(req.params.code, rawPassword);
    if (!result.ok) {
      res
        .status(result.statusCode ?? 401)
        .json({ok: false, error: result.error ?? 'Неверный пароль комнаты.'});
      return;
    }
    res.json({ok: true, preview: result.preview});
  });

  app.get('/api/status', (req, res) => {
    const clientId = resolveExistingClientId(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(roomManager.getServerStatus(clientId));
  });

  app.get('/api/health', (req, res) => {
    const clientId = resolveExistingClientId(req);
    if (clientId) {
      roomManager.recordClientHeartbeat(clientId);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ok: true});
  });

  const server = http.createServer(app);

  // Authoritative WebSocket endpoint for online multiplayer rooms
  const wss = new WebSocketServer({
    server,
    path: '/ws',
  });

  wss.on('connection', (ws, req) => {
    const clientId =
      parseWsQueryClientId(req.url) ?? parsePlayerCookieId(req.headers.cookie);
    roomManager.attachSocketCookie(ws, clientId);

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      roomManager.handleMessage(ws, raw);
    });

    ws.on('close', () => {
      roomManager.detachSocket(ws);
      roomManager.handleDisconnect(ws);
    });

    ws.on('error', () => {
      roomManager.detachSocket(ws);
      roomManager.handleDisconnect(ws);
    });
  });

  if (IS_DEV) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      ensurePlayerCookie(req, res);
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
