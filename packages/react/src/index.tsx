import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import {
  RealtimeMongoClient,
  RealtimeMongoClientOptions,
  ConnectionState,
} from '@realtimemongo/client';

// ─── Context ─────────────────────────────────────────────────────────────────

const RealtimeMongoContext = createContext<RealtimeMongoClient | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface RealtimeMongoProviderProps extends RealtimeMongoClientOptions {
  children: ReactNode;
}

/**
 * Provides a shared `RealtimeMongoClient` instance to the component tree.
 *
 * Place this near the root of your app. All `useDocument` and
 * `useConnectionState` calls inside it will share the same WebSocket
 * connection.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <RealtimeMongoProvider url="ws://localhost:8080" db="mydb">
 *       <Dashboard />
 *     </RealtimeMongoProvider>
 *   );
 * }
 * ```
 */
export function RealtimeMongoProvider({
  children,
  ...clientOptions
}: RealtimeMongoProviderProps): JSX.Element {
  // The client is created once via ref to avoid re-instantiation on every render.
  const clientRef = useRef<RealtimeMongoClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new RealtimeMongoClient(clientOptions);
  }

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  return (
    <RealtimeMongoContext.Provider value={clientRef.current}>
      {children}
    </RealtimeMongoContext.Provider>
  );
}

// ─── useRealtimeMongoClient ───────────────────────────────────────────────────

/**
 * Returns the shared `RealtimeMongoClient` instance from the nearest
 * `<RealtimeMongoProvider>`.
 *
 * @throws If called outside a `<RealtimeMongoProvider>`.
 */
export function useRealtimeMongoClient(): RealtimeMongoClient {
  const client = useContext(RealtimeMongoContext);
  if (!client) {
    throw new Error('useRealtimeMongoClient() must be used inside a <RealtimeMongoProvider>.');
  }
  return client;
}

// ─── useDocument ─────────────────────────────────────────────────────────────

export interface UseDocumentResult<TDoc> {
  /** The current document data, or `null` if deleted/not found. */
  data: TDoc | null;
  /** `true` while waiting for the first snapshot from the server. */
  loading: boolean;
  /** Non-null if a subscription error occurred (e.g. auth failure). */
  error: Error | null;
}

/**
 * Subscribes to a document in real-time. Re-renders the component whenever
 * the document is created, updated, or deleted.
 *
 * @param collection - The collection name.
 * @param docId - The document ID.
 * @returns `{ data, loading, error }`
 *
 * @example
 * ```tsx
 * interface Task { title: string; done: boolean; }
 *
 * function TaskView({ taskId }: { taskId: string }) {
 *   const { data, loading, error } = useDocument<Task>('tasks', taskId);
 *
 *   if (loading) return <p>Loading…</p>;
 *   if (error) return <p>Error: {error.message}</p>;
 *   if (!data) return <p>Task not found</p>;
 *
 *   return <h1>{data.title} {data.done ? '✅' : '⏳'}</h1>;
 * }
 * ```
 */
export function useDocument<TDoc = Record<string, any>>(
  collection: string,
  docId: string
): UseDocumentResult<TDoc> {
  const client = useRealtimeMongoClient();

  const [data, setData] = useState<TDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);

    const unsubscribe = client
      .collection<TDoc>(collection)
      .doc(docId)
      .onSnapshot(
        (doc) => {
          setData(doc);
          setLoading(false);
          setError(null);
        },
        (err) => {
          setError(err);
          setLoading(false);
        }
      );

    return unsubscribe;
  }, [client, collection, docId]);

  return { data, loading, error };
}

// ─── useDocumentFromDb ────────────────────────────────────────────────────────

/**
 * Like `useDocument`, but targets a specific database. Use this in
 * multi-database setups.
 *
 * @param db - The database name.
 * @param collection - The collection name.
 * @param docId - The document ID.
 *
 * @example
 * ```tsx
 * const { data } = useDocumentFromDb('analytics', 'metrics', metricId);
 * ```
 */
export function useDocumentFromDb<TDoc = Record<string, any>>(
  db: string,
  collection: string,
  docId: string
): UseDocumentResult<TDoc> {
  const client = useRealtimeMongoClient();

  const [data, setData] = useState<TDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);

    const unsubscribe = client
      .db(db)
      .collection<TDoc>(collection)
      .doc(docId)
      .onSnapshot(
        (doc) => {
          setData(doc);
          setLoading(false);
          setError(null);
        },
        (err) => {
          setError(err);
          setLoading(false);
        }
      );

    return unsubscribe;
  }, [client, db, collection, docId]);

  return { data, loading, error };
}

// ─── useConnectionState ───────────────────────────────────────────────────────

/**
 * Returns the current WebSocket connection state of the shared client.
 *
 * Possible values: `'connecting'` | `'connected'` | `'disconnected'` | `'reconnecting'`
 *
 * @example
 * ```tsx
 * function ConnectionBadge() {
 *   const state = useConnectionState();
 *   return <span data-state={state}>{state}</span>;
 * }
 * ```
 */
export function useConnectionState(): ConnectionState {
  const client = useRealtimeMongoClient();
  const [state, setState] = useState<ConnectionState>(client.connectionState);

  useEffect(() => {
    setState(client.connectionState);
    const unsubscribe = client.onConnectionStateChange(setState);
    return unsubscribe;
  }, [client]);

  return state;
}
