/**
 * QueryFlow — lightweight API client for the local InsightsDB backend.
 * All queries are read-only SELECTs executed via the Express server at /api.
 */

const BASE = '/api';

/**
 * Execute a SELECT query against the local SQLite database.
 *
 * @param {string} sql - A SELECT (or WITH …) SQL statement.
 * @returns {Promise<{ columns: string[], rows: any[][], rowCount: number }>}
 */
export async function queryDB(sql) {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? `Query failed with status ${res.status}`);
  }

  return data; // { columns, rows, rowCount }
}

/**
 * Fetch the full schema of every table in InsightsDB.
 * Useful for giving the AI agent context on what it can query.
 *
 * @returns {Promise<Array<{ table: string, columns: Array<{ name, type, pk, notnull }> }>>}
 */
export async function getSchema() {
  const res = await fetch(`${BASE}/tables`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? `Schema fetch failed with status ${res.status}`);
  }

  return data;
}

/**
 * Simple health check — resolves true if the backend is reachable.
 *
 * @returns {Promise<boolean>}
 */
export async function isBackendHealthy() {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
