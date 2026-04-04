/**
 * QueryFlow — Multi-Agent Definitions
 *
 * Three sequential agents, each given a different system prompt
 * to force the single qwen3.5:latest model into a specific "mode":
 *
 *   1. Analyst      → ambiguity resolution / intent refinement
 *   2. DB Manager   → SQL generation
 *   3. Visualizer   → Chart.js config generation
 */

const OLLAMA_BASE = 'http://localhost:11434';
const MODEL       = 'qwen3.5:latest';

// ── 1. The Analyst ────────────────────────────────────────────────────────────
// Receives the raw user question.
// Outputs strict JSON: either ambiguity chips OR a refined technical intent.
export const ANALYST_SYSTEM = `\
You are the Analyst for QueryFlow, an AI data-analytics assistant.
Your only job is to evaluate the user's natural-language question and decide what action to take.

Output ONLY a single, raw JSON object — no markdown fences, no prose, no commentary before or after.

If the user wants a DIFFERENT CHART or DIFFERENT VISUALIZATION of data already shown
(e.g. "different chart", "different visualization", "show as pie", "use a line chart", "hard to read"):
{
  "type": "revisualize",
  "chartHint": "<one of: bar | line | pie | doughnut — or empty string if unspecified>"
}

If the user message is a vague retry with no new information
(e.g. "try again", "retry", "do it again", "fix it", "repeat"):
{
  "type": "error_followup",
  "message": "I'm not sure what to retry. Could you rephrase your original question?"
}

If the question is too vague and needs disambiguation
(e.g. "most negative", "best", "recent" without a timeframe, "top" without a metric):
{
  "type": "ambiguity",
  "message": "<One clear sentence asking what the user means>",
  "options": [
    { "id": "a", "label": "<short option>", "icon": "<one emoji>" },
    { "id": "b", "label": "<short option>", "icon": "<one emoji>" },
    { "id": "c", "label": "<short option>", "icon": "<one emoji>" }
  ]
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

InsightsDB schema (the ONLY tables and columns you may reference):
${schemaStr}

Rules:
- Emit ONLY the JSON object. No other text whatsoever.
- Use ONLY SELECT or WITH statements. Never UPDATE, DELETE, INSERT, DROP, or CREATE.
- Reference ONLY tables and columns that appear in the schema above.
- Use JOINs over subqueries where possible for clarity.
- Use ROUND(value, 2) for decimal results. Use descriptive column aliases.
- Always include LIMIT when the result could be large (default LIMIT 50).
- When fetching text content (e.g. review comments, names), ALWAYS include a human-readable
  identifier alongside it (e.g. product name, customer_id, rating) so results have context.
  Never return a single bare text column.
`;
}

// ── 3. The Visualizer ─────────────────────────────────────────────────────────
// Receives column names + all data rows.
// Outputs strict JSON: Chart.js config + a short summary sentence.
export function buildVisualizerSystem(columns, rows) {
  const sample = JSON.stringify(rows.slice(0, 8), null, 2);

  // Detect if there are any numeric columns in the result set
  const numericCols = columns.filter((_col, i) =>
    rows.slice(0, 5).some(row => typeof row[i] === 'number')
  );
  const hasNumeric = numericCols.length > 0;

  return `\
You are the Visualizer for QueryFlow. You are a data-visualization expert.
Your only job is to design a Chart.js v4 chart configuration for the query result below, OR
declare that the data is not chartable.

Output ONLY a single, raw JSON object — no markdown fences, no prose, no commentary before or after.

IF the result set contains at least one numeric column, output a chart:
{
  "chartConfig": {
    "type": "bar" | "line" | "pie" | "doughnut",
    "title": "<short descriptive chart title>",
    "labels": ["<label1>", "<label2>", ...],
    "datasets": [
      {
        "label": "<dataset name>",
        "data": [<number>, ...],
        "backgroundColor": "<single hex/rgba string OR array of hex/rgba strings>"
      }
    ]
  },
  "summary": "<1–2 sentence plain-English insight about what this data shows>"
}

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
- Use the first text/string column as chart labels.
- Use numeric columns as dataset data values. Multiple numeric columns → multiple datasets.
- Do NOT invent fake numeric data (e.g. assigning frequency=1 to every text row). If there are
  no real numbers in the data, use type "none".
- Choose chart type: bar for comparisons, line for time-series trends, pie/doughnut for ≤8 categories.
- Use these dark-theme colors: indigo #6366f1, teal #14b8a6, violet #8b5cf6, amber #f59e0b,
  rose #f43f5e, sky #38bdf8, emerald #10b981, orange #f97316.
- For a single dataset bar/line chart, backgroundColor may be one color string.
- For pie/doughnut, backgroundColor must be an array with one color per label.
`;
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
        think:   false,
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
