import express from 'express';
import cors from 'cors';
import db from './db.js';
import {
  ANALYST_SYSTEM,
  buildDBManagerSystem,
  buildVisualizerSystem,
  callOllama,
} from './agents.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', db: 'InsightsDB' });
});

// ── Schema introspection ──────────────────────────────────────────────────────
// Returns each table with its columns so the AI agent knows what it can query
app.get('/api/tables', (_req, res) => {
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map(({ name }) => {
        const columns = db.pragma(`table_info(${name})`).map((col) => ({
          name: col.name,
          type: col.type,
          pk: col.pk === 1,
          notnull: col.notnull === 1,
        }));
        return { table: name, columns };
      });
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Read-only query execution ─────────────────────────────────────────────────
// Accepts ?sql=SELECT ... via GET, or { sql } via POST body
// Only SELECT statements are permitted.
function runQuery(sql, res) {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    return res.status(403).json({
      error: 'Only SELECT (and WITH) queries are allowed. This database is read-only.',
    });
  }
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    // Extract column names from the first row's keys (or from stmt.columns())
    const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
    res.json({ columns, rows: rows.map((r) => columns.map((c) => r[c])), rowCount: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET  /api/query?sql=SELECT+*+FROM+Customers
app.get('/api/query', (req, res) => {
  const { sql } = req.query;
  if (!sql) return res.status(400).json({ error: 'Missing ?sql= query parameter.' });
  runQuery(sql, res);
});

// POST /api/query  { "sql": "SELECT ..." }
app.post('/api/query', (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing sql field in request body.' });
  runQuery(sql, res);
});

// ── Conversation history routes ────────────────────────────────────────────────

// GET /api/conversations — list all, newest first
app.get('/api/conversations', (_req, res) => {
  try {
    const rows = db
      .prepare(`SELECT id, title, created_at, updated_at
                FROM Conversations
                ORDER BY updated_at DESC`)
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations — create a new conversation
app.post('/api/conversations', (req, res) => {
  const { id, title } = req.body ?? {};
  if (!id || !title?.trim()) {
    return res.status(400).json({ error: 'Missing id or title.' });
  }
  try {
    const now = Date.now();
    db.prepare(
      `INSERT INTO Conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
    ).run(id, title.trim(), now, now);
    res.json({ id, title: title.trim(), created_at: now, updated_at: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/conversations/:id — rename
app.patch('/api/conversations/:id', (req, res) => {
  const { title } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'Missing title.' });
  try {
    db.prepare(
      `UPDATE Conversations SET title = ?, updated_at = ? WHERE id = ?`
    ).run(title.trim(), Date.now(), req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/conversations/:id — deletes conversation + messages (CASCADE)
app.delete('/api/conversations/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM Conversations WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:id/messages — load all messages ordered oldest → newest
app.get('/api/conversations/:id/messages', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, role, type, content, payload, created_at
         FROM ConversationMessages
         WHERE conversation_id = ?
         ORDER BY created_at ASC`
      )
      .all(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/messages — append a message
const appendMessage = db.transaction((convId, id, role, type, content, payloadStr, createdAt) => {
  db.prepare(
    `INSERT INTO ConversationMessages
     (id, conversation_id, role, type, content, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, convId, role, type, content, payloadStr, createdAt);
  // Keep updated_at current so sidebar ordering stays correct
  db.prepare(
    `UPDATE Conversations SET updated_at = ? WHERE id = ?`
  ).run(Date.now(), convId);
});

app.post('/api/conversations/:id/messages', (req, res) => {
  const { id, role, type, content, payload, created_at } = req.body ?? {};
  if (!id || !role || !type || content === undefined) {
    return res.status(400).json({ error: 'Missing required message fields.' });
  }
  try {
    appendMessage(
      req.params.id,
      id,
      role,
      type,
      content,
      payload != null ? JSON.stringify(payload) : null,
      created_at ?? Date.now(),
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SSE helper ───────────────────────────────────────────────────────────────
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Schema loader (shared by /api/chat) ──────────────────────────────────────
function loadSchema() {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map(({ name }) => {
      const columns = db.pragma(`table_info(${name})`).map((col) => ({
        name: col.name,
        type: col.type,
        pk: col.pk === 1,
      }));
      return { table: name, columns };
    });
}

// ── Multi-agent chat endpoint ─────────────────────────────────────────────────
// POST /api/chat  { "message": "...", "context": "...", "history": [...] }
// Streams SSE events:
//   event: step   data: { label: "..." }                    — progress updates
//   event: result data: { type: "ambiguity"|"data_block"|"text", ... }  — final payload
//   event: error  data: { message: "..." }                  — pipeline failure
app.post('/api/chat', async (req, res) => {
  const { message, context, history = [] } = req.body ?? {};
  if (!message?.trim()) {
    return res.status(400).json({ error: 'Missing message field.' });
  }

  // Open SSE stream
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // ── Build a compact conversation-history string for agent context ────────────────────
  // We include recent turns so the Analyst can understand follow-ups
  // ("now filter to Electronics", "show as pie", etc.)
  function buildHistoryContext() {
    if (!history.length) return '';
    const turns = history.slice(-6).map(m => {
      const role  = m.role === 'user' ? '[user]' : '[assistant]';
      const body  = m.type === 'data_block'
        ? `Ran SQL: ${(m.sql ?? '').slice(0, 200)}${m.tableData ? ` (${m.tableData.rowCount} rows, cols: ${m.tableData.columns?.join(', ')})` : ''}`
        : (m.content ?? '').slice(0, 150);
      return `${role}: ${body}`;
    });
    return `\n\nConversation history (most recent last):\n${turns.join('\n')}`;
  }

  // Find the most recent data_block in history (for revisualize)
  const lastDataBlock = [...history].reverse().find(m => m.type === 'data_block');

  try {
    // ── Agent 1: The Analyst ───────────────────────────────────────────────────
    sseWrite(res, 'step', { label: '🔍 Analyst — evaluating intent...' });

    const userContent =
      (context ? `${message}\n\nUser clarification selected: ${context}` : message)
      + buildHistoryContext();

    const analystResult = await callOllama(ANALYST_SYSTEM, userContent);

    // If ambiguous → return chips immediately, done
    if (analystResult.type === 'ambiguity') {
      sseWrite(res, 'result', {
        type:    'ambiguity',
        message: analystResult.message,
        options: analystResult.options,
      });
      res.end();
      return;
    }

    // If vague retry ("try again") → return a friendly prompt to rephrase
    if (analystResult.type === 'error_followup') {
      sseWrite(res, 'result', {
        type:    'text',
        summary: analystResult.message ??
          "I'm not sure what to retry. Could you rephrase your original question?",
      });
      res.end();
      return;
    }

    // If re-visualization request → re-execute the last known SQL from history,
    // then ask the Visualizer to produce a different chart type.
    if (analystResult.type === 'revisualize') {
      const reSql = lastDataBlock?.sql ?? null;

      if (!reSql) {
        sseWrite(res, 'result', {
          type:    'text',
          summary: "I don't have a previous query to re-chart. Please ask a data question first.",
        });
        res.end();
        return;
      }

      sseWrite(res, 'step', { label: '📊 Visualizer — redesigning chart...' });

      // Re-execute the SQL to get fresh data
      let reRows, reColumns;
      try {
        const stmt = db.prepare(reSql);
        reRows    = stmt.all();
        reColumns = reRows.length > 0
          ? Object.keys(reRows[0])
          : stmt.columns().map(c => c.name);
      } catch (sqlErr) {
        throw new Error(`Re-execution of previous SQL failed: ${sqlErr.message}`);
      }

      const reTableData = {
        columns:  reColumns,
        rows:     reRows.map(r => reColumns.map(c => r[c])),
        rowCount: reRows.length,
        elapsed:  0,
      };

      const hint   = analystResult.chartHint ? ` Prefer a different chart type: ${analystResult.chartHint}.` : ' Use a different chart type than the one previously shown.';
      const vizSys = buildVisualizerSystem(reColumns, reTableData.rows);
      const vizRes = await callOllama(
        vizSys,
        `Columns: ${reColumns.join(', ')}\nAll rows (${reRows.length} total): ` +
        `${JSON.stringify(reTableData.rows)}${hint}`,
      );

      if (!vizRes.chartConfig) throw new Error('Visualizer did not return a chartConfig.');

      sseWrite(res, 'step',   { label: '✅ Rendering results...' });
      sseWrite(res, 'result', {
        type:        'data_block',
        sql:         reSql,
        tableData:   reTableData,
        chartConfig: vizRes.chartConfig,
        summary:     vizRes.summary ?? '',
      });
      res.end();
      return;
    }

    if (analystResult.type !== 'clear' || !analystResult.refinedIntent) {
      throw new Error('Analyst returned an unexpected response structure.');
    }

    const { refinedIntent } = analystResult;

    // ── Agent 2: The Database Manager ────────────────────────────────────────
    sseWrite(res, 'step', { label: '🗄️  DB Manager — writing SQL...' });

    const schema    = loadSchema();
    const dbSystem  = buildDBManagerSystem(schema);
    // Give the DB Manager previous SQL as context for coherent follow-up queries
    const prevSql   = lastDataBlock?.sql ? `\n\nPrevious query for context:\n${lastDataBlock.sql}` : '';
    const dbResult  = await callOllama(dbSystem, `Data intent: ${refinedIntent}${prevSql}`);

    if (!dbResult.sql) {
      throw new Error('DB Manager did not return a SQL query.');
    }

    const sql        = dbResult.sql.trim();
    const sqlNorm    = sql.toUpperCase();
    if (!sqlNorm.startsWith('SELECT') && !sqlNorm.startsWith('WITH')) {
      throw new Error('DB Manager produced a non-SELECT statement — blocked for safety.');
    }

    // ── Execute the SQL ───────────────────────────────────────────────────────
    sseWrite(res, 'step', { label: '⚙️  Executing query against InsightsDB...' });

    let rows, columns, elapsed;
    try {
      const t0   = Date.now();
      const stmt = db.prepare(sql);
      rows      = stmt.all();
      elapsed   = Date.now() - t0;
      columns   = rows.length > 0
        ? Object.keys(rows[0])
        : stmt.columns().map((c) => c.name);
    } catch (sqlErr) {
      // Surface a readable SQL error instead of a raw pipeline crash
      throw new Error(
        `The generated SQL query failed: ${sqlErr.message}. ` +
        `Try rephrasing your question with more specific criteria.`
      );
    }

    const tableData = {
      columns,
      rows:     rows.map((r) => columns.map((c) => r[c])),
      rowCount: rows.length,
      elapsed,
    };

    // ── Agent 3: The Visualizer ───────────────────────────────────────────────
    sseWrite(res, 'step', { label: '📊 Visualizer — designing chart...' });

    const vizSystem  = buildVisualizerSystem(columns, tableData.rows);
    const vizResult  = await callOllama(
      vizSystem,
      `Columns: ${columns.join(', ')}\nAll rows (${rows.length} total): ${JSON.stringify(tableData.rows)}`,
    );

    if (!vizResult.chartConfig) {
      throw new Error('Visualizer did not return a chartConfig object.');
    }

    // ── Final result ──────────────────────────────────────────────────────────
    sseWrite(res, 'step',   { label: '✅ Rendering results...' });
    sseWrite(res, 'result', {
      type:        'data_block',
      sql,
      tableData,
      chartConfig: vizResult.chartConfig,
      summary:     vizResult.summary ?? '',
    });

    res.end();
  } catch (err) {
    console.error('[Chat] Pipeline error:', err.message);
    sseWrite(res, 'error', { message: err.message });
    res.end();
  }
});


// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] QueryFlow API running at http://localhost:${PORT}`);
  console.log(`[Server] Endpoints: /api/health  /api/tables  /api/query  /api/chat`);
});
