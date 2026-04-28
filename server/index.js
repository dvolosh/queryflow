import express from 'express';
import cors from 'cors';
import db from './db.js';
import {
  buildAnalystSystem,
  buildDBManagerSystem,
  buildVisualizerSystem,
  buildVizModifierSystem,
  buildRecommendationSystem,
  applyGatekeeper,
  isNumericValue,
  callOllama,
  callOllamaRaw,
} from './agents.js';


const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));


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
    rawRows.slice(0, 5).some(row => isNumericValue(row[i]));

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

  const xyData = rawRows
    .map(row => ({ x: Number(row[xIdx]), y: Number(row[yIdx]) }))
    .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
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

// ── Server-side categorical data rebuilder ───────────────────────────────────
/**
 * The Visualizer LLM frequently truncates data arrays (e.g. returns 3 items when
 * the user asked for "Top 5"). This function deterministically rebuilds the
 * chart's labels[] and datasets[].data[] arrays directly from the raw SQL rows,
 * ensuring the chart EXACTLY matches the query result.
 *
 * For scatter charts this is a no-op (scatter uses {x,y} pairs from fixScatterData).
 *
 * Strategy:
 *   1. Identify the label column (first text/string column).
 *   2. Identify all numeric columns → one dataset per numeric column.
 *   3. Rebuild labels and data arrays 1:1 from rawRows.
 *   4. Preserve the LLM's styling choices (colors, axis labels, title, etc.).
 */
function rebuildCategoricalData(chartConfig, columns, rawRows) {
  const type = chartConfig?.type;
  // Only apply to categorical chart types 
  if (!type || type === 'scatter' || type === 'none') return chartConfig;

  // Detect ID-like columns (e.g. TrackId, InvoiceId, CustomerId)
  const ID_RE = /(?:^|_)id$/i;
  const isIdCol = name => ID_RE.test(name);

  // ── Special case: single-row summary statistics ──────────────────────────
  // If the DB returned a single row of aggregates (e.g. AVG, MIN, MAX, Median),
  // pivot: use column names as labels and the single row values as data.
  if (rawRows.length === 1) {
    const statsNumericIdxs = columns
      .map((_col, i) => i)
      .filter(i => isNumericValue(rawRows[0][i]));

    if (statsNumericIdxs.length >= 2) {
      const newLabels = statsNumericIdxs.map(i => columns[i]);
      const newData   = statsNumericIdxs.map(i => Number(rawRows[0][i]));

      const existingDs = chartConfig.datasets ?? [];
      const existingStyle = existingDs[0] ?? {};

      console.log(`[RebuildData] Single-row pivot: ${newLabels.length} stat columns as bar labels`);
      return {
        ...chartConfig,
        labels:   newLabels,
        datasets: [{
          ...existingStyle,
          label: existingStyle.label ?? 'Statistics',
          data:  newData,
        }],
      };
    }
  }

  // ── Find the label column (first non-numeric, non-ID column) ────────────
  let labelIdx = columns.findIndex((_col, i) =>
    !isIdCol(columns[i]) &&
    rawRows.slice(0, 3).every(row => !isNumericValue(row[i]))
  );

  // Fallback: first non-numeric column even if it looks like an ID
  if (labelIdx === -1) {
    labelIdx = columns.findIndex((_col, i) =>
      rawRows.slice(0, 3).every(row => !isNumericValue(row[i]))
    );
  }

  // Last fallback: column 0 (even if numeric / ID) but warn
  if (labelIdx === -1) {
    labelIdx = 0;
    console.warn('[RebuildData] No suitable label column found, using index 0 as fallback.');
  }

  // ── Find all numeric column indices ────────────────────────────────────────
  const YEAR_RE = /\byear\b/i;
  
  // First pass: try to exclude ID-like and Year-like columns so we don't plot them
  let numericIdxs = columns
    .map((_col, i) => i)
    .filter(i => 
      i !== labelIdx && 
      !isIdCol(columns[i]) && 
      !YEAR_RE.test(columns[i]) &&
      rawRows.slice(0, 3).some(row => isNumericValue(row[i]))
    );

  // Fallback: if excluding IDs/Years left us with nothing, just take any numeric column
  if (numericIdxs.length === 0) {
    numericIdxs = columns
      .map((_col, i) => i)
      .filter(i => i !== labelIdx && rawRows.slice(0, 3).some(row => isNumericValue(row[i])));
  }

  if (numericIdxs.length === 0) return chartConfig; // nothing to rebuild

  const existingDs = chartConfig.datasets ?? [];

  // If the LLM intentionally generated fewer datasets than we found numeric columns,
  // assume it skipped the earlier ones and plotted the actual metrics at the end.
  if (existingDs.length > 0 && numericIdxs.length > existingDs.length) {
    numericIdxs = numericIdxs.slice(-existingDs.length);
  }

  // Rebuild labels from SQL rows
  const newLabels = rawRows.map(row => {
    const val = row[labelIdx];
    const str = val != null ? String(val) : '';
    return str.length > 25 ? str.slice(0, 22) + '…' : str;
  });

  // Rebuild datasets — preserve LLM styling, replace data
  const newDatasets = numericIdxs.map((colIdx, dsIdx) => {
    // If we have an exact matching dataset from the LLM, use its styling.
    // Otherwise, copy colors from the first dataset but use the real column name.
    const hasOwnStyle = dsIdx < existingDs.length;
    const existingStyle = existingDs[dsIdx] ?? existingDs[0] ?? {};
    
    const label = (hasOwnStyle && existingStyle.label)
      ? existingStyle.label 
      : columns[colIdx];

    const newData = rawRows.map(row => {
      const v = row[colIdx];
      return isNumericValue(v) ? Number(v) : 0;
    });

    // For pie/doughnut, ensure backgroundColor is an array matching labels
    let bg = existingStyle.backgroundColor;
    if ((type === 'pie' || type === 'doughnut') && !Array.isArray(bg)) {
      const PIE_COLORS = [
        '#6366f1', '#14b8a6', '#8b5cf6', '#f59e0b',
        '#f43f5e', '#38bdf8', '#10b981', '#f97316',
        '#a855f7', '#ef4444', '#22d3ee', '#84cc16',
      ];
      bg = newData.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]);
    }

    return {
      ...existingStyle,
      label,
      data: newData,
      ...(bg ? { backgroundColor: bg } : {}),
    };
  });

  const oldLen = chartConfig.labels?.length ?? 0;
  if (oldLen !== newLabels.length) {
    console.log(`[RebuildData] Corrected data: ${oldLen} → ${newLabels.length} entries from SQL rows`);
  }

  return {
    ...chartConfig,
    labels:   newLabels,
    datasets: newDatasets,
  };
}

