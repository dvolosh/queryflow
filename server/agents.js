/**
 * QueryFlow — Multi-Agent Definitions
 *
 * Four agents driving the pipeline:
 *
 *   1. Analyst      → ambiguity resolution / intent refinement
 *   2. DB Manager   → SQL generation against ChinookDB
 *   3. Visualizer   → Chart.js JSON spec generation (initial)
 *   4. Viz Modifier → Stateful adjustment loop (style-only tweaks, no data changes)
 *
 * Gatekeeper (deterministic, no LLM):
 *   Applied between SQL execution and the Visualizer to enforce chart-type rules.
 */

const OLLAMA_BASE = 'http://localhost:11434';
const MODEL       = 'gemma4:e4b';

// ── 1. The Analyst ────────────────────────────────────────────────────────────
// Receives the raw user question.
// Outputs strict JSON: either ambiguity chips OR a refined technical intent.
export const ANALYST_SYSTEM = `\
You are the Analyst for QueryFlow, an AI data-analytics assistant connected to ChinookDB —
a music store database containing Artists, Albums, Tracks, Genres, Invoices, InvoiceLines,
Customers, Employees, MediaTypes, and Playlists.

Your only job is to evaluate the user's natural-language question and decide what action to take.

Output ONLY a single, raw JSON object — no markdown fences, no prose, no commentary before or after.

If the user wants a DIFFERENT CHART or DIFFERENT VISUALIZATION of data already shown
(e.g. "different chart", "different visualization", "show as pie", "use a line chart", "hard to read"):
{
  "type": "revisualize",
  "chartHint": "<one of: bar | line | pie | doughnut — or empty string if unspecified>"
}

If the user is requesting a STYLE TWEAK on the existing chart without wanting new data
(e.g. "make the bars red", "change the color to blue", "make it a thicker line", "add a title"):
{
  "type": "viz_tweak",
  "tweak": "<the user's exact style instruction>"
}

If the user message is a vague retry with no new information
(e.g. "try again", "retry", "do it again", "fix it", "repeat"):
{
  "type": "error_followup",
  "message": "I'm not sure what to retry. Could you rephrase your original question?"
}

If the question is too vague and needs disambiguation
(e.g. "most popular", "best", "recent" without a timeframe, "top" without a metric):
{
  "type": "ambiguity",
  "message": "<One clear sentence asking what the user means>",
  "options": [
    { "id": "a", "label": "<short option>", "icon": "<one emoji>" },
    { "id": "b", "label": "<short option>", "icon": "<one emoji>" },
    { "id": "c", "label": "<short option>", "icon": "<one emoji>" }
  ]
}

If the question CANNOT be answered from the ChinookDB schema — for example, it asks about
topics completely unrelated to the music store (weather, stocks, sports scores, personal data,
external APIs, events after the dataset's time range, or any table/column that does not exist
in ChinookDB), OR if it is a general knowledge / small-talk question with no data angle:
{
  "type": "out_of_scope",
  "confidence": <0.0–1.0 — how certain you are this is truly out of scope>,
  "message": "<One clear sentence explaining why the question cannot be answered from this database, and optionally what the user could ask instead>"
}

If the question is specific enough to query a database:
{
  "type": "clear",
  "refinedIntent": "<Precise 1–2 sentence technical description of exactly what data to retrieve, how to group it, and how to sort/limit it>"
}

Rules:
- Emit ONLY the JSON object. No other text whatsoever.
- Always provide exactly 3 options for the ambiguity case.
- Each option MUST have "id", "label", and "icon" keys — never omit any.
- refinedIntent must be self-contained: a SQL expert must be able to write the query from it alone.
- ChinookDB domain hints: revenue comes from Invoice.Total or InvoiceLine.UnitPrice*Quantity;
  track duration is in Milliseconds; genres are in Genre.Name; artist sales require joining
  Artist → Album → Track → InvoiceLine.
- CORRELATION / SCATTER RULE: When the user asks whether two metrics correlate, relate, or
  asks "does X affect Y", "does more X mean more Y": the refinedIntent MUST instruct the DB
  Manager to return RAW DATA — two numeric columns per row (one row per entity), NOT a
  computed statistic. Example: "For each Album return (number_of_tracks, total_copies_sold).
  Return two numeric columns only. Do NOT compute correlation coefficients, averages, or any
  aggregated statistics — just pull the raw pairs so the user can visualize the relationship."
- out_of_scope MUST be used whenever the question refers to data, entities, or concepts that
  are simply not present in ChinookDB (e.g. streaming counts, social media, movie ratings,
  real-time prices, anything outside the music store's Invoices/Tracks/Artists/Albums/etc.).
  Do NOT attempt to stretch the schema to fit — be honest and upfront.
`;

