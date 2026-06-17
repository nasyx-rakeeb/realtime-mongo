import { MongoChangeSource } from './mongo/MongoChangeSource';
import { SubscriptionManager } from './managers/SubscriptionManager';
import { ConnectionManager } from './managers/ConnectionManager';
import { ChangeStreamManager } from './managers/ChangeStreamManager';
import { WebSocketTransportServer, TransportConfig } from './transport/WebSocketTransportServer';

export interface RealtimeMongoConfig {
  mongoUri: string;
  collections: string[];
  port: number;
  transport?: Omit<TransportConfig, 'port'>;
}

export interface RealtimeMongoInstance {
  mongoSource: MongoChangeSource;
  transportServer: WebSocketTransportServer;
  subscriptionManager: SubscriptionManager;
  connectionManager: ConnectionManager;
  streamManager: ChangeStreamManager;
  stop(): Promise<void>;
}

/**
 * Creates and wires all @realtimemongo/server components together.
 *
 * @example
 * ```ts
 * const realtime = await createRealtimeMongo({
 *   mongoUri: process.env.MONGO_URI!,
 *   collections: ['mydb.users', 'mydb.posts'],
 *   port: 8080,
 * });
 * process.on('SIGTERM', () => realtime.stop());
 * ```
 */
export async function createRealtimeMongo(
  config: RealtimeMongoConfig
): Promise<RealtimeMongoInstance> {
  const mongoSource = new MongoChangeSource(config.mongoUri);
  await mongoSource.connect();

  for (const entry of config.collections) {
    const dotIndex = entry.indexOf('.');
    if (dotIndex === -1) {
      throw new Error(`Invalid collection format: "${entry}". Expected "dbName.collectionName".`);
    }
    mongoSource.registerCollection(entry.slice(0, dotIndex), entry.slice(dotIndex + 1));
  }

  const subscriptionManager = new SubscriptionManager();
  const connectionManager = new ConnectionManager(subscriptionManager, mongoSource);
  const streamManager = new ChangeStreamManager(
    mongoSource,
    subscriptionManager,
    connectionManager
  );
  streamManager.start();

  const transportServer = new WebSocketTransportServer({ ...config.transport, port: config.port });
  transportServer.onConnection((conn) => connectionManager.addConnection(conn));
  transportServer.onMessage((id, msg) => connectionManager.handleMessage(id, msg));
  transportServer.onDisconnect((id) => connectionManager.removeConnection(id));
  await transportServer.start();

  return {
    mongoSource,
    transportServer,
    subscriptionManager,
    connectionManager,
    streamManager,
    async stop() {
      await transportServer.stop();
      streamManager.stop();
      connectionManager.closeAll();
      await mongoSource.close();
    },
  };
}
