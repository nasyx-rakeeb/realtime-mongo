import { ClientMessage, ServerMessage, parseServerMessage } from '@realtimemongo/shared';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface ReconnectConfig {
  /** Initial reconnect delay in milliseconds. Default: 1000. */
  baseDelayMs?: number;
  /** Maximum reconnect delay in milliseconds. Default: 30000. */
  maxDelayMs?: number;
  /** Stop retrying after this many failed attempts. Default: Infinity. */
  maxAttempts?: number;
}

export interface ConnectionManagerOptions {
  url: string;
  WebSocketImpl?: any;
  reconnect?: ReconnectConfig;
  onOpen?: () => void;
  onMessage?: (msg: ServerMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
}

/**
 * Manages the WebSocket connection lifecycle for the client SDK.
 *
 * Reconnects automatically using **exponential backoff with full jitter**:
 * each delay is sampled uniformly from `[0, min(base * 2^attempt, max)]`.
 * Full jitter prevents thundering-herd reconnect storms when many clients
 * lose connectivity simultaneously.
 *
 * On reconnect, `onOpen` is called again, which triggers `flushAllSubscriptions`
 * in `RealtimeMongoClient` to re-send all active `sub` messages.
 *
 * The `intendedToClose` flag distinguishes a deliberate `client.close()` call
 * from an unexpected connection drop, suppressing reconnect in the former case.
 */
export class ConnectionManager {
  private ws: any | null = null;
  private readonly url: string;
  private readonly WebSocketImpl: any;

  private readonly onOpenCallback?: () => void;
  private readonly onMessageCallback?: (msg: ServerMessage) => void;
  private readonly onStateChangeCallback?: (state: ConnectionState) => void;

  private _state: ConnectionState = 'disconnected';
  private isConnecting = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intendedToClose = false;

  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;

  constructor(options: ConnectionManagerOptions) {
    this.url = options.url;
    this.WebSocketImpl = options.WebSocketImpl;
    this.onOpenCallback = options.onOpen;
    this.onMessageCallback = options.onMessage;
    this.onStateChangeCallback = options.onStateChange;

    const r = options.reconnect ?? {};
    this.baseDelayMs = r.baseDelayMs ?? 1000;
    this.maxDelayMs = r.maxDelayMs ?? 30_000;
    this.maxAttempts = r.maxAttempts ?? Infinity;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.onStateChangeCallback?.(state);
  }

  public get state(): ConnectionState {
    return this._state;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  /**
   * Resolves the WebSocket constructor. Falls back to `globalThis.WebSocket`
   * in browser environments when no explicit implementation is provided.
   */
  private getWebSocketImpl(): any {
    if (this.WebSocketImpl) return this.WebSocketImpl;
    if (typeof globalThis !== 'undefined' && (globalThis as any).WebSocket)
      return (globalThis as any).WebSocket;
    if (typeof window !== 'undefined' && window.WebSocket) return window.WebSocket;
    throw new Error(
      'No WebSocket implementation found. In Node.js, pass `WebSocketImpl: require("ws")` in the client options.'
    );
  }

  public connect(): void {
    if (this.ws?.readyState === 1 || this.isConnecting) return;
    this.intendedToClose = false;
    this.isConnecting = true;
    this.setState('connecting');

    let WS: any;
    try {
      WS = this.getWebSocketImpl();
    } catch (err) {
      console.error('[ConnectionManager] No WebSocket implementation available:', err);
      this.isConnecting = false;
      this.scheduleReconnect();
      return;
    }

    try {
      this.ws = new WS(this.url);
    } catch (err) {
      console.error('[ConnectionManager] Failed to open WebSocket:', err);
      this.isConnecting = false;
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.attempt = 0;
      this.setState('connected');
      this.onOpenCallback?.();
    };

    this.ws.onmessage = (event: any) => {
      try {
        const data = typeof event.data === 'string' ? event.data : event.data.toString();
        const msg = parseServerMessage(JSON.parse(data));
        this.onMessageCallback?.(msg);
      } catch (err) {
        console.warn('[ConnectionManager] Dropped unparseable server message:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      this.ws = null;
      if (this.intendedToClose) {
        this.setState('disconnected');
      } else {
        this.setState('reconnecting');
        this.scheduleReconnect();
      }
    };

    // Browser WebSocket fires onerror before onclose on connection failures.
    // The error payload contains no useful detail; onclose handles the reconnect.
    this.ws.onerror = () => {};
  }

  /** Schedules the next connection attempt using exponential backoff with full jitter. */
  private scheduleReconnect(): void {
    if (this.intendedToClose) return;
    if (this.attempt >= this.maxAttempts) {
      this.setState('disconnected');
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const cap = Math.min(this.baseDelayMs * Math.pow(2, this.attempt), this.maxDelayMs);
    const delay = Math.random() * cap;
    this.attempt++;

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  public send(msg: ClientMessage): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(msg));
    }
  }

  /** Closes the connection permanently and suppresses reconnect. */
  public close(): void {
    this.intendedToClose = true;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }
}
