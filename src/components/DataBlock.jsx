import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown, BarChart2, Table2, Code2,
  Copy, Check, TrendingUp,
} from 'lucide-react';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

// ── Syntax highlighter for SQL ────────────────────────────────────────────────
function highlightSQL(code) {
  const escape = s =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = escape(code);

  const keywords = [
    'SELECT','FROM','WHERE','JOIN','ON','GROUP BY','ORDER BY','LIMIT','AS',
    'AND','OR','IN','NOT','NULL','CASE','WHEN','THEN','ELSE','END',
    'SUM','AVG','COUNT','MAX','MIN','ROUND','DISTINCT','WITH',
    'INNER','LEFT','RIGHT','OUTER','HAVING','BY','ASC','DESC',
  ];
  keywords.forEach(kw => {
    html = html.replace(
      new RegExp(`\\b${kw}\\b`, 'g'),
      `<span class="code-token-keyword">${kw}</span>`,
    );
  });
  html = html.replace(/(--[^\n]*)/g, '<span class="code-token-comment">$1</span>');
  html = html.replace(/\b(\d+)\b(?![^<>]*>)/g, '<span class="code-token-number">$1</span>');
  html = html.replace(/'([^']*)'/g, `<span class="code-token-string">'$1'</span>`);

  return html;
}

