/**
 * QueryFlow — API client for the local InsightsDB backend.
 * All queries are read-only SELECTs executed via the Express server at /api.
 */

const BASE = '/api';

// ── Direct query API ──────────────────────────────────────────────────────────

/**
 * Execute a SELECT query against the local SQLite database.
 * @param {string} sql
 * @returns {Promise<{ columns: string[], rows: any[][], rowCount: number }>}
 */
export async function queryDB(sql) {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Query failed: ${res.status}`);
  return data;
}

/**
 * Fetch the full schema of every table in InsightsDB.
 * @returns {Promise<Array<{ table: string, columns: Array<{ name, type, pk, notnull }> }>>}
 */
export async function getSchema() {
  const res = await fetch(`${BASE}/tables`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Schema fetch failed: ${res.status}`);
  return data;
}

/** Simple health check — resolves true if the backend is reachable. */
export async function isBackendHealthy() {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Multi-agent chat API ──────────────────────────────────────────────────────

/**
 * Send a message through the multi-agent pipeline via SSE.
 *
 * @param {string}   message   - User's natural language question.
 * @param {string|null} context - Optional clarification context (chip selection).
 * @param {(label: string) => void} onStep - Called on each progress step event.
 * @param {object[]}  history   - Recent conversation messages for context.
 * @returns {Promise<object>} The final result payload:
 *   { type: 'ambiguity', message, options }
 *   { type: 'data_block', sql, tableData, chartConfig, summary }
 */
export function sendChatMessage(message, context, onStep, history = []) {
  return new Promise(async (resolve, reject) => {
    let res;

    // Slim history: keep last 8 messages, strip tableData.rows (re-run server-side)
    const slimHistory = history.slice(-8).map(m => ({
      id:      m.id,
      role:    m.role,
      type:    m.type,
      content: m.content,
      // Keep sql for revisualize; strip bulky rows
      ...(m.sql       ? { sql: m.sql }             : {}),
      ...(m.tableData ? { tableData: {
        columns:  m.tableData.columns,
        rowCount: m.tableData.rowCount,
        // rows intentionally omitted — server re-executes SQL
      }} : {}),
    }));

    try {
      res = await fetch(`${BASE}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message, context, history: slimHistory }),
      });
    } catch (err) {
      return reject(new Error(`Network error: ${err.message}`));
    }

    if (!res.ok || !res.body) {
      return reject(new Error(`Chat request failed with status ${res.status}`));
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    function processBuffer() {
      // SSE messages are separated by double newlines
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep any incomplete trailing chunk

      for (const part of parts) {
        let event = 'message';
        let data  = '';

        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data = line.slice(6).trim();
        }

        if (!data) continue;

        let parsed;
        try { parsed = JSON.parse(data); }
        catch { continue; }

        if (event === 'step')   onStep?.(parsed.label);
        else if (event === 'result') resolve(parsed);
        else if (event === 'error')  reject(new Error(parsed.message));
      }
    }

    async function pump() {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }
      } catch (err) {
        reject(err);
      }
    }

    pump();
  });
}

// ── Conversation CRUD API ─────────────────────────────────────────────────────

/** Fetch all conversations, newest first. */
export async function getConversations() {
  try {
    const res = await fetch(`${BASE}/conversations`);
    if (!res.ok) return [];
    return res.json(); // [{ id, title, created_at, updated_at }]
  } catch {
    return [];
  }
}

/**
 * Create a new conversation record.
 * @param {{ id: string, title: string }} conv
 */
export async function createConversation({ id, title }) {
  const res = await fetch(`${BASE}/conversations`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id, title }),
  });
  return res.json();
}

/**
 * Rename an existing conversation.
 * @param {string} convId
 * @param {string} title
 */
export async function renameConversation(convId, title) {
  await fetch(`${BASE}/conversations/${convId}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title }),
  });
}

/** Permanently delete a conversation and all its messages. */
export async function deleteConversation(convId) {
  await fetch(`${BASE}/conversations/${convId}`, { method: 'DELETE' });
}

/**
 * Load all messages for a conversation, reconstructing rich message objects.
 * The `payload` column stores JSON for extra fields (sql, tableData, etc.).
 *
 * @param {string} convId
 * @returns {Promise<object[]>}
 */
export async function loadConversationMessages(convId) {
  try {
    const res = await fetch(`${BASE}/conversations/${convId}/messages`);
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(row => ({
      id:        row.id,
      role:      row.role,
      type:      row.type,
      content:   row.content,
      timestamp: new Date(row.created_at),
      // Spread all rich fields (sql, tableData, chartConfig, clarificationOptions…)
      ...(row.payload ? JSON.parse(row.payload) : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * Persist a single message to a conversation.
 * Non-base fields (sql, tableData, chartConfig, clarificationOptions, originalQuestion)
 * are packed into the `payload` JSON column.
 *
 * @param {string} convId
 * @param {object} message  — a message object from App.jsx state
 */
export async function saveMessage(convId, message) {
  const { id, role, type, content, timestamp } = message;

  const PAYLOAD_KEYS = ['sql', 'tableData', 'chartConfig', 'clarificationOptions', 'originalQuestion'];
  const payload = {};
  for (const key of PAYLOAD_KEYS) {
    if (message[key] !== undefined) payload[key] = message[key];
  }

  await fetch(`${BASE}/conversations/${convId}/messages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      id,
      role,
      type,
      content,
      payload:    Object.keys(payload).length > 0 ? payload : null,
      created_at: timestamp?.getTime() ?? Date.now(),
    }),
  });
}
