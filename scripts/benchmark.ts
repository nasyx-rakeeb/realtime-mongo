/**
 * Benchmark script for @realtimemongo/server.
 *
 * Measures end-to-end latency from a MongoDB write to the client callback
 * firing under varying subscriber loads.
 *
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/?replicaSet=rs0 \
 *   npx tsx scripts/benchmark.ts [--subscribers=100] [--writes=50] [--port=9999]
 */

import { MongoClient } from 'mongodb';
import { createRealtimeMongo } from '../packages/server/src';
import { RealtimeMongoClient } from '../packages/client/src';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0';
const PORT = parseInt(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '9999');
const SUBSCRIBER_COUNT = parseInt(
  process.argv.find((a) => a.startsWith('--subscribers='))?.split('=')[1] ?? '100'
);
const WRITE_COUNT = parseInt(
  process.argv.find((a) => a.startsWith('--writes='))?.split('=')[1] ?? '50'
);

const DB = 'benchmark_db';
const COLL = 'bench_docs';
const DOC_ID_HEX = '64a1b2c3d4e5f6a7b8c9d0e1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n📊 realtime-mongo benchmark`);
  console.log(`   Subscribers : ${SUBSCRIBER_COUNT}`);
  console.log(`   Writes      : ${WRITE_COUNT}`);
  console.log(`   MongoDB     : ${MONGO_URI}\n`);

  // Start the realtime server
  const realtime = await createRealtimeMongo({
    mongoUri: MONGO_URI,
    collections: [`${DB}.${COLL}`],
    port: PORT,
  });

  // Seed the initial document
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const collection = mongo.db(DB).collection(COLL);
  await collection.deleteMany({});
  await collection.insertOne({ _id: DOC_ID_HEX as any, value: 0 });

  // Connect all subscribers
  const clients: RealtimeMongoClient[] = [];
  const latencies: number[] = [];
  let resolveWrite: (() => void) | null = null;
  let pendingReceipts = 0;
  let writeStartTime = 0;

  for (let i = 0; i < SUBSCRIBER_COUNT; i++) {
    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });
    clients.push(client);

    client
      .collection(COLL)
      .doc(DOC_ID_HEX)
      .onSnapshot(() => {
        if (writeStartTime === 0) return; // Ignore initial snapshot
        const latency = Date.now() - writeStartTime;
        latencies.push(latency);
        if (--pendingReceipts === 0) resolveWrite?.();
      });
  }

  // Allow time for all subscriptions to establish
  await new Promise((r) => setTimeout(r, 2000));

  // Run writes and measure latency
  for (let i = 0; i < WRITE_COUNT; i++) {
    pendingReceipts = SUBSCRIBER_COUNT;
    writeStartTime = Date.now();

    await collection.updateOne({ _id: DOC_ID_HEX as any }, { $set: { value: i + 1 } });

    await new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      setTimeout(() => reject(new Error(`Write ${i + 1} timed out after 10 s`)), 10_000);
    });

    process.stdout.write(`\r   Progress: ${i + 1}/${WRITE_COUNT}`);
  }

  // Report results
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  console.log(
    `\n\n📈 Results (${WRITE_COUNT} writes × ${SUBSCRIBER_COUNT} subscribers = ${latencies.length} samples)\n`
  );
  console.log(`   Min    : ${formatMs(sorted[0])}`);
  console.log(`   p50    : ${formatMs(percentile(sorted, 50))}`);
  console.log(`   p95    : ${formatMs(percentile(sorted, 95))}`);
  console.log(`   p99    : ${formatMs(percentile(sorted, 99))}`);
  console.log(`   Max    : ${formatMs(sorted[sorted.length - 1])}`);
  console.log(`   Avg    : ${formatMs(avg)}\n`);

  // Cleanup
  clients.forEach((c) => c.close());
  await mongo.close();
  await realtime.stop();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
