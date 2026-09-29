import { Pool } from "pg";

// Connection pool: created once, reused, and closed on shutdown.
export const pool = new Pool({ max: 10, idleTimeoutMillis: 30_000 });

export async function withConnection<T>(fn: (c: import("pg").PoolClient) => Promise<T>) {
  const conn = await pool.connect();
  try {
    return await fn(conn);
  } finally {
    conn.release(); // return the database connection to the pool
  }
}

export async function closePool() {
  await pool.end();
}
