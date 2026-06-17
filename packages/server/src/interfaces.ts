import { ServerMessage, ClientMessage, VClock } from '@realtimemongo/shared';

export interface IConnection {
  readonly id: string;
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

export type ChangeEvent =
  | {
      type: 'update';
      db: string;
      coll: string;
      docId: string;
      doc: Record<string, any>;
      vclock: VClock;
    }
  | { type: 'delete'; db: string; coll: string; docId: string; vclock: VClock };

export interface IChangeSource {
  onChange(handler: (event: ChangeEvent) => void): void;
  fetchSnapshot(
    db: string,
    coll: string,
    docId: string
  ): Promise<{ doc: Record<string, any> | null; vclock: VClock }>;
  close(): Promise<void>;
}

export interface ITransportConnection extends IConnection {
  close(code?: number, reason?: string): void;
}

export type ConnectionHandler = (connection: ITransportConnection) => void;
export type MessageHandler = (connectionId: string, message: ClientMessage) => Promise<void>;
export type DisconnectHandler = (connectionId: string) => void;

export interface ITransportServer {
  onConnection(handler: ConnectionHandler): void;
  onMessage(handler: MessageHandler): void;
  onDisconnect(handler: DisconnectHandler): void;
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
}

export interface ISubscriptionManager {
  subscribe(connectionId: string, db: string, coll: string, docId: string): void;
  unsubscribe(connectionId: string, db: string, coll: string, docId: string): void;
  unsubscribeAll(connectionId: string): void;
  getSubscribers(db: string, coll: string, docId: string): ReadonlySet<string>;
}

export interface IConnectionManager {
  addConnection(connection: IConnection): void;
  removeConnection(connectionId: string): void;
  handleMessage(connectionId: string, message: ClientMessage): Promise<void>;
  sendTo(connectionId: string, message: ServerMessage): void;
  closeAll(): void;
}

export interface IChangeStreamManager {
  start(): void;
  stop(): void;
}
