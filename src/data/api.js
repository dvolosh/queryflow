/**
 * QueryFlow — API client for the local ChinookDB backend.
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
 * Fetch the full schema of every Chinook table.
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
 * @returns {Promise<object>} The final result payload.
 */
export function sendChatMessage(message, context, onStep, history = []) {
  return new Promise(async (resolve, reject) => {
    let res;

    // Slim history: keep last 8 messages, strip large rows payloads
    const slimHistory = history.slice(-8).map(m => ({
      id:      m.id,
      role:    m.role,
      type:    m.type,
      content: m.content,
      ...(m.sql       ? { sql: m.sql }             : {}),
      // Include vizJson so the server can feed it to the VizModifier
      ...(m.vizJson   ? { vizJson: m.vizJson }     : {}),
      ...(m.tableData ? { tableData: {
        columns:  m.tableData.columns,
        rowCount: m.tableData.rowCount,
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
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

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

        if (event === 'step')        onStep?.(parsed.label);
        else if (event === 'result') resolve(parsed);
        else if (event === 'error')  reject(new Error(parsed.message));
      }
    }

    async function pump() {
      try {
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

// ── Stateful Viz Adjustment API ───────────────────────────────────────────────

/**
 * Apply a natural-language style tweak to the current chart config.
 * Calls POST /api/adjust-viz and returns the updated chartConfig.
 *
 * The server guarantees that datasets[].data values are never mutated.
 *
 * @param {object} currentVizJson  - The current Chart.js config JSON.
 * @param {string} tweak           - The user's natural-language style tweak.
 * @returns {Promise<object>}      - The updated chartConfig.
 */
export async function adjustViz(currentVizJson, tweak) {
  const res = await fetch(`${BASE}/adjust-viz`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ currentVizJson, tweak }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Viz adjust failed: ${res.status}`);
  return data.chartConfig;
}

// ── Conversation CRUD API ─────────────────────────────────────────────────────

/** Fetch all conversations, newest first. */
export async function getConversations() {
  try {
    const res = await fetch(`${BASE}/conversations`);
    if (!res.ok) return [];
    return res.json();
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
      // Spread all rich fields (sql, tableData, chartConfig, vizJson, clarificationOptions…)
      ...(row.payload ? JSON.parse(row.payload) : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * Persist a single message to a conversation (INSERT).
 * Non-base fields (sql, tableData, chartConfig, vizJson, clarificationOptions, originalQuestion)
 * are packed into the `payload` JSON column.
 *
 * @param {string} convId
 * @param {object} message  — a message object from App.jsx state
 */
export async function saveMessage(convId, message) {
  const { id, role, type, content, timestamp } = message;

  // vizJson is persisted so that the Viz Modifier can pick it up
  // from history when the conversation is reloaded.
  //
  // tableData.rows are NOT persisted — they can be thousands of raw rows
  // (e.g. a boxplot with 3503 entries) and would cause PayloadTooLargeError.
  // The chart is fully encoded in vizJson; we only keep the metadata fields
  // (columns, rowCount, elapsed) so the stats pill renders correctly on reload.
  const PAYLOAD_KEYS = [
    'sql', 'tableData', 'chartConfig', 'vizJson',
    'clarificationOptions', 'originalQuestion',
  ];
  const payload = {};
  for (const key of PAYLOAD_KEYS) {
    if (message[key] === undefined) continue;
    if (key === 'tableData' && message.tableData) {
      // Strip raw rows — keep only the lightweight metadata
      payload.tableData = {
        columns:  message.tableData.columns,
        rowCount: message.tableData.rowCount ?? message.tableData.rows?.length ?? 0,
        elapsed:  message.tableData.elapsed,
        rows:     [],   // empty — chart data lives in vizJson
      };
    } else {
      payload[key] = message[key];
    }
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


/**
 * Update the payload of an EXISTING message row (used after viz tweaks).
 * Only the `payload` column (vizJson, chartConfig, sql, tableData, etc.) is
 * overwritten — the base fields (role, type, content) stay untouched.
 *
 * @param {string} convId
 * @param {object} message  — message object with the updated fields
 */
export async function updateMessage(convId, message) {
  const PAYLOAD_KEYS = [
    'sql', 'tableData', 'chartConfig', 'vizJson',
    'clarificationOptions', 'originalQuestion',
  ];
  const payload = {};
  for (const key of PAYLOAD_KEYS) {
    if (message[key] === undefined) continue;
    if (key === 'tableData' && message.tableData) {
      payload.tableData = {
        columns:  message.tableData.columns,
        rowCount: message.tableData.rowCount ?? message.tableData.rows?.length ?? 0,
        elapsed:  message.tableData.elapsed,
        rows:     [],
      };
    } else {
      payload[key] = message[key];
    }
  }

  await fetch(`${BASE}/conversations/${convId}/messages/${message.id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      payload: Object.keys(payload).length > 0 ? payload : null,
    }),
  });
}


