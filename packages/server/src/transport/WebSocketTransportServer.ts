import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import {
  ServerMessage,
  ClientMessage,
  parseClientMessage,
  createErrorMessage,
  ErrorCodes,
} from '@realtimemongo/shared';
import {
  ITransportServer,
  ITransportConnection,
  ConnectionHandler,
  MessageHandler,
  DisconnectHandler,
} from '../interfaces';
import { TokenBucket, RateLimitConfig, DEFAULT_RATE_LIMIT_CONFIG } from './RateLimiter';

/**
 * Authentication configuration for `WebSocketTransportServer`.
 *
 * When provided, the server enforces a first-message auth pattern:
 * the client must send `{ t: "auth", p: { token } }` as its first message.
 * All subsequent messages are processed normally. Connections that fail
 * authentication or time out are closed with WebSocket code `1008`.
 */
export interface AuthConfig {
  /**
   * Validates an auth token. Return a principal string on success.
   * Throw any error to reject the connection.
   */
  verify: (token: string) => Promise<string> | string;
  /**
   * Called before each subscription is created. Return `false` to deny.
   * When omitted, all subscriptions from authenticated connections are allowed.
   */
  canSubscribe?: (
    principal: string,
    db: string,
    coll: string,
    docId: string
  ) => Promise<boolean> | boolean;
  /** Milliseconds to wait for an auth message before closing the connection. Default: 5000. */
  timeoutMs?: number;
}

/** Configuration for `WebSocketTransportServer`. */
export interface TransportConfig {
  port: number;
  /** Maximum message size in bytes. Default: 65536 (64 KB). */
  maxPayload?: number;
  /** Per-connection rate limit. Default: 30 messages per second. */
  rateLimit?: RateLimitConfig;
  /** Connections exceeding this violation count are closed. Default: 5. */
  maxViolations?: number;
  /** Connections with a send buffer exceeding this are closed. Default: 1 MB. */
  maxBufferedBytes?: number;
  /** Server-wide connection cap. Excess connections are rejected. */
  maxConnections?: number;
  /** Per-connection subscription cap. Default: 200. */
  maxSubscriptionsPerConnection?: number;
  /**
   * Allowed WebSocket origins. Set to `'*'` to allow all origins.
   * Restricting origins prevents Cross-Site WebSocket Hijacking (CSWSH).
   */
  allowedOrigins?: string[] | '*';
  /** When set, authentication is required on every connection. */
  auth?: AuthConfig;
}

const DEFAULT_MAX_PAYLOAD = 64 * 1024;
const DEFAULT_MAX_VIOLATIONS = 5;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_MAX_SUBSCRIPTIONS = 200;
const DEFAULT_AUTH_TIMEOUT_MS = 5000;

class WebSocketConnection implements ITransportConnection {
  public violationCount = 0;
  public rateLimiter: TokenBucket;
  public isAlive = true;
  public subscriptionCount = 0;
  public principal: string | null = null;
  public isAuthenticated: boolean;

  constructor(
    public readonly id: string,
    public readonly ws: WebSocket,
    rateLimitConfig: RateLimitConfig,
    private readonly maxBufferedBytes: number,
    public readonly maxSubscriptions: number,
    requiresAuth: boolean
  ) {
    this.rateLimiter = new TokenBucket(rateLimitConfig);
    this.isAuthenticated = !requiresAuth;
  }

  public send(message: ServerMessage): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > this.maxBufferedBytes) {
      this.close(1008, 'Backpressure limit exceeded');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  public ping(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.ping();
  }

  public close(code = 1000, reason?: string): void {
    this.ws.close(code, reason);
  }
}

/**
 * Network boundary for the realtime-mongo server.
 *
 * Responsibilities:
 * - Origin validation (CSWSH prevention via `allowedOrigins`)
 * - Maximum connection enforcement
 * - Per-connection rate limiting via Token Bucket algorithm
 * - Transport-layer authentication (first-message auth with configurable timeout)
 * - Per-subscription authorization via `auth.canSubscribe`
 * - Per-connection subscription count enforcement
 * - Heartbeat via WebSocket ping/pong (30 s interval, dead connection cleanup)
 * - Backpressure detection via `bufferedAmount` threshold
 *
 * Parsed, validated messages are forwarded to the registered `onMessage` handler.
 * Invalid or over-quota messages are rejected at this layer and never reach the
 * application logic in `ConnectionManager`.
 */
