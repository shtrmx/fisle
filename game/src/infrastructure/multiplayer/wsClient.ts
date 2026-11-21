import type {
  ClientWsMessage,
  OnlineSessionCredentials,
  RoomHistoryResponse,
  RoomPreview,
  ServerStatusSummary,
  ServerWsMessage,
} from '@/domain/multiplayer/types';

const SESSION_STORAGE_KEY = 'antiyoy_online_session_v1';
const CLIENT_ID_STORAGE_KEY = 'fisle_client_id_v1';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateUuidV4(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type MessageListener = (msg: ServerWsMessage) => void;
type StatusListener = (connected: boolean) => void;

class MultiplayerWsClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private identityPromise: Promise<void> | null = null;
  private cachedClientId: string | null = null;
  private reconnectTimer = 0;
  private heartbeatTimer = 0;
  private healthcheckTimer = 0;
  private reconnectAttempts = 0;
  private shouldStayConnected = false;

  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  public getClientId(): string {
    if (this.cachedClientId) return this.cachedClientId;
    try {
      const saved = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
      if (saved && UUID_RE.test(saved)) {
        this.cachedClientId = saved;
        return saved;
      }
      const fresh = generateUuidV4();
      window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, fresh);
      this.cachedClientId = fresh;
      return fresh;
    } catch {
      const fallback = generateUuidV4();
      this.cachedClientId = fallback;
      return fallback;
    }
  }

  private getClientHeaders(
    extra?: Record<string, string>,
  ): Record<string, string> {
    return {
      'X-Fisle-Client-Id': this.getClientId(),
      ...extra,
    };
  }

  public startClientHealthcheck(): void {
    if (this.healthcheckTimer) return;
    this.healthcheckTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      void fetch('/api/health', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: this.getClientHeaders(),
      }).catch(() => {
        // Ignore transient offline errors
      });
    }, 25_000);
  }

  public ensurePlayerIdentity(): Promise<void> {
    this.startClientHealthcheck();
    if (!this.identityPromise) {
      this.identityPromise = fetch('/api/player/identity', {
        method: 'GET',
        credentials: 'same-origin',
        headers: this.getClientHeaders(),
      })
        .then(() => undefined)
        .catch(() => {
          this.identityPromise = null;
        });
    }
    return this.identityPromise;
  }

  public loadSavedSession(): OnlineSessionCredentials | null {
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<OnlineSessionCredentials>;
      if (
        typeof parsed.roomCode === 'string' &&
        typeof parsed.playerId === 'string' &&
        typeof parsed.nickname === 'string' &&
        typeof parsed.factionId === 'number'
      ) {
        return {
          roomCode: parsed.roomCode,
          roomName:
            typeof parsed.roomName === 'string' ? parsed.roomName : undefined,
          playerId: parsed.playerId,
          nickname: parsed.nickname,
          factionId: parsed.factionId,
          autoSaveSlot:
            typeof parsed.autoSaveSlot === 'number'
              ? parsed.autoSaveSlot
              : null,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  public saveSession(creds: OnlineSessionCredentials): void {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(creds));
    } catch {
      // Ignore storage quota errors
    }
  }

  public clearSession(): void {
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }

  public onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      listener(connected);
    }
  }

  private getWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const cid = encodeURIComponent(this.getClientId());
    return `${protocol}//${window.location.host}/ws?clientId=${cid}`;
  }

  public async connect(): Promise<void> {
    this.shouldStayConnected = true;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.ensurePlayerIdentity().then(
      () =>
        new Promise<void>((resolve, reject) => {
          try {
            const ws = new WebSocket(this.getWsUrl());
        this.socket = ws;

        ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.connectPromise = null;
          this.emitStatus(true);
          this.startHeartbeat();
          resolve();
        };

        ws.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          try {
            const parsed = JSON.parse(event.data) as ServerWsMessage;
            for (const listener of this.messageListeners) {
              listener(parsed);
            }
          } catch {
            // Ignore malformed messages
          }
        };

        ws.onclose = () => {
          this.stopHeartbeat();
          const wasCurrent = this.socket === ws;
          if (wasCurrent) {
            this.socket = null;
            this.connectPromise = null;
            this.emitStatus(false);
            if (this.shouldStayConnected) {
              this.scheduleReconnect();
            }
          }
        };

        ws.onerror = () => {
          if (this.connectPromise) {
            this.connectPromise = null;
            reject(new Error('Не удалось подключиться к серверу.'));
          }
        };
          } catch (err) {
            this.connectPromise = null;
            reject(err);
          }
        }),
    );

    return this.connectPromise;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.sendRaw({type: 'ping'});
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = 0;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const saved = this.loadSavedSession();
    if (!saved) return;

    const delayMs = Math.min(8000, 900 * Math.pow(1.6, this.reconnectAttempts));
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = 0;
      const latest = this.loadSavedSession();
      if (!latest || !this.shouldStayConnected) return;
      try {
        await this.connect();
        this.sendRaw({
          type: 'room:reconnect',
          code: latest.roomCode,
          playerId: latest.playerId,
        });
      } catch {
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  public disconnect(): void {
    this.shouldStayConnected = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore
      }
      this.socket = null;
    }
    this.connectPromise = null;
    this.emitStatus(false);
  }

  public sendRaw(msg: ClientWsMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  public async send(msg: ClientWsMessage): Promise<void> {
    await this.connect();
    this.sendRaw(msg);
  }

  public async fetchRoomPreview(code: string): Promise<RoomPreview> {
    const clean = code.trim().toUpperCase();
    const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}`, {
      credentials: 'same-origin',
      headers: this.getClientHeaders(),
    });
    if (!res.ok) {
      let errMsg = 'Комната не найдена.';
      try {
        const data = (await res.json()) as {error?: string};
        if (data.error) errMsg = data.error;
      } catch {
        // Fallback
      }
      throw new Error(errMsg);
    }
    return (await res.json()) as RoomPreview;
  }

  public async verifyRoomPassword(
    code: string,
    password: string,
  ): Promise<RoomPreview> {
    const clean = code.trim().toUpperCase();
    const res = await fetch(
      `/api/rooms/${encodeURIComponent(clean)}/verify-password`,
      {
        method: 'POST',
        headers: this.getClientHeaders({'Content-Type': 'application/json'}),
        credentials: 'same-origin',
        body: JSON.stringify({password}),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      preview?: RoomPreview;
    };
    if (!res.ok || !data.ok || !data.preview) {
      throw new Error(data.error || 'Неверный пароль комнаты.');
    }
    return data.preview;
  }

  public async fetchRoomHistory(): Promise<RoomHistoryResponse> {
    const res = await fetch('/api/rooms/history', {
      method: 'GET',
      credentials: 'same-origin',
      headers: this.getClientHeaders(),
    });
    if (!res.ok) {
      throw new Error('Не удалось загрузить историю партий.');
    }
    return (await res.json()) as RoomHistoryResponse;
  }

  public async fetchServerStatus(): Promise<ServerStatusSummary> {
    const res = await fetch('/api/status', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: this.getClientHeaders(),
    });
    if (!res.ok) {
      throw new Error('Сервер недоступен.');
    }
    return (await res.json()) as ServerStatusSummary;
  }
}

export const wsClient = new MultiplayerWsClient();
