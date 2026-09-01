import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

types.setTypeParser(types.builtins.INT8, BigInt);

const globalForDb = globalThis as { clippayPool?: Pool };

export function getPool(): Pool {
  if (globalForDb.clippayPool) return globalForDb.clippayPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });

  globalForDb.clippayPool = pool;
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}

export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class SqlParams {
  private readonly values: unknown[] = [];

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  toArray(): unknown[] {
    return this.values;
  }
}