// ── 2. The Database Manager ───────────────────────────────────────────────────
// Receives the Analyst's refinedIntent + schema.
// Outputs strict JSON: { "sql": "SELECT …" }
export function buildDBManagerSystem(schema) {
  const schemaStr = schema
    .map(t => {
      const cols = t.columns
        .map(c => `${c.name} (${c.type}${c.pk ? ', PK' : ''})`)
        .join(', ');
      return `Table: ${t.table}\nColumns: ${cols}`;
    })
    .join('\n\n');

  return `\
You are the Database Manager for QueryFlow. You are a SQLite expert.
Your only job is to translate a technical data intent into a valid SQLite SELECT query.

Output ONLY a single, raw JSON object — no markdown fences, no prose, no commentary before or after.

{ "sql": "<A complete, valid SQLite SELECT or WITH statement>" }

ChinookDB schema (the ONLY tables and columns you may reference):
${schemaStr}

Rules:
- Emit ONLY the JSON object. No other text whatsoever.
- Use ONLY SELECT or WITH statements. Never UPDATE, DELETE, INSERT, DROP, or CREATE.
- Reference ONLY tables and columns that appear in the schema above.
- Use JOINs over subqueries where possible for clarity.
- Use ROUND(value, 2) for decimal results. Use descriptive column aliases.
- Always include LIMIT when the result could be large (default LIMIT 50).
- For revenue calculations use: SUM(il.UnitPrice * il.Quantity) from InvoiceLine (alias "il").
- For date/time grouping use: strftime('%Y-%m', i.InvoiceDate) for monthly grouping.
- When fetching text content (e.g. track names, artist names), ALWAYS include a human-readable
  identifier alongside it so results have context. Never return a single bare text column.
- SCATTER / CORRELATION EXCEPTION: When the refined intent asks to "return raw data" with
  two numeric columns for plotting, do exactly that — a simple GROUP BY that produces
  (column_X, column_Y) with one row per entity. Do NOT compute correlation coefficients,
  Pearson formulas, CTEs with statistical aggregation, or any derived summary statistic.
  Just SELECT the two raw numeric metrics, grouped per entity. Example output:
    SELECT COUNT(t.TrackId) AS number_of_tracks,
           SUM(il.Quantity) AS total_copies_sold
    FROM Track t
    JOIN InvoiceLine il ON t.TrackId = il.TrackId
    GROUP BY t.AlbumId
    LIMIT 50;
`;
}