// ── Extract user-specified limit from message ────────────────────────────────
/**
 * Parses the user's message for explicit "top N", "N results", "limit N" patterns.
 * Returns the number N or null if none found.
 */
function extractUserLimit(userMsg) {
  if (!userMsg) return null;
  const lower = userMsg.toLowerCase();
  // Match "top 5", "top-5", "top5"
  const topMatch = lower.match(/\btop[- ]?(\d+)\b/);
  if (topMatch) return parseInt(topMatch[1], 10);
  // Match "limit 5", "limit to 5"
  const limitMatch = lower.match(/\blimit(?:\s+to)?\s+(\d+)\b/);
  if (limitMatch) return parseInt(limitMatch[1], 10);
  // Match "5 results", "3 artists", "7 genres" etc.
  const nResultsMatch = lower.match(/\b(\d+)\s+(?:results?|items?|entries|rows?)\b/);
  if (nResultsMatch) return parseInt(nResultsMatch[1], 10);
  return null;
}

// ── Server-side categorical chart trimmer ────────────────────────────────────
/**
 * When a bar or line chart has too many category labels, the chart becomes
 * unreadable. This post-processor keeps only the top N entries, sorted by
 * the primary dataset (first dataset) in descending order.
 *
 * If the user explicitly requested a limit (e.g. "Top 5"), that limit is
 * honored instead of the default cap.
 *
 * For scatter / pie / doughnut, this is a no-op.
 */
