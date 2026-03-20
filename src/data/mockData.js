// Shared mock data for QueryFlow chat UI demo
export const SAMPLE_SQL = `SELECT
  r.product_category,
  AVG(r.star_rating)          AS avg_rating,
  COUNT(r.review_id)          AS review_count,
  SUM(CASE WHEN r.star_rating <= 2 THEN 1 ELSE 0 END) AS neg_reviews
FROM reviews r
JOIN products p ON r.product_id = p.id
WHERE p.launched_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY r.product_category
ORDER BY neg_reviews DESC
LIMIT 20;`;

export const SAMPLE_PYTHON = `import pandas as pd
import plotly.express as px

# df is injected by QueryFlow runtime
fig = px.bar(
    df,
    x="product_category",
    y="neg_reviews",
    color="avg_rating",
    color_continuous_scale="RdYlGn",
    labels={
        "product_category": "Category",
        "neg_reviews": "Negative Reviews",
        "avg_rating": "Avg Rating",
    },
    title="Negative Reviews by Category (Last 90 Days)",
    template="plotly_dark",
)
fig.update_layout(
    plot_bgcolor="rgba(0,0,0,0)",
    paper_bgcolor="rgba(0,0,0,0)",
    font_color="#e2e8f0",
)
fig.show()`;

export const SAMPLE_TABLE_DATA = {
  columns: ['product_category', 'avg_rating', 'review_count', 'neg_reviews'],
  rows: [
    ['Electronics', 3.2, 1420, 312],
    ['Home & Garden', 3.8, 890, 198],
    ['Sports', 4.1, 654, 87],
    ['Clothing', 3.5, 2100, 420],
    ['Books', 4.6, 330, 22],
    ['Toys', 3.9, 445, 91],
    ['Beauty', 4.2, 780, 67],
  ],
};

export const INITIAL_MESSAGES = [
  {
    id: '1',
    role: 'assistant',
    type: 'text',
    content: "Hello! I'm **QueryFlow**, your AI data analyst. I'm connected to your product database and ready to help you uncover insights. Try asking me something like:\n\n- *\"What features do 1-star reviews mention most?\"*\n- *\"Show me revenue trends by category this quarter\"*\n- *\"Which products have the highest return rates?\"*",
    timestamp: new Date(Date.now() - 5 * 60000),
  },
  {
    id: '2',
    role: 'user',
    type: 'text',
    content: 'Show me which product categories have the most negative reviews in the last 90 days.',
    timestamp: new Date(Date.now() - 4 * 60000),
  },
  {
    id: '3',
    role: 'assistant',
    type: 'data_block',
    content: 'Here are the product categories ranked by negative review count over the last 90 days. **Clothing** and **Electronics** stand out with the highest volume of reviews rated 2 stars or below.',
    sql: SAMPLE_SQL,
    python: SAMPLE_PYTHON,
    tableData: SAMPLE_TABLE_DATA,
    timestamp: new Date(Date.now() - 3 * 60000),
  },
  {
    id: '4',
    role: 'user',
    type: 'text',
    content: 'What features do the most negative reviews mention?',
    timestamp: new Date(Date.now() - 2 * 60000),
  },
  {
    id: '5',
    role: 'assistant',
    type: 'ambiguity',
    content: 'I want to make sure I surface the most relevant insights. When you say **"most negative"**, do you mean:',
    clarificationOptions: [
      { id: 'a', label: '1-star reviews only', icon: '⭐' },
      { id: 'b', label: '1 & 2-star reviews', icon: '📉' },
      { id: 'c', label: 'Sentiment score < –0.5', icon: '🤖' },
      { id: 'd', label: 'Any negative keyword', icon: '🔍' },
    ],
    timestamp: new Date(Date.now() - 1 * 60000),
  },
];

export const CHAT_HISTORY = [
  { id: 'h1', title: 'Negative Review Categories', preview: '90-day category breakdown', date: 'Today', active: true },
  { id: 'h2', title: 'Revenue by Region Q1', preview: 'Bar chart & table view', date: 'Today', active: false },
  { id: 'h3', title: 'Churn Prediction Factors', preview: 'ML feature importance', date: 'Yesterday', active: false },
  { id: 'h4', title: 'Top SKUs by Return Rate', preview: 'Electronics top offenders', date: 'Yesterday', active: false },
  { id: 'h5', title: 'Monthly Active Users', preview: 'Growth trend since Jan', date: 'Mar 17', active: false },
  { id: 'h6', title: 'Inventory Turnover Ratio', preview: 'Supply chain analysis', date: 'Mar 15', active: false },
  { id: 'h7', title: 'Customer LTV Cohorts', preview: 'Retention & monetization', date: 'Mar 12', active: false },
];

export const EXECUTION_STEPS = [
  'Parsing query...',
  'Generating SQL...',
  'Executing SQL...',
  'Fetching results...',
  'Generating visualization...',
  'Rendering chart...',
];