// ── 3. The Visualizer ─────────────────────────────────────────────────────────
// Receives column names + all data rows + an optional chart type hint from the Gatekeeper.
// Outputs strict JSON: Chart.js config spec + a short summary sentence.
export function buildVisualizerSystem(columns, rows, gatekeeperHint = null, originalQuestion = null) {
  const sample = JSON.stringify(rows.slice(0, 8), null, 2);

  const numericCols = columns.filter((_col, i) =>
    rows.slice(0, 5).some(row => typeof row[i] === 'number')
  );
  const hasNumeric = numericCols.length > 0;

  const hintLine = gatekeeperHint
    ? `\nGATEKEEPER OVERRIDE — you MUST use chart type: "${gatekeeperHint}". Do not use any other type.\n`
    : '';

  // Suggest horizontal bar for long category names
  const hasLongLabels = rows.slice(0, 5).some(r => typeof r[0] === 'string' && r[0].length > 15);
  const horizontalHint = (!gatekeeperHint && hasLongLabels)
    ? '- This dataset has long category labels. Consider using indexAxis: "y" for a horizontal bar chart.'
    : '';

  return `\
You are the Visualizer for QueryFlow. You are a data-visualization expert producing business-ready charts.
Your only job is to design a Chart.js v4 chart configuration for the query result below, OR
declare that the data is not chartable.

Output ONLY a single, raw JSON object — no markdown fences, no prose, no commentary before or after.
${hintLine}
IF the result set contains at least one numeric column, output:
{
  "chartConfig": {
    "type": "bar" | "line" | "pie" | "doughnut" | "scatter",
    "title": "<short descriptive chart title>",
    "labels": ["<label1>", "<label2>", ...],
    "indexAxis": "x",
    "datasets": [
      {
        "label": "<human-readable dataset name>",
        "data": [<number>, ...],
        "backgroundColor": "<hex color OR array of hex colors for pie/doughnut>",
        "borderColor": "<same hex as backgroundColor — REQUIRED for line charts, this is the line color>",
        "borderWidth": 2
      }
    ],
    "xAxisLabel": "<human-readable x-axis label, e.g. 'Artist' or 'Month'>",
    "yAxisLabel": "<human-readable y-axis label, e.g. 'Revenue (USD)' or 'Track Count'>"
  },
  "summary": "<1–2 sentence answer that DIRECTLY addresses the user's question, cites the top result by name and value, and notes a key trend>"
}

EXCEPTION — for SCATTER charts, datasets[0].data MUST be [{x: number, y: number}, ...] pairs,
NOT a flat array. Use the first numeric column as x and the second as y. labels: [] (unused).
Example scatter dataset: {"label": "Track Duration vs Sales", "data": [{"x": 300000, "y": 5}, ...]}

IF the result set contains ONLY text/string columns and NO numeric columns, output:
{
  "chartConfig": { "type": "none" },
  "summary": "<1–2 sentence plain-English description of what the data contains>"
}

Query columns: ${columns.join(', ')}
Contains numeric columns: ${hasNumeric ? 'YES — ' + numericCols.join(', ') : 'NO — all columns are text'}
Sample rows (up to 8):
${sample}

Rules:
- Emit ONLY the JSON object. No other text whatsoever.
- For non-scatter: use the first text/string column as chart labels.
- Use numeric columns as dataset data values. Multiple numeric columns → multiple datasets.
- Do NOT invent fake numeric data. If there are no real numbers in the data, use type "none".
- The summary MUST directly answer the user's original question${originalQuestion ? `: "${originalQuestion}"` : ''}.
  Start with the answer (e.g. "Rock generated the most revenue at $X"), then add a supporting trend.
  Do NOT write generic observations like "the data shows" — be specific and answer-first.
- ${gatekeeperHint ? `YOU MUST use type: "${gatekeeperHint}" — the Gatekeeper has determined this is mandatory.` : 'Choose chart type: bar for comparisons, line for time-series trends, scatter for correlations between two numeric columns, pie/doughnut for ≤8 categories with distinct parts.'}
${horizontalHint}
- ALWAYS set xAxisLabel and yAxisLabel (even for bar charts — these improve business readability).
- For LINE charts: borderColor is the VISIBLE LINE COLOR — always set it to the same value as backgroundColor.
  backgroundColor on line charts is only the area fill (shown only when fill:true), so it should be semi-transparent.
- For SCATTER charts: data must be [{x, y}, ...] pairs — never a flat array.
- Use these dark-theme colors: indigo #6366f1, teal #14b8a6, violet #8b5cf6, amber #f59e0b,
  rose #f43f5e, sky #38bdf8, emerald #10b981, orange #f97316.
- For a single dataset bar chart: one backgroundColor hex string is fine.
- For pie/doughnut: backgroundColor MUST be an array with one distinct color per label.
- For multi-dataset bar/line: use a different color per dataset.
- Keep labels concise (truncate to 20 chars if needed).
`;
}

