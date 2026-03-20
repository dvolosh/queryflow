import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'insights.db');

// Open (or create) the database file
const db = new Database(DB_PATH);

// Enable WAL mode for better read performance
db.pragma('journal_mode = WAL');
// Enforce foreign keys
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS Customers (
    customer_id    INTEGER PRIMARY KEY,
    signup_date    DATE,
    plan_type      VARCHAR(50),
    status         VARCHAR(20),
    last_login_date DATE
  );

  CREATE TABLE IF NOT EXISTS Products (
    product_id INTEGER PRIMARY KEY,
    name       VARCHAR(100),
    category   VARCHAR(50),
    price      DECIMAL(10,2)
  );

  CREATE TABLE IF NOT EXISTS Reviews (
    review_id   INTEGER PRIMARY KEY,
    customer_id INTEGER,
    product_id  INTEGER,
    rating      INTEGER CHECK(rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    FOREIGN KEY (product_id)  REFERENCES Products(product_id)
  );

  CREATE TABLE IF NOT EXISTS Sales (
    sale_id     INTEGER PRIMARY KEY,
    customer_id INTEGER,
    product_id  INTEGER,
    amount      DECIMAL(10,2),
    sale_date   DATE,
    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    FOREIGN KEY (product_id)  REFERENCES Products(product_id)
  );
`);

// ── Seed (only if tables are empty) ─────────────────────────────────────────

function isEmpty(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0;
}

const seed = db.transaction(() => {
  // ── Products ──────────────────────────────────────────────────────────────
  if (isEmpty('Products')) {
    const insertProduct = db.prepare(
      `INSERT INTO Products (product_id, name, category, price) VALUES (?, ?, ?, ?)`
    );
    const products = [
      [1,  'ProSound Headphones',    'Electronics', 199.99],
      [2,  'UltraWatch v2',          'Electronics', 299.00],
      [3,  'ErgoDesk',               'Furniture',   450.00],
      [4,  'Basic Earbuds',          'Electronics',  29.99],
      [5,  'SmartSpeaker Pro',       'Electronics', 149.99],
      [6,  'MechKey 650',            'Electronics', 129.00],
      [7,  'LuxChair Executive',     'Furniture',   699.00],
      [8,  'AirPurifier X3',         'Home',         89.99],
      [9,  'FoamMattress Queen',     'Home',        399.00],
      [10, 'Noiseless Webcam 4K',   'Electronics',  79.99],
    ];
    for (const p of products) insertProduct.run(...p);
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  if (isEmpty('Customers')) {
    const insertCustomer = db.prepare(
      `INSERT INTO Customers (customer_id, signup_date, plan_type, status, last_login_date)
       VALUES (?, ?, ?, ?, ?)`
    );
    const customers = [
      // Active power users
      [101, '2025-01-10', 'Enterprise', 'Active',  '2026-03-18'],
      [102, '2025-05-20', 'Pro',        'Active',  '2026-03-15'],
      [105, '2025-03-15', 'Enterprise', 'Active',  '2026-03-17'],
      [106, '2025-06-01', 'Pro',        'Active',  '2026-03-10'],
      [107, '2025-07-22', 'Pro',        'Active',  '2026-03-19'],
      [108, '2025-09-30', 'Free',       'Active',  '2026-03-12'],
      [109, '2025-10-05', 'Enterprise', 'Active',  '2026-03-16'],
      [110, '2026-01-20', 'Free',       'Active',  '2026-03-14'],
      // Churned customers
      [103, '2025-11-12', 'Free',       'Churned', '2026-01-05'],
      [111, '2025-04-01', 'Pro',        'Churned', '2025-12-20'],
      [112, '2025-08-14', 'Free',       'Churned', '2026-01-18'],
      [113, '2025-02-28', 'Enterprise', 'Churned', '2025-11-30'],
      // At-Risk customers
      [104, '2026-02-01', 'Pro',        'At-Risk', '2026-02-14'],
      [114, '2025-12-10', 'Pro',        'At-Risk', '2026-02-20'],
      [115, '2025-09-01', 'Free',       'At-Risk', '2026-02-05'],
    ];
    for (const c of customers) insertCustomer.run(...c);
  }

  // ── Sales ─────────────────────────────────────────────────────────────────
  if (isEmpty('Sales')) {
    const insertSale = db.prepare(
      `INSERT INTO Sales (sale_id, customer_id, product_id, amount, sale_date)
       VALUES (?, ?, ?, ?, ?)`
    );
    const sales = [
      [501, 101, 1,  199.99, '2026-01-15'],
      [502, 101, 3,  450.00, '2026-02-10'],
      [503, 102, 2,  299.00, '2026-03-01'],
      [504, 104, 1,  199.99, '2026-02-05'],
      [505, 105, 7,  699.00, '2026-01-20'],
      [506, 105, 9,  399.00, '2026-02-28'],
      [507, 106, 5,  149.99, '2026-03-05'],
      [508, 106, 6,  129.00, '2026-02-15'],
      [509, 107, 10,  79.99, '2026-03-10'],
      [510, 107, 1,  199.99, '2026-03-12'],
      [511, 108, 4,   29.99, '2026-01-30'],
      [512, 109, 2,  299.00, '2026-02-22'],
      [513, 109, 5,  149.99, '2026-03-01'],
      [514, 110, 8,   89.99, '2026-03-15'],
      [515, 111, 3,  450.00, '2025-11-10'],
      [516, 112, 4,   29.99, '2025-12-01'],
      [517, 113, 7,  699.00, '2025-10-15'],
      [518, 114, 2,  299.00, '2026-01-05'],
      [519, 115, 8,   89.99, '2026-01-22'],
      [520, 101, 6,  129.00, '2026-03-08'],
    ];
    for (const s of sales) insertSale.run(...s);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  if (isEmpty('Reviews')) {
    const insertReview = db.prepare(
      `INSERT INTO Reviews (review_id, customer_id, product_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const reviews = [
      // ProSound Headphones (product 1) — mixed
      [1,  101, 1, 5, 'Best headphones I have ever owned. Super clear sound!',              '2026-01-20 10:00:00'],
      [2,  104, 1, 1, 'The battery died after two days. Extremely disappointing.',           '2026-02-10 14:30:00'],
      [3,  107, 1, 4, 'Great audio quality, but the ear cushions wear out quickly.',        '2026-03-13 08:00:00'],
      // UltraWatch v2 (product 2) — mostly positive
      [4,  102, 2, 4, 'Great watch, but the strap is a bit stiff.',                         '2026-03-05 09:15:00'],
      [5,  109, 2, 5, 'Absolutely love this watch. Tracks everything perfectly.',           '2026-02-25 11:00:00'],
      [6,  114, 2, 3, 'Looks nice but the battery only lasts about a day.',                 '2026-01-08 16:45:00'],
      // ErgoDesk (product 3) — love it or hate it
      [7,  105, 3, 5, 'The ErgoDesk changed my work-from-home life. Worth every penny.',   '2026-01-25 13:00:00'],
      [8,  111, 3, 2, 'Assembly instructions were terrible. Took hours and still wobbles.', '2025-11-15 18:30:00'],
      // Basic Earbuds (product 4) — low expectations, so-so
      [9,  103, 4, 2, 'You get what you pay for. Very basic and muddy sound.',              '2025-12-15 11:00:00'],
      [10, 112, 4, 3, 'Decent for the price. Nothing special.',                             '2025-12-05 10:00:00'],
      [11, 108, 4, 1, 'Broke after a week. Total waste of money.',                         '2026-02-02 09:00:00'],
      // SmartSpeaker Pro (product 5)
      [12, 106, 5, 5, 'Crystal clear sound and the smart features are actually useful.',    '2026-03-06 14:00:00'],
      [13, 109, 5, 4, 'Really good speaker. Alexa integration works flawlessly.',           '2026-03-03 10:30:00'],
      // MechKey 650 (product 6)
      [14, 106, 6, 5, 'Best mechanical keyboard I have used. Clicky and satisfying.',       '2026-02-17 12:00:00'],
      [15, 101, 6, 4, 'Great build quality but a bit loud for an office.',                  '2026-03-09 15:00:00'],
      // LuxChair Executive (product 7)
      [16, 105, 7, 5, 'Incredibly comfortable. My back pain is gone.',                      '2026-01-22 09:00:00'],
      [17, 113, 7, 1, 'Arrived damaged. Customer service was no help at all.',              '2025-10-20 17:00:00'],
      // AirPurifier X3 (product 8)
      [18, 114, 8, 3, 'Works fine but filter replacement costs are high.',                  '2026-01-10 11:00:00'],
      [19, 115, 8, 4, 'Noticeably cleaner air. A bit noisy on high setting though.',        '2026-01-24 08:45:00'],
      // FoamMattress Queen (product 9)
      [20, 105, 9, 5, 'Slept better than I have in years. No motion transfer at all.',      '2026-03-01 20:00:00'],
      // NoiselessWebcam 4K (product 10)
      [21, 107, 10, 4, 'Sharp image and easy setup. Slight delay in low light.',            '2026-03-11 10:00:00'],
    ];
    for (const r of reviews) insertReview.run(...r);
  }
});

seed();

console.log(`[DB] InsightsDB ready at ${DB_PATH}`);

export default db;
