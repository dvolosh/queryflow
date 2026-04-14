import express from 'express';
import cors from 'cors';
import db from './db.js';
import {
  ANALYST_SYSTEM,
  buildDBManagerSystem,
  buildVisualizerSystem,
  buildVizModifierSystem,
  applyGatekeeper,
  callOllama,
} from './agents.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', db: 'ChinookDB' });
});

// ── Schema introspection ──────────────────────────────────────────────────────
// Returns each table with its columns so the AI agent knows what it can query.
// Excludes internal chat-history tables from the AI's view of the schema.
const CHAT_TABLES = new Set(['Conversations', 'ConversationMessages']);

app.get('/api/tables', (_req, res) => {
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .filter(({ name }) => !CHAT_TABLES.has(name))
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
function runQuery(sql, res) {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    return res.status(403).json({
      error: 'Only SELECT (and WITH) queries are allowed. This database is read-only.',
    });
  }
  try {
    const stmt    = db.prepare(sql);
    const rows    = stmt.all();
    const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
    res.json({ columns, rows: rows.map((r) => columns.map((c) => r[c])), rowCount: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

app.get('/api/query', (req, res) => {
  const { sql } = req.query;
  if (!sql) return res.status(400).json({ error: 'Missing ?sql= query parameter.' });
  runQuery(sql, res);
});

app.post('/api/query', (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing sql field in request body.' });
  runQuery(sql, res);
});

// ── Conversation history routes ────────────────────────────────────────────────

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

app.delete('/api/conversations/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM Conversations WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

const appendMessage = db.transaction((convId, id, role, type, content, payloadStr, createdAt) => {
  db.prepare(
    `INSERT INTO ConversationMessages
     (id, conversation_id, role, type, content, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, convId, role, type, content, payloadStr, createdAt);
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

// ── Update an existing message's payload (e.g. after a viz tweak) ──────────────
// PUT /api/conversations/:convId/messages/:msgId
// Body: { payload: {...} }  — only payload is updated; role/type/content are immutable
app.put('/api/conversations/:convId/messages/:msgId', (req, res) => {
  const { payload } = req.body ?? {};
  try {
    const info = db.prepare(
      `UPDATE ConversationMessages
          SET payload = ?
        WHERE id = ? AND conversation_id = ?`
    ).run(
      payload != null ? JSON.stringify(payload) : null,
      req.params.msgId,
      req.params.convId,
    );
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Message not found.' });
    }
    db.prepare(`UPDATE Conversations SET updated_at = ? WHERE id = ?`)
      .run(Date.now(), req.params.convId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stateful Viz Adjustment Loop ──────────────────────────────────────────────
// POST /api/adjust-viz
// Body: { currentVizJson: {...chartConfig...}, tweak: "Make the bars red" }
// Returns: { chartConfig: {...} }
//
// This agent ONLY modifies style/config keys. It is strictly forbidden from
// changing datasets[].data values. We validate that contract after the LLM call.
app.post('/api/adjust-viz', async (req, res) => {
  const { currentVizJson, tweak } = req.body ?? {};

  if (!currentVizJson || !tweak?.trim()) {
    return res.status(400).json({ error: 'Missing currentVizJson or tweak.' });
  }

  try {
    const modifierSystem = buildVizModifierSystem(currentVizJson);
    const result = await callOllama(
      modifierSystem,
      `Apply this style tweak to the chart: "${tweak.trim()}"`,
    );

    // Validate: make sure the model didn't mutate the data arrays
    const originalDatasets = currentVizJson.datasets ?? [];
    const returnedDatasets  = result.datasets ?? [];

    for (let i = 0; i < originalDatasets.length; i++) {
      const orig = JSON.stringify(originalDatasets[i]?.data ?? []);
      const ret  = JSON.stringify(returnedDatasets[i]?.data  ?? []);
      if (orig !== ret) {
        console.warn(
          `[AdjustViz] Model mutated data on dataset ${i} — restoring original data.`
        );
        if (result.datasets?.[i]) {
          result.datasets[i].data = originalDatasets[i].data;
        }
      }
    }

    // Also preserve labels if the model changed them
    if (currentVizJson.labels && JSON.stringify(result.labels) !== JSON.stringify(currentVizJson.labels)) {
      console.warn('[AdjustViz] Model mutated labels — restoring original labels.');
      result.labels = currentVizJson.labels;
    }

    res.json({ chartConfig: result });

  } catch (err) {
    console.error('[AdjustViz] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Server-side scatter data normaliser ──────────────────────────────────────
/**
 * The Visualizer LLM often generates flat arrays even when told to produce {x,y}
 * pairs for scatter charts (small models like gemma4 struggle with format changes).
 *
 * This function deterministically rebuilds scatter data from the raw SQL rows,
 * picking the first two numeric columns as X and Y. It runs AFTER the Visualizer
 * to guarantee correctness regardless of what the model output.
 *
 * For non-scatter charts it is a no-op.
 */
function fixScatterData(chartConfig, columns, rawRows) {
  if (chartConfig?.type !== 'scatter') return chartConfig;

  const ds = chartConfig.datasets ?? [];

  // If data is already correct {x,y} pairs, nothing to do
  const firstPoint = ds[0]?.data?.[0];
  if (firstPoint && typeof firstPoint === 'object' && 'x' in firstPoint) {
    console.log('[ScatterFix] Data already in {x,y} format — no conversion needed.');
    return chartConfig;
  }

  // Columns whose names look like database identifiers are not useful scatter axes.
  // Prefer to skip them; only fall back to them if there aren't 2 real metric columns.
  const ID_RE = /(?:^|_)id$/i;           // TrackId, AlbumId, track_id, id, …
  const isIdCol = name => ID_RE.test(name);

  const isNumericCol = i =>
    rawRows.slice(0, 5).some(row => typeof row[i] === 'number');

  // First pass: non-ID numeric columns
  let picked = columns
    .map((name, i) => ({ name, i }))
    .filter(({ name, i }) => !isIdCol(name) && isNumericCol(i));

  // Fallback: any numeric column (including IDs) if we still don't have 2
  if (picked.length < 2) {
    picked = columns
      .map((name, i) => ({ name, i }))
      .filter(({ i }) => isNumericCol(i));
  }

  if (picked.length < 2) {
    console.warn('[ScatterFix] Fewer than 2 usable numeric columns — falling back to bar.');
    return { ...chartConfig, type: 'bar' };
  }

  const [{ name: xCol, i: xIdx }, { name: yCol, i: yIdx }] = picked;

  // Humanise a column name alias: "TotalQuantitySold" → "Total Quantity Sold"
  const humanise = s => s
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();

  const xyData = rawRows.map(row => ({ x: row[xIdx], y: row[yIdx] }));
  console.log(`[ScatterFix] Built {x,y} from "${xCol}" (x) and "${yCol}" (y) — ${xyData.length} points`);

  const baseColor  = ds[0]?.backgroundColor ?? ds[0]?.borderColor ?? '#6366f1';
  const solidColor = typeof baseColor === 'string' ? baseColor : '#6366f1';

  return {
    ...chartConfig,
    labels:     [],
    xAxisLabel: chartConfig.xAxisLabel ?? humanise(xCol),
    yAxisLabel: chartConfig.yAxisLabel ?? humanise(yCol),
    datasets: [{
      label:           `${humanise(xCol)} vs ${humanise(yCol)}`,
      data:            xyData,
      backgroundColor: solidColor + 'cc',
      borderColor:     solidColor,
    }],
  };
}

// ── Server-side categorical chart trimmer ────────────────────────────────────
/**
 * When a bar or line chart has too many category labels, the chart becomes
 * unreadable. This post-processor automatically keeps only the top N entries,
 * sorted by the primary dataset (first dataset) in descending order.
 *
 * For scatter / pie / doughnut, this is a no-op.
 */
const CATEGORICAL_MAX = 10;
function trimCategoricalData(chartConfig) {
  const type = chartConfig?.type;
  if (!['bar', 'line'].includes(type)) return chartConfig;

  const labels = chartConfig.labels ?? [];
  if (labels.length <= CATEGORICAL_MAX) return chartConfig;

  const ds      = chartConfig.datasets ?? [];
  const primary = ds[0]?.data ?? [];

  // Sort indices by first dataset descending, keep top N
  const indices = labels
    .map((_, i) => i)
    .sort((a, b) => (Number(primary[b]) || 0) - (Number(primary[a]) || 0))
    .slice(0, CATEGORICAL_MAX);

  console.log(`[TrimCategories] Trimmed ${labels.length} → ${CATEGORICAL_MAX} labels`);

  return {
    ...chartConfig,
    title:    chartConfig.title ? `${chartConfig.title} (Top ${CATEGORICAL_MAX})` : chartConfig.title,
    labels:   indices.map(i => labels[i]),
    datasets: ds.map(d => ({
      ...d,
      data: Array.isArray(d.data)
        ? indices.map(i => d.data[i])
        : d.data,
      backgroundColor: Array.isArray(d.backgroundColor)
        ? indices.map(i => d.backgroundColor[i])
        : d.backgroundColor,
      borderColor: Array.isArray(d.borderColor)
        ? indices.map(i => d.borderColor[i])
        : d.borderColor,
    })),
  };
}

/** Convenience: run both post-processors in order. */
function postProcessViz(chartConfig, columns, rawRows) {
  return trimCategoricalData(fixScatterData(chartConfig, columns, rawRows));
}

// ── SSE helper ───────────────────────────────────────────────────────────────
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Schema loader (scoped to Chinook tables only) ─────────────────────────────
function loadSchema() {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .filter(({ name }) => !CHAT_TABLES.has(name))
    .map(({ name }) => {
      const columns = db.pragma(`table_info(${name})`).map((col) => ({
        name: col.name,
        type: col.type,
        pk: col.pk === 1,
      }));
      return { table: name, columns };
    });
}

// ── Self-healing SQL execution ────────────────────────────────────────────────
/**
 * Attempts to execute a SQL query. If it fails, asks the DB Manager to correct
 * it once using the error message and the original schema. Only one retry.
 *
 * @param {string}   sql           - Initial SQL from DB Manager.
 * @param {string}   refinedIntent - Original intent for the retry prompt.
 * @param {object[]} schema        - Full schema (for retry context).
 * @returns {{ rows, columns, elapsed, finalSql }}
 */
async function executeWithSelfHeal(sql, refinedIntent, schema) {
  // ── First attempt ────────────────────────────────────────────────────────────
  try {
    const t0      = Date.now();
    const stmt    = db.prepare(sql);
    const rows    = stmt.all();
    const elapsed = Date.now() - t0;
    const columns = rows.length > 0
      ? Object.keys(rows[0])
      : stmt.columns().map((c) => c.name);
    return { rows, columns, elapsed, finalSql: sql };
  } catch (firstErr) {
    console.warn(`[SelfHeal] Initial SQL failed: ${firstErr.message}`);
    console.log('[SelfHeal] Asking DB Manager for one correction attempt…');

    // ── Correction attempt ────────────────────────────────────────────────────
    const dbSystem = buildDBManagerSystem(schema);
    const correctionPrompt =
      `The following SQL query failed with this SQLite error:\n` +
      `ERROR: ${firstErr.message}\n\n` +
      `Failed SQL:\n${sql}\n\n` +
      `Original data intent: ${refinedIntent}\n\n` +
      `Please produce a corrected SQL query that avoids this error. ` +
      `Re-check the schema carefully for correct table and column names.`;

    const corrected = await callOllama(dbSystem, correctionPrompt);

    if (!corrected.sql) {
      throw new Error(
        `The generated SQL failed and the self-healing correction did not return a query. ` +
        `Original error: ${firstErr.message}`
      );
    }

    const correctedSql = corrected.sql.trim();
    console.log(`[SelfHeal] Corrected SQL:\n${correctedSql}`);

    // ── Second attempt (no further healing) ──────────────────────────────────
    try {
      const t0      = Date.now();
      const stmt    = db.prepare(correctedSql);
      const rows    = stmt.all();
      const elapsed = Date.now() - t0;
      const columns = rows.length > 0
        ? Object.keys(rows[0])
        : stmt.columns().map((c) => c.name);
      console.log('[SelfHeal] Corrected SQL executed successfully.');
      return { rows, columns, elapsed, finalSql: correctedSql };
    } catch (secondErr) {
      throw new Error(
        `SQL failed after self-healing correction. ` +
        `Original error: ${firstErr.message}. ` +
        `Correction error: ${secondErr.message}. ` +
        `Try rephrasing your question with more specific criteria.`
      );
    }
  }
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

  // ── Build a compact conversation-history string ───────────────────────────
  function buildHistoryContext() {
    if (!history.length) return '';
    const turns = history.slice(-6).map(m => {
      const role = m.role === 'user' ? '[user]' : '[assistant]';
      const body = m.type === 'data_block'
        ? `Ran SQL: ${(m.sql ?? '').slice(0, 200)}${m.tableData ? ` (${m.tableData.rowCount} rows, cols: ${m.tableData.columns?.join(', ')})` : ''}`
        : (m.content ?? '').slice(0, 150);
      return `${role}: ${body}`;
    });
    return `\n\nConversation history (most recent last):\n${turns.join('\n')}`;
  }

  // Find the most recent data_block in history (for revisualize and viz_tweak)
  const lastDataBlock = [...history].reverse().find(m => m.type === 'data_block');

  try {
    // ── Agent 1: The Analyst ───────────────────────────────────────────────────
    sseWrite(res, 'step', { label: '🔍 Analyst — evaluating intent...' });

    const userContent =
      (context ? `${message}\n\nUser clarification selected: ${context}` : message)
      + buildHistoryContext();

    const analystResult = await callOllama(ANALYST_SYSTEM, userContent);

    // ── Ambiguity → return chips immediately ────────────────────────────────
    if (analystResult.type === 'ambiguity') {
      sseWrite(res, 'result', {
        type:    'ambiguity',
        message: analystResult.message,
        options: analystResult.options,
      });
      res.end();
      return;
    }

    // ── Vague retry → friendly prompt ──────────────────────────────────────
    if (analystResult.type === 'error_followup') {
      sseWrite(res, 'result', {
        type:    'text',
        summary: analystResult.message ??
          "I'm not sure what to retry. Could you rephrase your original question?",
      });
      res.end();
      return;
    }

    // ── Style tweak (viz_tweak) → delegate to /api/adjust-viz internally ────
    // We handle this here in SSE so the client gets a proper streaming response.
    if (analystResult.type === 'viz_tweak') {
      const currentVizJson = lastDataBlock?.vizJson ?? lastDataBlock?.chartConfig ?? null;

      if (!currentVizJson) {
        sseWrite(res, 'result', {
          type:    'text',
          summary: "I don't have a current chart to adjust. Please ask a data question first.",
        });
        res.end();
        return;
      }

      sseWrite(res, 'step', { label: '🎨 Viz Modifier — applying style tweak...' });

      const modifierSystem = buildVizModifierSystem(currentVizJson);
      const modifiedViz = await callOllama(
        modifierSystem,
        `Apply this style tweak to the chart: "${analystResult.tweak}"`,
      );

      // Protect data integrity: restore original data arrays if mutated
      const originalDatasets = currentVizJson.datasets ?? [];
      const returnedDatasets  = modifiedViz.datasets ?? [];
      for (let i = 0; i < originalDatasets.length; i++) {
        if (JSON.stringify(originalDatasets[i]?.data) !== JSON.stringify(returnedDatasets[i]?.data)) {
          console.warn(`[SseVizTweak] Model mutated data on dataset ${i} — restoring.`);
          if (modifiedViz.datasets?.[i]) modifiedViz.datasets[i].data = originalDatasets[i].data;
        }
      }
      if (currentVizJson.labels && JSON.stringify(modifiedViz.labels) !== JSON.stringify(currentVizJson.labels)) {
        modifiedViz.labels = currentVizJson.labels;
      }

      sseWrite(res, 'step', { label: '✅ Rendering updated chart...' });
      sseWrite(res, 'result', {
        type:        'data_block',
        sql:         lastDataBlock.sql,
        tableData:   lastDataBlock.tableData,
        vizJson:     modifiedViz,
        chartConfig: modifiedViz,
        summary:     `Applied: "${analystResult.tweak}"`,
      });
      res.end();
      return;
    }

    // ── Re-visualization request ────────────────────────────────────────────
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

      // Gatekeeper: honor explicit chart type hint from analyst
      const gatekeeperType = analystResult.chartHint
        ? analystResult.chartHint
        : applyGatekeeper(reColumns, reTableData.rows, message);

      const hint    = analystResult.chartHint
        ? ` Prefer a different chart type: ${analystResult.chartHint}.`
        : ' Use a different chart type than the one previously shown.';
      const vizSys  = buildVisualizerSystem(reColumns, reTableData.rows, gatekeeperType);
      const vizRes  = await callOllama(
        vizSys,
        `Columns: ${reColumns.join(', ')}\nAll rows (${reRows.length} total): ` +
        `${JSON.stringify(reTableData.rows)}${hint}`,
      );

      if (!vizRes.chartConfig) throw new Error('Visualizer did not return a chartConfig.');

      // Apply scatter normalisation + categorical trim for the revisualize path
      const finalViz = postProcessViz(vizRes.chartConfig, reColumns, reTableData.rows);
      sseWrite(res, 'step',   { label: '✅ Rendering results...' });
      sseWrite(res, 'result', {
        type:        'data_block',
        sql:         reSql,
        tableData:   reTableData,
        vizJson:     finalViz,
        chartConfig: finalViz,
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

    const schema   = loadSchema();
    const dbSystem = buildDBManagerSystem(schema);
    const prevSql  = lastDataBlock?.sql ? `\n\nPrevious query for context:\n${lastDataBlock.sql}` : '';
    const dbResult = await callOllama(dbSystem, `Data intent: ${refinedIntent}${prevSql}`);

    if (!dbResult.sql) {
      throw new Error('DB Manager did not return a SQL query.');
    }

    const sql     = dbResult.sql.trim();
    const sqlNorm = sql.toUpperCase();
    if (!sqlNorm.startsWith('SELECT') && !sqlNorm.startsWith('WITH')) {
      throw new Error('DB Manager produced a non-SELECT statement — blocked for safety.');
    }

    // ── Self-Healing SQL Execution ────────────────────────────────────────────
    sseWrite(res, 'step', { label: '⚙️  Executing query against ChinookDB...' });

    const { rows, columns, elapsed, finalSql } = await executeWithSelfHeal(
      sql, refinedIntent, schema
    );

    const tableData = {
      columns,
      rows:     rows.map((r) => columns.map((c) => r[c])),
      rowCount: rows.length,
      elapsed,
    };

    // ── Deterministic Gatekeeper (before Visualizer) ──────────────────────────
    const gatekeeperType = applyGatekeeper(columns, tableData.rows, message);
    if (gatekeeperType) {
      console.log(`[Gatekeeper] Enforcing chart type: "${gatekeeperType}"`);
    }

    // ── Agent 3: The Visualizer ───────────────────────────────────────────────
    sseWrite(res, 'step', { label: '📊 Visualizer — designing chart...' });

    const vizSystem = buildVisualizerSystem(columns, tableData.rows, gatekeeperType);
    const vizResult = await callOllama(
      vizSystem,
      `Columns: ${columns.join(', ')}\nAll rows (${rows.length} total): ${JSON.stringify(tableData.rows)}`,
    );

    if (!vizResult.chartConfig) {
      throw new Error('Visualizer did not return a chartConfig object.');
    }

    // ── Scatter fix + categorical trim (server-side, deterministic) ──────────────
    const finalViz = postProcessViz(vizResult.chartConfig, columns, tableData.rows);
    sseWrite(res, 'step',   { label: '✅ Rendering results...' });
    sseWrite(res, 'result', {
      type:        'data_block',
      sql:         finalSql,          // may differ from original if self-healed
      tableData,
      vizJson:     finalViz,          // stateful source-of-truth for Viz Modifier
      chartConfig: finalViz,
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
  console.log(`[Server] Endpoints: /api/health  /api/tables  /api/query  /api/chat  /api/adjust-viz`);
});