// ── 4. The Viz Modifier (Adjustment Loop Agent) ───────────────────────────────
// Receives the current chartConfig JSON state and the user's style tweak.
// MUST return ONLY the updated chartConfig object — no data mutations allowed.
export function buildVizModifierSystem(currentVizJson) {
  const currentStr = JSON.stringify(currentVizJson, null, 2);
  const chartType  = currentVizJson?.type ?? 'bar';
  const isLine     = chartType === 'line';

  return `\
You are the Viz Modifier for QueryFlow. Your ONLY job is to apply a user's style tweak
to an existing Chart.js v4 configuration object.

Output ONLY a single, raw JSON object — no markdown fences, no prose, no commentary.

The output must be a complete, updated chartConfig object with the tweak applied.

CURRENT chartConfig (this is your input state):
${currentStr}

${isLine ? `
LINE CHART COLOR GUIDE (critical — read carefully):
- "borderColor" on a dataset = the VISIBLE LINE COLOR (what the user sees as the line).
- "pointBackgroundColor" and "pointBorderColor" = the dot color at data points.
- "backgroundColor" on a dataset = the AREA FILL under the line, shown only when fill:true.
  It is transparent by default and NOT what users see as 'the chart color'.
- When the user asks to change the color of the line/chart, you MUST update:
    datasets[i].borderColor, datasets[i].pointBackgroundColor, datasets[i].pointBorderColor
  Do NOT only change backgroundColor — it will have no visible effect on a line chart.
` : ''}
STRICT RULES — violating any of these is a critical error:
1. You MUST NOT change the "type" field unless the user explicitly asks to change the chart type.
2. You MUST NOT change, add, or remove any values inside "datasets[].data" arrays.
   The data values are immutable — only style properties may change.
3. You MAY change: backgroundColor, borderColor, borderWidth, pointStyle, fill, tension,
   title, xAxisLabel, yAxisLabel, indexAxis, and any Chart.js options/style property.
4. If the user asks to show the chart horizontally / flip axes, set "indexAxis": "y".
5. Emit ONLY the updated chartConfig JSON. No extra keys, no wrapping object, no prose.
6. The output must be valid JSON that can be parsed with JSON.parse().
`;
}

// ── Deterministic Viz-Logic Gatekeeper ────────────────────────────────────────
/**
 * Inspects the SQL result columns/rows and the user's message to determine
 * the mandatory chart type BEFORE sending data to the Visualizer.
 *
 * Rules (in priority order):
 *   1. Explicit user override (pie/doughnut/line/bar mentioned) → honor it.
 *   2. First column contains date/datetime-like strings → enforce 'line'.
 *   3. First column contains categorical strings → enforce 'bar'.
 *   4. No rule matched → return null (let Visualizer decide).
 *
 * @param {string[]} columns – Column name array from SQL result.
 * @param {any[][]}  rows    – Data rows (array-of-arrays).
 * @param {string}   userMsg – The original user message for explicit-override detection.
 * @returns {string|null}  The enforced chart type, or null to let the model decide.
 */