// ── SQL Code Block ────────────────────────────────────────────────────────────
function SQLBlock({ code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-lg overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700/60">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          🗄️ SQL Query
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? <Check size={12} className="text-teal-400" /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed font-mono bg-[#0d1117]">
        <code dangerouslySetInnerHTML={{ __html: highlightSQL(code) }} />
      </pre>
    </div>
  );
}

// ── Real Chart.js renderer ────────────────────────────────────────────────────
function ChartRenderer({ chartConfig }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    // Guard: need a valid chartable config
    if (!canvasRef.current || !chartConfig || chartConfig.type === 'none') return;

    // Destroy any previous instance (handles React strict-mode double-fire)
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const isPieLike = chartConfig.type === 'pie' || chartConfig.type === 'doughnut';

    try {
      chartRef.current = new Chart(canvasRef.current, {
        type: chartConfig.type ?? 'bar',
        data: {
          labels:   chartConfig.labels   ?? [],
          datasets: chartConfig.datasets ?? [],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          animation: { duration: 500, easing: 'easeInOutQuart' },
          plugins: {
            legend: {
              display: isPieLike || (chartConfig.datasets?.length ?? 0) > 1,
              labels: { color: '#94a3b8', font: { size: 12 }, padding: 16, boxWidth: 12 },
            },
            title: {
              display:  !!chartConfig.title,
              text:     chartConfig.title ?? '',
              color:    '#e2e8f0',
              font:     { size: 14, weight: 'bold' },
              padding:  { bottom: 12 },
            },
            tooltip: {
              backgroundColor: 'rgba(15,23,42,0.95)',
              titleColor:      '#e2e8f0',
              bodyColor:       '#94a3b8',
              borderColor:     'rgba(100,116,139,0.3)',
              borderWidth:     1,
              padding:         10,
              cornerRadius:    8,
            },
          },
          scales: isPieLike ? {} : {
            x: {
              ticks: { color: '#64748b', font: { size: 11 }, maxRotation: 35 },
              grid:  { color: 'rgba(100,116,139,0.12)' },
            },
            y: {
              ticks:       { color: '#64748b', font: { size: 11 } },
              grid:        { color: 'rgba(100,116,139,0.12)' },
              beginAtZero: true,
            },
          },
        },
      });
    } catch (err) {
      console.error('[ChartRenderer] Failed to create chart:', err.message, chartConfig);
    }

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [chartConfig]);

  return (
    <div className="relative w-full bg-[#0d1117] border border-slate-700/60 rounded-lg overflow-hidden p-4"
         style={{ height: '280px' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Static placeholder (for legacy mock messages) ─────────────────────────────
function ChartPlaceholder() {
  return (
    <div className="relative w-full bg-[#0d1117] border border-slate-700/60 rounded-lg overflow-hidden flex flex-col items-center justify-center gap-4"
         style={{ height: '280px' }}>
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="relative flex items-end gap-3 h-24 px-8 z-10">
        {[65, 42, 88, 31, 72, 55, 38].map((h, i) => (
          <div key={i} className="w-8 rounded-t-sm"
            style={{
              height: `${h}%`,
              background: i === 0 || i === 3
                ? 'linear-gradient(to top, #ef4444, #f87171)'
                : 'linear-gradient(to top, #4f46e5, #818cf8)',
              opacity: 0.7,
            }}
          />
        ))}
      </div>
      <div className="relative z-10 flex flex-col items-center gap-1">
        <div className="flex items-center gap-2 text-indigo-400">
          <BarChart2 size={18} />
          <span className="text-sm font-medium">Sample Data</span>
        </div>
        <p className="text-xs text-slate-500 text-center">Mock message — send a real query to generate a live chart</p>
      </div>
    </div>
  );
}

// ── Data Table ────────────────────────────────────────────────────────────────
function DataTable({ tableData }) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-700/60">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-slate-800/80">
            {tableData.columns.map(col => (
              <th key={col}
                className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-b border-slate-700"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableData.rows.map((row, ri) => (
            <tr key={ri}
              className={`${ri % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/20'} hover:bg-indigo-500/5 transition-colors`}
            >
              {row.map((cell, ci) => (
                <td key={ci}
                  className="px-4 py-2.5 text-slate-300 whitespace-nowrap border-b border-slate-800/60 font-mono text-xs"
                >
                  {typeof cell === 'number' ? (
                    <span className={cell < 4 && ci > 0 ? 'text-amber-400' : 'text-slate-300'}>
                      {Number.isInteger(cell) ? cell.toLocaleString() : cell.toFixed(2)}
                    </span>
                  ) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-700/60 flex items-center justify-between">
        <span className="text-xs text-slate-500">{tableData.rows.length} rows returned</span>
        <button className="text-xs text-teal-400 hover:text-teal-300 transition-colors">
          Export CSV
        </button>
      </div>
    </div>
  );
}

// ── Main DataBlock ────────────────────────────────────────────────────────────
export default function DataBlock({ sql, python, tableData, chartConfig }) {
  // chartConfig.type === 'none' means the Visualizer determined no chart is applicable
  const isTextOnly = chartConfig?.type === 'none';

  const [viewMode,      setViewMode]      = useState(isTextOnly ? 'table' : 'chart');
  const [accordionOpen, setAccordionOpen] = useState(false);

  const rowCount = tableData?.rowCount ?? tableData?.rows?.length ?? 0;
  const colCount = tableData?.columns?.length ?? 0;
  const elapsed  = tableData?.elapsed != null ? `${tableData.elapsed}ms` : null;

  return (
    <div className="w-full space-y-3 animate-fade-in">
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700/50">
          {/* Only show Chart tab when there is real chartable data */}
          {!isTextOnly && (
            <button
              onClick={() => setViewMode('chart')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                viewMode === 'chart'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 size={13} /> Chart
            </button>
          )}
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
              viewMode === 'table'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Table2 size={13} /> Data
          </button>
        </div>

        <div className="flex-1" />

        {/* Stats pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-500/10 border border-teal-500/20 rounded-full">
          <TrendingUp size={11} className="text-teal-400" />
          <span className="text-xs text-teal-400 font-medium">
            {rowCount} rows · {colCount} cols{elapsed ? ` · ${elapsed}` : ''}
          </span>
        </div>
      </div>

      {/* Chart / Table area */}
      <div>
        {viewMode === 'chart' ? (
          // isTextOnly should never reach here (tab is hidden), but guard defensively
          isTextOnly ? null :
          chartConfig
            ? <ChartRenderer chartConfig={chartConfig} />
            : <ChartPlaceholder />
        ) : (
          tableData ? <DataTable tableData={tableData} /> : null
        )}

        {/* No-chart notice: shown above the data table for text-only results */}
        {isTextOnly && (
          <div className="mb-2 flex items-start gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/15 rounded-lg">
            <span className="text-amber-400 text-base leading-none mt-0.5">〽</span>
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <span className="font-semibold text-amber-300">No chart available</span> — this result
              contains only text data. Displaying as a table instead.
            </p>
          </div>
        )}
      </div>

      {/* SQL accordion */}
      {sql && (
        <div className="rounded-lg border border-slate-700/60 overflow-hidden">
          <button
            onClick={() => setAccordionOpen(o => !o)}
            className="flex items-center justify-between w-full px-4 py-3 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Code2 size={14} className="text-indigo-400" />
              <span className="text-sm font-medium text-slate-200">View SQL Query</span>
            </div>
            <div className={`text-slate-500 transition-transform duration-200 ${accordionOpen ? 'rotate-180' : ''}`}>
              <ChevronDown size={16} />
            </div>
          </button>

          {accordionOpen && (
            <div className="p-3 bg-slate-900/50 border-t border-slate-700/60 animate-fade-in">
              <SQLBlock code={sql} />
            </div>
          )}
        </div>
      )}

      {/* Legacy Python block (mock messages only) */}
      {python && !chartConfig && accordionOpen && (
        <div className="rounded-lg border border-slate-700/60 overflow-hidden">
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-700/60">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">🐍 Python / Plotly</span>
          </div>
          <pre className="p-4 overflow-x-auto text-xs leading-relaxed font-mono bg-[#0d1117] text-slate-300">
            {python}
          </pre>
        </div>
      )}
    </div>
  );
}
