/**
 * Load test for @realtimemongo/server.
 *
 * Simulates a high-concurrency scenario: many connections, each subscribing
 * to random documents, with continuous writes. Reports connection success rate,
 * message delivery rate, and server memory usage.
 *
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/?replicaSet=rs0 \
 *   npx tsx scripts/load-test.ts [--connections=500] [--docs=20] [--duration=30] [--port=9998]
 */

import { MongoClient } from 'mongodb';
import WebSocket from 'ws';
import { createRealtimeMongo } from '../packages/server/src';
import { PROTOCOL_VERSION } from '../packages/shared/src';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0';
const PORT = parseInt(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '9998');
const CONNECTIONS = parseInt(
  process.argv.find((a) => a.startsWith('--connections='))?.split('=')[1] ?? '500'
);
const DOC_COUNT = parseInt(
  process.argv.find((a) => a.startsWith('--docs='))?.split('=')[1] ?? '20'
);
const DURATION_S = parseInt(
  process.argv.find((a) => a.startsWith('--duration='))?.split('=')[1] ?? '30'
);

const DB = 'loadtest_db';
const COLL = 'load_docs';

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

let connected = 0;
let disconnected = 0;
let messagesReceived = 0;
let errors = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomDocId(docIds: string[]): string {
  return docIds[Math.floor(Math.random() * docIds.length)];
}

function makeSubMessage(docId: string): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    id: `sub_${docId}`,
    t: 'sub',
    p: { db: DB, coll: COLL, id: docId },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n🔥 realtime-mongo load test`);
  console.log(`   Connections : ${CONNECTIONS}`);
  console.log(`   Documents   : ${DOC_COUNT}`);
  console.log(`   Duration    : ${DURATION_S}s`);
  console.log(`   MongoDB     : ${MONGO_URI}\n`);

  // Start server
  const realtime = await createRealtimeMongo({
    mongoUri: MONGO_URI,
    collections: [`${DB}.${COLL}`],
    port: PORT,
    transport: { maxConnections: CONNECTIONS + 50 },
  });

  // Seed documents
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const coll = mongo.db(DB).collection(COLL);
  await coll.deleteMany({});
  const docIds: string[] = [];
  for (let i = 0; i < DOC_COUNT; i++) {
    const id = `doc_${i.toString().padStart(4, '0')}`;
    await coll.insertOne({ _id: id as any, counter: 0 });
    docIds.push(id);
  }

  // Open all connections
  const sockets: WebSocket[] = [];
  for (let i = 0; i < CONNECTIONS; i++) {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    sockets.push(ws);

    ws.on('open', () => {
      connected++;
      ws.send(makeSubMessage(randomDocId(docIds)));
    });

    ws.on('message', () => {
      messagesReceived++;
    });
    ws.on('close', () => {
      disconnected++;
    });
    ws.on('error', () => {
      errors++;
    });
  }

  // Continuous writer: update random documents every 100ms
  const writeInterval = setInterval(async () => {
    const docId = randomDocId(docIds);
    await coll.updateOne({ _id: docId as any }, { $inc: { counter: 1 } });
  }, 100);

  // Progress reporting every 5s
  const startMem = process.memoryUsage().heapUsed;
  const reportInterval = setInterval(() => {
    const mem = process.memoryUsage().heapUsed;
    const memDeltaMB = ((mem - startMem) / 1024 / 1024).toFixed(1);
    console.log(
      `   ⏱  connected=${connected} disconnected=${disconnected} ` +
        `msgs=${messagesReceived} errors=${errors} Δmem=+${memDeltaMB}MB`
    );
  }, 5000);

  // Run for the configured duration
  await new Promise((r) => setTimeout(r, DURATION_S * 1000));

  clearInterval(writeInterval);
  clearInterval(reportInterval);

  // Final report
  const endMem = process.memoryUsage().heapUsed;
  const memDeltaMB = ((endMem - startMem) / 1024 / 1024).toFixed(1);

  console.log(`\n📊 Final results after ${DURATION_S}s\n`);
  console.log(`   Connections opened      : ${connected}`);
  console.log(`   Connections still open  : ${connected - disconnected}`);
  console.log(`   Messages received       : ${messagesReceived}`);
  console.log(`   WebSocket errors        : ${errors}`);
  console.log(`   Heap growth             : +${memDeltaMB} MB\n`);

  // Cleanup
  sockets.forEach((ws) => ws.close());
  await mongo.close();
  await realtime.stop();
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