export function applyGatekeeper(columns, rows, userMsg = '') {
  const lowerMsg = userMsg.toLowerCase();

  // ── Override check: explicit user intent ────────────────────────────────────
  const EXPLICIT_TYPES = ['scatter', 'pie', 'doughnut', 'line', 'bar'];
  for (const chartType of EXPLICIT_TYPES) {
    if (lowerMsg.includes(chartType)) {
      console.log(`[Gatekeeper] Explicit override detected → "${chartType}"`);
      return chartType;
    }
  }

  // No rows to inspect → no opinion
  if (!rows || rows.length === 0) return null;

  const firstColValues = rows.map(r => r[0]).filter(v => v != null);

  // ── Scatter rule: correlation keywords + 2+ numeric columns ─────────────────
  // Runs before categorical rule so "correlate duration vs purchases" doesn't
  // get hijacked into a bar chart.
  const SCATTER_WORDS = ['correlat', 'scatter', 'relationship', 'relate', ' vs ', 'versus'];
  if (SCATTER_WORDS.some(w => lowerMsg.includes(w))) {
    const numericColCount = columns.filter((_col, i) =>
      rows.slice(0, 3).some(row => typeof row[i] === 'number')
    ).length;
    if (numericColCount >= 2) {
      console.log('[Gatekeeper] Correlation query with 2+ numeric cols → enforcing "scatter"');
      return 'scatter';
    }
  }

  // ── Temporal rule: date/datetime first column → line chart ──────────────────
  // Matches: YYYY-MM-DD, YYYY-MM, YYYY-MM-DDTHH:mm, epoch-like numbers > 1e9
  const DATE_RE = /^\d{4}-\d{2}(-\d{2}(T[\d:]+)?)?$/;
  const temporalCount = firstColValues.filter(v =>
    typeof v === 'string' && DATE_RE.test(v.toString().trim())
  ).length;

  if (temporalCount > firstColValues.length * 0.6) {
    console.log('[Gatekeeper] Temporal data detected → enforcing "line"');
    return 'line';
  }

  // ── Categorical rule: discrete strings → bar chart ──────────────────────────
  const categoricalCount = firstColValues.filter(v =>
    typeof v === 'string' && !DATE_RE.test(v.toString().trim())
  ).length;

  if (categoricalCount > firstColValues.length * 0.6) {
    console.log('[Gatekeeper] Categorical data detected → enforcing "bar"');
    return 'bar';
  }

  // No rule matched
  return null;
}

// ── Ollama HTTP client ────────────────────────────────────────────────────────
/**
 * Call the local Ollama model with a given system prompt and user content.
 *
 * JSON extraction uses a four-pass strategy, with one automatic retry on
 * complete parse failure:
 *
 *   Pass 1 — Remove <think>…</think> reasoning blocks.
 *   Pass 2 — Strip ``` / ```json markdown fences.
 *   Pass 3 — Attempt direct JSON.parse() on the cleaned string.
 *   Pass 4 — Regex-extract the first balanced {...} block, then parse.
 *
 * If all four passes fail, the request is retried once before throwing.
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @returns {Promise<object>}
 */
export async function callOllama(systemPrompt, userContent) {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   MODEL,
        stream:  false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent  },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error ${res.status}: ${body.slice(0, 300)}`);
    }

    const payload = await res.json();
    const raw     = payload.message?.content ?? '';

    // ── Pass 1: strip <think>…</think> blocks ─────────────────────────────────
    const noThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // ── Pass 2: strip markdown code fences ────────────────────────────────────
    const deFenced = noThink
      .replace(/^```(?:json|xml|text)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    // ── Pass 3: direct parse ───────────────────────────────────────────────────
    try { return JSON.parse(deFenced); } catch { /* fall through */ }

    // ── Pass 4: greedy JSON-block extraction ──────────────────────────────────
    const jsonMatch = deFenced.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
    }

    // All passes failed — log and retry if attempts remain
    console.error(
      `[callOllama] Attempt ${attempt}/${MAX_ATTEMPTS} — all extraction strategies failed.\n` +
      `  Model:  ${MODEL}\n` +
      `  Raw output (first 600 chars):\n` +
      raw.slice(0, 600)
    );

    if (attempt < MAX_ATTEMPTS) {
      console.log('[callOllama] Retrying...');
    }
  }

  throw new Error(
    'The model produced output that could not be parsed after 2 attempts. ' +
    'Try rephrasing your question.'
  );
}
