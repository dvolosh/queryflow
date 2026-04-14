// ── Sample data matching the ChinookDB schema ─────────────────────────────────

export const SAMPLE_SQL = `SELECT
  g.Name                                     AS genre,
  ROUND(SUM(il.UnitPrice * il.Quantity), 2)  AS total_revenue,
  COUNT(DISTINCT t.TrackId)                  AS track_count
FROM InvoiceLine il
JOIN Track t   ON il.TrackId   = t.TrackId
JOIN Genre g   ON t.GenreId    = g.GenreId
GROUP BY g.GenreId, g.Name
ORDER BY total_revenue DESC
LIMIT 10;`;

// Legacy Python block — kept for backward compat with old mock messages only.
export const SAMPLE_PYTHON = `# Legacy: real pipeline now outputs Chart.js JSON config\n# ChinookDB revenue by genre`;

export const SAMPLE_TABLE_DATA = {
  columns: ['genre', 'total_revenue', 'track_count'],
  rows: [
    ['Rock',              826.65, 1297],
    ['Latin',             382.14,  739],
    ['Metal',             261.36,  374],
    ['Alternative & Punk',241.56,  332],
    ['Jazz',              168.71,  130],
    ['Blues',             132.45,  81 ],
    ['TV Shows',          93.53,   93 ],
    ['Classical',         92.34,   74 ],
    ['R&B/Soul',          60.99,   61 ],
    ['Reggae',            29.70,   58 ],
  ],
  rowCount: 10,
  elapsed: 4,
};

export const SAMPLE_CHART_CONFIG = {
  type: 'bar',
  title: 'Total Revenue by Genre (Top 10)',
  labels: SAMPLE_TABLE_DATA.rows.map(r => r[0]),
  datasets: [
    {
      label: 'Revenue ($)',
      data: SAMPLE_TABLE_DATA.rows.map(r => r[1]),
      backgroundColor: '#6366f1',
    },
    {
      label: 'Track Count',
      data: SAMPLE_TABLE_DATA.rows.map(r => r[2]),
      backgroundColor: '#14b8a6',
    },
  ],
};

export const INITIAL_MESSAGES = [
  {
    id: 'welcome',
    role: 'assistant',
    type: 'text',
    content: "Hello! I'm **QueryFlow**, your AI data analyst. I'm connected to **ChinookDB** — a digital music store with Artists, Albums, Tracks, Genres, Invoices, and Customers. Try asking me:\n\n- *\"Show total revenue by genre\"*\n- *\"Which artists have the most albums?\"*\n- *\"What are the top 5 selling tracks this year?\"*\n- *\"Show me monthly invoice revenue as a line chart\"*",
    timestamp: new Date(Date.now() - 5 * 60000),
  },
  {
    id: '2',
    role: 'user',
    type: 'text',
    content: 'Show me total revenue by genre',
    timestamp: new Date(Date.now() - 4 * 60000),
  },
  {
    id: '3',
    role: 'assistant',
    type: 'data_block',
    content: '**Rock** dominates with $826.65 in revenue across 1,297 tracks — more than double the second-place genre, Latin. Classical and Blues punch above their weight relative to track count.',
    sql:         SAMPLE_SQL,
    tableData:   SAMPLE_TABLE_DATA,
    chartConfig: SAMPLE_CHART_CONFIG,
    vizJson:     SAMPLE_CHART_CONFIG,
    timestamp: new Date(Date.now() - 3 * 60000),
  },
];

export const EXECUTION_STEPS = [
  '🔍 Analyst — evaluating intent...',
  '🗄️  DB Manager — writing SQL...',
  '⚙️  Executing query against ChinookDB...',
  '📊 Visualizer — designing chart...',
  '✅ Rendering results...',
];
