import React, { useState } from 'react';
import {
  ChevronDown, ChevronUp, BarChart2, Table2, Code2, Database,
  Copy, Check, ExternalLink, TrendingUp,
} from 'lucide-react';

// --- Syntax-highlighted code block ---
function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlighted = highlightCode(code, language);

  return (
    <div className="relative group rounded-lg overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {language === 'sql' ? '🗄️ SQL Query' : '🐍 Python / Plotly'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? <Check size={12} className="text-teal-400" /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed font-mono bg-[#0d1117]">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

// Minimal syntax highlighter for SQL and Python
function highlightCode(code, lang) {
  const escape = s => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let html = escape(code);

  if (lang === 'sql') {
    const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP BY', 'ORDER BY',
      'LIMIT', 'AS', 'AND', 'OR', 'IN', 'NOT', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE',
      'END', 'SUM', 'AVG', 'COUNT', 'MAX', 'MIN', 'DATE_SUB', 'CURRENT_DATE', 'INTERVAL',
      'INNER', 'LEFT', 'RIGHT', 'OUTER', 'HAVING', 'DISTINCT', 'WITH', 'CREATE', 'INSERT',
      'UPDATE', 'DELETE', 'SET', 'VALUES', 'INTO', 'BY', 'ASC', 'DESC'];
    keywords.forEach(kw => {
      html = html.replace(new RegExp(`\\b${kw}\\b`, 'g'), `<span class="code-token-keyword">${kw}</span>`);
    });
    html = html.replace(/(--[^\n]*)/g, '<span class="code-token-comment">$1</span>');
    html = html.replace(/\b(\d+)\b(?![^<>]*>)/g, '<span class="code-token-number">$1</span>');
    html = html.replace(/'([^']*)'/g, `<span class="code-token-string">'$1'</span>`);
  } else if (lang === 'python') {
    const keywords = ['import', 'from', 'as', 'def', 'class', 'if', 'else', 'elif',
      'for', 'while', 'return', 'in', 'not', 'and', 'or', 'True', 'False', 'None',
      'lambda', 'with', 'try', 'except', 'finally', 'raise', 'pass', 'break', 'continue'];
    keywords.forEach(kw => {
      html = html.replace(new RegExp(`\\b${kw}\\b`, 'g'), `<span class="code-token-keyword">${kw}</span>`);
    });
    html = html.replace(/(#[^\n]*)/g, '<span class="code-token-comment">$1</span>');
    html = html.replace(/\b(\d+(?:\.\d+)?)\b(?![^<>]*>)/g, '<span class="code-token-number">$1</span>');
    html = html.replace(/"([^"]*)"/g, `<span class="code-token-string">"$1"</span>`);
    html = html.replace(/'([^']*)'/g, `<span class="code-token-string">'$1'</span>`);
  }

  return html;
}

// --- Chart Placeholder ---
function ChartPlaceholder() {
  return (
    <div className="relative w-full aspect-[16/7] rounded-lg bg-[#0d1117] border border-slate-700/60 overflow-hidden flex flex-col items-center justify-center gap-4">
      {/* Decorative grid lines */}
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* Fake bar chart illustration */}
      <div className="relative flex items-end gap-3 h-24 px-8 z-10">
        {[65, 42, 88, 31, 72, 55, 38].map((h, i) => (
          <div
            key={i}
            className="w-8 rounded-t-sm"
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
      <div className="relative z-10 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-indigo-400">
          <BarChart2 size={20} />
          <span className="text-sm font-medium">Interactive Plotly Chart</span>
        </div>
        <p className="text-xs text-slate-500 text-center max-w-xs">
          Rendered chart will appear here when connected to the QueryFlow backend
        </p>
        <button className="mt-1 flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300 transition-colors">
          <ExternalLink size={12} />
          Open in full screen
        </button>
      </div>
    </div>
  );
}

// --- Data Table ---
function DataTable({ tableData }) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-700/60">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-slate-800/80">
            {tableData.columns.map(col => (
              <th
                key={col}
                className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-b border-slate-700"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableData.rows.map((row, ri) => (
            <tr
              key={ri}
              className={`${ri % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/20'} hover:bg-indigo-500/5 transition-colors`}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-4 py-2.5 text-slate-300 whitespace-nowrap border-b border-slate-800/60 font-mono text-xs"
                >
                  {typeof cell === 'number' ? (
                    <span className={`${ci >= 1 && cell < 4 ? 'text-amber-400' : 'text-slate-300'}`}>
                      {typeof cell === 'number' && !Number.isInteger(cell) ? cell.toFixed(1) : cell.toLocaleString()}
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

// --- Main DataBlock component ---
export default function DataBlock({ content, sql, python, tableData }) {
  const [viewMode, setViewMode] = useState('chart'); // 'chart' | 'table'
  const [accordionOpen, setAccordionOpen] = useState(false);

  return (
    <div className="w-full space-y-3 animate-fade-in">
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700/50">
          <button
            onClick={() => setViewMode('chart')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
              viewMode === 'chart'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart2 size={13} />
            Chart
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
              viewMode === 'table'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Table2 size={13} />
            Data
          </button>
        </div>

        <div className="flex-1" />

        {/* Stats pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-500/10 border border-teal-500/20 rounded-full">
          <TrendingUp size={11} className="text-teal-400" />
          <span className="text-xs text-teal-400 font-medium">7 rows · 4 cols · 42ms</span>
        </div>
      </div>

      {/* Chart / Table area */}
      <div>
        {viewMode === 'chart' ? (
          <ChartPlaceholder />
        ) : (
          <DataTable tableData={tableData} />
        )}
      </div>

      {/* View Logic accordion */}
      <div className="rounded-lg border border-slate-700/60 overflow-hidden">
        <button
          onClick={() => setAccordionOpen(o => !o)}
          className="flex items-center justify-between w-full px-4 py-3 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Code2 size={14} className="text-indigo-400" />
            <span className="text-sm font-medium text-slate-200">View Query Logic</span>
            <span className="text-xs text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 ml-1">SQL + Python</span>
          </div>
          <div className={`text-slate-500 transition-transform duration-200 ${accordionOpen ? 'rotate-180' : ''}`}>
            <ChevronDown size={16} />
          </div>
        </button>

        {accordionOpen && (
          <div className="p-3 bg-slate-900/50 border-t border-slate-700/60 space-y-3 animate-fade-in">
            <CodeBlock code={sql} language="sql" />
            <CodeBlock code={python} language="python" />
          </div>
        )}
      </div>
    </div>
  );
}