export class WebSocketTransportServer implements ITransportServer {
  private wss: WebSocketServer | null = null;
  private onConnectionHandler?: ConnectionHandler;
  private onMessageHandler?: MessageHandler;
  private onDisconnectHandler?: DisconnectHandler;
  private pingInterval: NodeJS.Timeout | null = null;
  private connections = new Map<string, WebSocketConnection>();

  private readonly maxPayload: number;
  private readonly rateLimitConfig: RateLimitConfig;
  private readonly maxViolations: number;
  private readonly maxBufferedBytes: number;
  private readonly maxConnections: number | null;
  private readonly maxSubscriptionsPerConnection: number;
  private readonly allowedOrigins: string[] | '*';
  private readonly authConfig: AuthConfig | null;

  constructor(private config: TransportConfig) {
    this.maxPayload = config.maxPayload ?? DEFAULT_MAX_PAYLOAD;
    this.rateLimitConfig = config.rateLimit ?? DEFAULT_RATE_LIMIT_CONFIG;
    this.maxViolations = config.maxViolations ?? DEFAULT_MAX_VIOLATIONS;
    this.maxBufferedBytes = config.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.maxConnections = config.maxConnections ?? null;
    this.maxSubscriptionsPerConnection =
      config.maxSubscriptionsPerConnection ?? DEFAULT_MAX_SUBSCRIPTIONS;
    this.allowedOrigins = config.allowedOrigins ?? '*';
    this.authConfig = config.auth ?? null;
  }

  public onConnection(handler: ConnectionHandler): void {
    this.onConnectionHandler = handler;
  }
  public onMessage(handler: MessageHandler): void {
    this.onMessageHandler = handler;
  }
  public onDisconnect(handler: DisconnectHandler): void {
    this.onDisconnectHandler = handler;
  }