const CATEGORICAL_MAX_DEFAULT = 25;
function trimCategoricalData(chartConfig, userLimit = null) {
  const type = chartConfig?.type;
  if (!['bar', 'line'].includes(type)) return chartConfig;

  const labels = chartConfig.labels ?? [];
  const maxLabels = userLimit ?? CATEGORICAL_MAX_DEFAULT;

  if (labels.length <= maxLabels) return chartConfig;

  const ds      = chartConfig.datasets ?? [];
  const primary = ds[0]?.data ?? [];

  // Sort indices by first dataset descending, keep top N
  const indices = labels
    .map((_, i) => i)
    .sort((a, b) => (Number(primary[b]) || 0) - (Number(primary[a]) || 0))
    .slice(0, maxLabels);

  console.log(`[TrimCategories] Trimmed ${labels.length} → ${maxLabels} labels`);

  return {
    ...chartConfig,
    title:    chartConfig.title ? `${chartConfig.title} (Top ${maxLabels})` : chartConfig.title,
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

// ── Server-side Boxplot Data Builder ─────────────────────────────────────────
/**
 * For boxplots, the DB returns raw individual rows. This processor groups the raw
 * data by category and formats it into the array-of-arrays structure required by
 * the chartjs-chart-boxplot plugin.
 */
function buildBoxplotData(chartConfig, columns, rawRows) {
  if (chartConfig?.type !== 'boxplot') return chartConfig;

  // Detect ID-like columns
  const ID_RE = /(?:^|_)id$/i;
  const isIdCol = name => ID_RE.test(name);

  // Find the label column (first non-numeric, non-ID column)
  let labelIdx = columns.findIndex(c => !isIdCol(c) && rawRows.slice(0, 3).every(row => !isNumericValue(row[columns.indexOf(c)])));
  if (labelIdx === -1) {
    labelIdx = columns.findIndex(c => rawRows.slice(0, 3).every(row => !isNumericValue(row[columns.indexOf(c)])));
  }

  // Find numeric column index
  const numericIdxs = columns.map((_, i) => i).filter(i => i !== labelIdx && rawRows.slice(0, 3).some(row => isNumericValue(row[i])));
  if (numericIdxs.length === 0) return chartConfig;

  // Group raw rows
  const grouped = {};
  if (labelIdx === -1) {
    grouped['All Data'] = rawRows;
  } else {
    for (const r of rawRows) {
      const key = String(r[labelIdx] ?? 'Unknown');
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }
  }

  // Cap at 25 labels to keep chart readable
  const allLabels = Object.keys(grouped);
  const labels = allLabels.slice(0, 25);
  
  const existingDs = chartConfig.datasets ?? [];
  const datasets = numericIdxs.map((colIdx, dsIdx) => {
    const style = existingDs[dsIdx] ?? existingDs[0] ?? {};
    const data = labels.map(l => 
      grouped[l].map(r => Number(r[colIdx])).filter(v => Number.isFinite(v))
    );
    return {
      ...style,
      label: style.label || columns[colIdx],
      data,
      backgroundColor: style.backgroundColor ?? '#6366f1',
      borderColor: style.borderColor ?? '#6366f1',
      borderWidth: style.borderWidth ?? 2
    };
  });

  console.log(`[RebuildData] Built boxplot data: ${labels.length} groups.`);
  return {
    ...chartConfig,
    labels,
    datasets,
    title: chartConfig.title ? `${chartConfig.title}${allLabels.length > 25 ? ' (Top 25)' : ''}` : chartConfig.title
  };
}

/** Convenience: run all post-processors in order. */
function postProcessViz(chartConfig, columns, rawRows, userMsg = '') {
  const userLimit = extractUserLimit(userMsg);
  let result = fixScatterData(chartConfig, columns, rawRows);
  result = rebuildCategoricalData(result, columns, rawRows);
  result = buildBoxplotData(result, columns, rawRows);
  result = trimCategoricalData(result, userLimit);
  return result;
}

// ── SSE helper ───────────────────────────────────────────────────────────────
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── SQL safety validator ──────────────────────────────────────────────────────
/**
 * Validates and sanitises an LLM-generated SQL string before execution.
 *
 * Checks (in order):
 *   1. Block WITH RECURSIVE — can loop indefinitely on misconfigured queries.
 *   2. Block CROSS JOIN — cartesian products can produce millions of rows.
 *   3. Inject a LIMIT 200 safety net if the query has no LIMIT clause.
 *
 * @param {string} sql
 * @returns {string} Possibly-modified SQL that is safe to run.
 * @throws {Error}  If a blocked construct is detected.
 */
function validateSql(sql) {
  const upper = sql.toUpperCase();

  if (/\bWITH\s+RECURSIVE\b/.test(upper)) {
    throw new Error(
      'Recursive CTEs are not permitted — they can loop indefinitely. Please rephrase your question.'
    );
  }

  if (/\bCROSS\s+JOIN\b/.test(upper)) {
    throw new Error(
      'CROSS JOIN is not permitted — it can produce extremely large result sets. Please rephrase your question.'
    );
  }

  if (!/\bLIMIT\b/.test(upper)) {
    console.warn('[SqlValidator] Query missing LIMIT — injecting LIMIT 200 as safety net.');
    sql = sql.trimEnd().replace(/;?\s*$/, '') + '\nLIMIT 200';
  }

  return sql;
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
    // ── Load schema once for all agents in this request ────────────────────────
    const schema = loadSchema();

    // ── Agent 1: The Analyst ───────────────────────────────────────────────────
    sseWrite(res, 'step', { label: '🔍 Analyst — evaluating intent...' });

    const userContent =
      (context ? `${message}\n\nUser clarification selected: ${context}` : message)
      + buildHistoryContext();

    const analystSystem = buildAnalystSystem(schema);
    const analystResult = await callOllama(analystSystem, userContent);

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

    // ── Out-of-scope / unanswerable → explain and bail ──────────────────────
    if (analystResult.type === 'out_of_scope') {
      const confidence = typeof analystResult.confidence === 'number'
        ? analystResult.confidence
        : 1.0;
      const baseMsg = analystResult.message ??
        "That question can't be answered from the ChinookDB music store database.";

      // High confidence (≥ 0.7): hard block with clear explanation
      // Low confidence (< 0.7): softer tone — the model isn't certain, still stop but hedge
      const summary = confidence < 0.7
        ? `⚠️ I'm not certain, but this may be outside what ChinookDB covers. ${baseMsg} ` +
          `If you believe this relates to music store data, try rephrasing your question.`
        : baseMsg;

      sseWrite(res, 'result', { type: 'text', summary });
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

      // Empty result on revisualize
      if (reRows.length === 0) {
        sseWrite(res, 'result', {
          type:    'text',
          summary: 'The previous query returned no rows — nothing to visualize. ' +
                   'Try broadening your filters or asking a different question.',
        });
        res.end();
        return;
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
      const vizSys  = buildVisualizerSystem(reColumns, reTableData.rows, gatekeeperType, message);
      const vizRes  = await callOllama(
        vizSys,
        `User's original question: "${message}"\nColumns: ${reColumns.join(', ')}\nAll rows (${reRows.length} total): ` +
        `${JSON.stringify(reTableData.rows)}${hint}`,
      );

      if (!vizRes.chartConfig) throw new Error('Visualizer did not return a chartConfig.');

      // Force chart type if Gatekeeper determined one
      if (gatekeeperType && vizRes.chartConfig) vizRes.chartConfig.type = gatekeeperType;
      // Apply scatter normalisation + data rebuild + categorical trim
      const finalViz = postProcessViz(vizRes.chartConfig, reColumns, reTableData.rows, message);
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

    // ── SQL Safety Validation ────────────────────────────────────────────────
    const safeSql = validateSql(sql);

    // ── Self-Healing SQL Execution ────────────────────────────────────────────
    sseWrite(res, 'step', { label: '⚙️  Executing query against ChinookDB...' });

    const { rows, columns, elapsed, finalSql } = await executeWithSelfHeal(
      safeSql, refinedIntent, schema
    );

    // ── Empty Result Guard ─────────────────────────────────────────────────────
    // If the SQL ran but matched zero rows, skip the Visualizer entirely and
    // return a plain-text explanation so the user knows to adjust their question.
    if (rows.length === 0) {
      sseWrite(res, 'step',   { label: '✅ Query complete — no matching data.' });
      sseWrite(res, 'result', {
        type:    'text',
        sql:     finalSql,
        summary: 'The query ran successfully but returned no results. ' +
                 'Try broadening your filters (e.g. a wider date range or fewer constraints) ' +
                 'or rephrasing your question.',
      });
      res.end();
      return;
    }

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

    const vizSystem = buildVisualizerSystem(columns, tableData.rows, gatekeeperType, message);
    const vizResult = await callOllama(
      vizSystem,
      `User's original question: "${message}"\nColumns: ${columns.join(', ')}\nAll rows (${rows.length} total): ${JSON.stringify(tableData.rows)}`,
    );

    if (!vizResult.chartConfig) {
      throw new Error('Visualizer did not return a chartConfig object.');
    }

    // ── Force gatekeeper chart type if it had an opinion ─────────────────────────
    if (gatekeeperType && vizResult.chartConfig) {
      vizResult.chartConfig.type = gatekeeperType;
    }

    // ── Deterministic post-processing: scatter fix + data rebuild + trim ─────────
    const finalViz = postProcessViz(vizResult.chartConfig, columns, tableData.rows, message);
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


// ── Business Recommendation Agent ───────────────────────────────────────────
// POST /api/recommend
// Body: { history: [...messages] }
// Streams SSE events:
//   event: step   data: { label: "..." }
//   event: result data: { type: "recommendation", markdown: "..." }
//   event: error  data: { message: "..." }
//
// Builds a compact analytics-session context from history and asks the
// Recommendation Agent to produce a structured Markdown memo.
app.post('/api/recommend', async (req, res) => {
  const { history = [] } = req.body ?? {};

  // Need at least one data block to make a meaningful recommendation
  const dataBlocks = history.filter(m => m.type === 'data_block');
  if (dataBlocks.length === 0) {
    return res.status(400).json({
      error: 'No data analysis found in this conversation yet. Ask at least one data question first.',
    });
  }

  // Open SSE stream
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  try {
    sseWrite(res, 'step', { label: 'Synthesising analytics session...' });

    // ── Build a compact, structured context string ────────────────────────────
    // We pull: user questions, SQL queries, chart types, and insight summaries.
    // Raw rows are explicitly excluded — only the summaries matter here.
    const turns = [];

    // Walk through history pairs: find each user question and its following data block
    for (let i = 0; i < history.length; i++) {
      const m = history[i];

      if (m.role === 'user' && m.content) {
        const question = m.content.trim();

        // Look ahead for the immediately following assistant data block
        const next = history[i + 1];
        if (next?.role === 'assistant' && next.type === 'data_block') {
          const chartType  = next.vizJson?.type ?? next.chartConfig?.type ?? 'unknown';
          const chartTitle = next.vizJson?.title ?? next.chartConfig?.title ?? '';
          const summary    = next.content ?? '';
          const sql        = (next.sql ?? '').slice(0, 300); // cap SQL length

          turns.push(
            `### Question\n${question}\n` +
            `**Insight:** ${summary}\n` +
            `**Visualization:** ${chartTitle || chartType} (${chartType} chart)\n` +
            `**SQL (excerpt):** \`${sql}\``
          );
        } else if (next?.role === 'assistant' && next.type === 'text' && next.content) {
          // Text-only response (no chart)
          turns.push(
            `### Question\n${question}\n` +
            `**Response:** ${next.content.trim().slice(0, 300)}`
          );
        }
      }
    }

    const conversationContext = turns.length > 0
      ? turns.join('\n\n---\n\n')
      : 'No structured turns found — use the overall conversation to infer findings.';

    // ── Call the Recommendation Agent ────────────────────────────────────────
    sseWrite(res, 'step', { label: 'Writing business recommendation...' });
    console.log(`[Recommend] Building recommendation from ${turns.length} turns.`);

    const systemPrompt = buildRecommendationSystem(conversationContext);
    const markdown     = await callOllamaRaw(
      systemPrompt,
      'Generate the business recommendation memo based on the analytics session above.',
    );

    sseWrite(res, 'result', { type: 'recommendation', markdown });
    res.end();

  } catch (err) {
    console.error('[Recommend] Error:', err.message);
    sseWrite(res, 'error', { message: err.message });
    res.end();
  }
});


// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] QueryFlow API running at http://localhost:${PORT}`);
  console.log(`[Server] Endpoints: /api/health  /api/tables  /api/query  /api/chat  /api/adjust-viz  /api/recommend`);
});
