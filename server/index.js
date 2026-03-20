import express from 'express';
import cors from 'cors';
import db from './db.js';

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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] QueryFlow API running at http://localhost:${PORT}`);
  console.log(`[Server] Endpoints: /api/health  /api/tables  /api/query`);
});
