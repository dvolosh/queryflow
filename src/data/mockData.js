// ── Sample data matching the real InsightsDB schema ──────────────────────────

export const SAMPLE_SQL = `SELECT
  p.name                                   AS product_name,
  ROUND(AVG(r.rating), 2)                  AS avg_rating,
  COUNT(r.review_id)                       AS review_count,
  SUM(CASE WHEN r.rating <= 2 THEN 1 ELSE 0 END) AS negative_reviews
FROM Reviews r
JOIN Products p ON r.product_id = p.product_id
GROUP BY p.product_id, p.name
ORDER BY negative_reviews DESC
LIMIT 10;`;

// Legacy Python block — kept for backward compat with old mock messages only.
// New messages from the real pipeline use chartConfig instead.
export const SAMPLE_PYTHON = `# Legacy: real pipeline now outputs Chart.js JSON config\nimport plotly.express as px\nfig = px.bar(df, x="product_name", y="negative_reviews")\nfig.show()`;

export const SAMPLE_TABLE_DATA = {
  columns: ['product_name', 'avg_rating', 'review_count', 'negative_reviews'],
  rows: [
    ['Basic Earbuds',         1.33, 3, 2],
    ['LuxChair Executive',    3.00, 2, 1],
    ['ProSound Headphones',   3.33, 3, 1],
    ['ErgoDesk',              3.50, 2, 1],
    ['AirPurifier X3',        3.50, 2, 0],
    ['UltraWatch v2',         4.00, 3, 0],
    ['SmartSpeaker Pro',      4.50, 2, 0],
    ['MechKey 650',           4.50, 2, 0],
  ],
  rowCount: 8,
  elapsed: 3,
};

// Chart.js config for the sample data above — renders a real chart in DataBlock
export const SAMPLE_CHART_CONFIG = {
  type: 'bar',
  title: 'Negative Reviews by Product',
  labels: SAMPLE_TABLE_DATA.rows.map(r => r[0]),
  datasets: [
    {
      label: 'Negative Reviews (≤ 2 stars)',
      data: SAMPLE_TABLE_DATA.rows.map(r => r[3]),
      backgroundColor: '#f43f5e',
    },
    {
      label: 'Avg Rating',
      data: SAMPLE_TABLE_DATA.rows.map(r => r[1]),
      backgroundColor: '#6366f1',
    },
  ],
};

export const INITIAL_MESSAGES = [
  {
    id: '1',
    role: 'assistant',
    type: 'text',
    content: "Hello! I'm **QueryFlow**, your AI data analyst. I'm connected to **InsightsDB** — a database of customers, products, reviews, and sales. Try asking me:\n\n- *\"Which products have the most negative reviews?\"*\n- *\"Show me total revenue per product category\"*\n- *\"Who are our churned Enterprise customers?\"*",
    timestamp: new Date(Date.now() - 5 * 60000),
  },
  {
    id: '2',
    role: 'user',
    type: 'text',
    content: 'Which products have the most negative reviews?',
    timestamp: new Date(Date.now() - 4 * 60000),
  },
  {
    id: '3',
    role: 'assistant',
    type: 'data_block',
    content: '**Basic Earbuds** and **LuxChair Executive** top the list for negative reviews. Basic Earbuds has an average rating of 1.33 — well below acceptable. The chart groups negative reviews (≤ 2 stars) alongside average rating per product.',
    sql:         SAMPLE_SQL,
    tableData:   SAMPLE_TABLE_DATA,
    chartConfig: SAMPLE_CHART_CONFIG,
    timestamp: new Date(Date.now() - 3 * 60000),
  },
  {
    id: '4',
    role: 'user',
    type: 'text',
    content: 'What do the most negative reviews actually say?',
    timestamp: new Date(Date.now() - 2 * 60000),
  },
  {
    id: '5',
    role: 'assistant',
    type: 'ambiguity',
    content: 'I want to make sure I surface the most relevant reviews. When you say **"most negative"**, do you mean:',
    clarificationOptions: [
      { id: 'a', label: '1-star reviews only',   icon: '⭐' },
      { id: 'b', label: '1 & 2-star reviews',    icon: '📉' },
      { id: 'c', label: 'Lowest-rated product',   icon: '🔍' },
    ],
    timestamp: new Date(Date.now() - 1 * 60000),
  },
];


export const EXECUTION_STEPS = [
  '🔍 Analyst — evaluating intent...',
  '🗄️  DB Manager — writing SQL...',
  '⚙️  Executing query against InsightsDB...',
  '📊 Visualizer — designing chart...',
  '✅ Rendering results...',
];