  public start(port?: number): Promise<void> {
    const listenPort = port ?? this.config.port;
    return new Promise((resolve) => {
      this.wss = new WebSocketServer(
        {
          port: listenPort,
          maxPayload: this.maxPayload,
          verifyClient: (info: { origin: string; req: IncomingMessage }) => {
            if (this.maxConnections !== null && this.connections.size >= this.maxConnections)
              return false;
            if (this.allowedOrigins !== '*') {
              if (info.origin && !(this.allowedOrigins as string[]).includes(info.origin))
                return false;
            }
            return true;
          },
        },
        () => {
          this.startHeartbeat();
          resolve();
        }
      );

      this.wss.on('connection', (ws) => {
        const id = randomUUID();
        const connection = new WebSocketConnection(
          id,
          ws,
          this.rateLimitConfig,
          this.maxBufferedBytes,
          this.maxSubscriptionsPerConnection,
          !!this.authConfig
        );
        this.connections.set(id, connection);

        let authTimer: NodeJS.Timeout | null = null;
        if (this.authConfig) {
          const timeoutMs = this.authConfig.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
          authTimer = setTimeout(() => {
            if (!connection.isAuthenticated) {
              connection.send(
                createErrorMessage(
                  'auth_timeout',
                  ErrorCodes.AUTH_REQUIRED,
                  'Authentication timeout'
                )
              );
              connection.close(1008, 'Authentication timeout');
            }
          }, timeoutMs);
        }

        ws.on('pong', () => {
          connection.isAlive = true;
        });

        ws.on('message', async (data, isBinary) => {
          if (isBinary) {
            this.handleViolation(connection, 'Binary frames are not supported', 'unknown');
            return;
          }

          if (!connection.rateLimiter.tryConsume()) {
            connection.send(
              createErrorMessage(
                'rate_limit',
                ErrorCodes.RATE_LIMIT_EXCEEDED,
                'Rate limit exceeded'
              )
            );
            return;
          }

          let json: unknown;
          try {
            json = JSON.parse(data.toString());
          } catch {
            this.handleViolation(connection, 'Invalid JSON', 'unknown');
            return;
          }

          const reqId =
            typeof json === 'object' &&
            json !== null &&
            'id' in json &&
            typeof (json as any).id === 'string'
              ? (json as any).id
              : 'unknown';

          let clientMessage: ClientMessage;
          try {
            clientMessage = parseClientMessage(json);
          } catch (err: any) {
            this.handleViolation(connection, err.message, reqId);
            return;
          }

          if (this.authConfig) {
            if (!connection.isAuthenticated) {
              if (clientMessage.t !== 'auth') {
                connection.send(
                  createErrorMessage(reqId, ErrorCodes.AUTH_REQUIRED, 'Send an auth message first')
                );
                return;
              }
              try {
                connection.principal = await this.authConfig.verify(clientMessage.p.token);
                connection.isAuthenticated = true;
                if (authTimer) clearTimeout(authTimer);
              } catch {
                connection.send(
                  createErrorMessage(reqId, ErrorCodes.AUTH_FAILED, 'Authentication failed')
                );
                connection.close(1008, 'Authentication failed');
              }
              return;
            }

            if (clientMessage.t === 'sub' && this.authConfig.canSubscribe) {
              const { db, coll, id: docId } = clientMessage.p;
              try {
                const allowed = await this.authConfig.canSubscribe(
                  connection.principal!,
                  db,
                  coll,
                  docId
                );
                if (!allowed) {
                  connection.send(
                    createErrorMessage(
                      reqId,
                      ErrorCodes.AUTH_FAILED,
                      `Not authorized to subscribe to ${db}.${coll}.${docId}`
                    )
                  );
                  return;
                }
              } catch {
                connection.send(
                  createErrorMessage(reqId, ErrorCodes.SERVER_ERROR, 'Authorization check failed')
                );
                return;
              }
            }
          }

          if (clientMessage.t === 'sub') {
            if (connection.subscriptionCount >= connection.maxSubscriptions) {
              connection.send(
                createErrorMessage(
                  reqId,
                  ErrorCodes.SUBSCRIPTION_LIMIT_EXCEEDED,
                  `Subscription limit of ${connection.maxSubscriptions} reached`
                )
              );
              return;
            }
            connection.subscriptionCount++;
          } else if (clientMessage.t === 'unsub') {
            connection.subscriptionCount = Math.max(0, connection.subscriptionCount - 1);
          }

          if (this.onMessageHandler) await this.onMessageHandler(connection.id, clientMessage);
        });

        ws.on('close', () => {
          if (authTimer) clearTimeout(authTimer);
          this.connections.delete(id);
          this.onDisconnectHandler?.(id);
        });

        ws.on('error', () => {});

        this.onConnectionHandler?.(connection);
      });
    });
  }

  private handleViolation(conn: WebSocketConnection, reason: string, reqId: string): void {
    conn.violationCount++;
    conn.send(createErrorMessage(reqId, ErrorCodes.INVALID_MESSAGE, reason));
    if (conn.violationCount > this.maxViolations) conn.close(1008, 'Too many invalid payloads');
  }

  /**
   * Sends a WebSocket ping to every open connection every 30 seconds.
   * Connections that do not respond with a pong before the next interval
   * are presumed dead and closed.
   */
  private startHeartbeat(): void {
    this.pingInterval = setInterval(() => {
      this.connections.forEach((conn, id) => {
        if (!conn.isAlive) {
          conn.close(1000, 'Heartbeat timeout');
          this.connections.delete(id);
          this.onDisconnectHandler?.(id);
          return;
        }
        conn.isAlive = false;
        conn.ping();
      });
    }, 30_000);
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.connections.forEach((c) => c.close(1001, 'Server shutting down'));
      this.connections.clear();
      if (this.wss) {
        const ref = this.wss;
        this.wss = null;
        ref.close((err) => (err ? reject(err) : resolve()));
      } else {
        resolve();
      }
    });
  }
}
