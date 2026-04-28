import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronDown, BarChart2, Table2, Code2,
  Copy, Check, TrendingUp, Wand2, Loader2,
  Download, Maximize2, Minimize2, FlipHorizontal, Sun, Moon,
} from 'lucide-react';
import { Chart, registerables } from 'chart.js';
import { BoxPlotController, BoxAndWiskers } from '@sgratzl/chartjs-chart-boxplot';
import { adjustViz } from '../data/api';
Chart.register(...registerables, BoxPlotController, BoxAndWiskers);

// ── Syntax highlighter for SQL ────────────────────────────────────────────────
function highlightSQL(code) {
  const escape = s =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = escape(code);

  const keywords = [
    'SELECT','FROM','WHERE','JOIN','ON','GROUP BY','ORDER BY','LIMIT','AS',
    'AND','OR','IN','NOT','NULL','CASE','WHEN','THEN','ELSE','END',
    'SUM','AVG','COUNT','MAX','MIN','ROUND','DISTINCT','WITH',
    'INNER','LEFT','RIGHT','OUTER','HAVING','BY','ASC','DESC','OVER','PARTITION',
    'strftime',
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
// Keyed externally so a new vizJson always produces a fresh canvas instance.

/**
 * Normalise AI-generated datasets before handing them to Chart.js.
 *
 * Key fixes:
 *  - LINE charts: the visual line is drawn using `borderColor`, not `backgroundColor`.
 *    The AI reliably outputs `backgroundColor` but often omits `borderColor`,
 *    so we copy backgroundColor → borderColor so color tweaks actually show.
 *  - `backgroundColor` on a line chart only fills the area under the curve
 *    (only visible when `fill:true`). We default it to transparent so the area
 *    isn’t filled unless the model explicitly enables it.
 */
function normaliseDatasets(chartType, datasets = []) {
  const isLine    = chartType === 'line';
  const isScatter = chartType === 'scatter';
  const isBoxplot = chartType === 'boxplot';

  return datasets.map(ds => {
    // Resolve whichever color the model provided
    const bg = Array.isArray(ds.backgroundColor)
      ? ds.backgroundColor[0]
      : ds.backgroundColor;

    if (isLine) {
      // For line charts: borderColor is the VISIBLE LINE, bg is the area fill.
      const lineColor = ds.borderColor ?? bg ?? '#6366f1';
      return {
        fill: false,
        ...ds,
        tension:              0.35,
        pointRadius:          0,
        pointHoverRadius:     5,
        borderWidth:          ds.borderWidth ?? 2,
        borderColor:          lineColor,
        pointBackgroundColor: lineColor,
        pointBorderColor:     lineColor,
        backgroundColor:      ds.fill ? (bg ?? 'rgba(99,102,241,0.15)') : 'transparent',
      };
    }

    if (isScatter) {
      // Scatter data is [{x, y}, ...] — leave data untouched, just clean up styling.
      const color = ds.borderColor ?? bg ?? '#6366f1';
      return {
        ...ds,
        pointRadius:          ds.pointRadius      ?? 5,
        pointHoverRadius:     ds.pointHoverRadius ?? 8,
        borderColor:          color,
        // Semi-transparent fill so dots are visible without being too heavy
        backgroundColor:      bg ? (bg + 'cc') : (color + 'cc'),
      };
    }

    if (isBoxplot) {
      // chartjs-chart-boxplot uses its own set of visual properties.
      // A solid opaque fill makes the box look like a plain rectangle —
      // use a semi-transparent fill so the whiskers and median are legible.
      const solidColor = (typeof bg === 'string' && bg) ? bg : '#6366f1';
      // Strip alpha if hex already has 8 chars, then append 55 (~33% opacity)
      const baseHex    = solidColor.length === 9 ? solidColor.slice(0, 7) : solidColor;
      return {
        ...ds,
        backgroundColor:  baseHex + '55',   // box fill — semi-transparent
        borderColor:      baseHex,           // box outline + whisker lines
        borderWidth:      ds.borderWidth   ?? 2,
        medianColor:      '#f8fafc',         // white median line — always visible
        outlierRadius:    ds.outlierRadius  ?? 4,
        outlierColor:     baseHex,
        meanRadius:       0,                 // hide mean dot by default
        itemRadius:       0,                 // hide individual data points
      };
    }

    // For bar / pie / doughnut — pass through unchanged
    return ds;
  });
}

function ChartRenderer({ chartConfig, height = 280, lightBg = false }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  // Derive theme-aware colors from the lightBg flag
  const T = lightBg ? {
    bg:          '#ffffff',
    border:      'rgba(0,0,0,0.08)',
    tickColor:   '#6b7280',
    gridColor:   'rgba(0,0,0,0.07)',
    legendColor: '#374151',
    titleColor:  '#111827',
    tooltipBg:   'rgba(255,255,255,0.97)',
    tooltipTitle:'#111827',
    tooltipBody: '#4b5563',
    tooltipBorder:'rgba(0,0,0,0.12)',
  } : {
    bg:          '#0d1117',
    border:      'rgba(100,116,139,0.3)',
    tickColor:   '#64748b',
    gridColor:   'rgba(100,116,139,0.12)',
    legendColor: '#94a3b8',
    titleColor:  '#e2e8f0',
    tooltipBg:   'rgba(15,23,42,0.95)',
    tooltipTitle:'#e2e8f0',
    tooltipBody: '#94a3b8',
    tooltipBorder:'rgba(100,116,139,0.3)',
  };

  useEffect(() => {
    if (!canvasRef.current || !chartConfig || chartConfig.type === 'none') return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const chartType    = chartConfig.type ?? 'bar';
    const isPieLike    = chartType === 'pie' || chartType === 'doughnut';
    const isScatter    = chartType === 'scatter';
    const isBoxplot    = chartType === 'boxplot';
    const rawDatasets  = chartConfig.datasets ?? [];
    const datasets     = normaliseDatasets(chartType, rawDatasets);
    const indexAxis    = chartConfig.indexAxis ?? 'x';
    const isHorizontal = indexAxis === 'y';

    // Scatter has continuous numeric axes; disable beginAtZero so points aren't crowded
    const xBeginZero = !isScatter;
    const yBeginZero = !isScatter;

    try {
      chartRef.current = new Chart(canvasRef.current, {
        type: chartType,
        data: {
          labels:   isScatter ? undefined : (chartConfig.labels ?? []),
          datasets,
        },
        options: {
          indexAxis,
          responsive:          true,
          maintainAspectRatio: false,
          animation: { duration: 500, easing: 'easeInOutQuart' },
          plugins: {
            legend: {
              display: isPieLike || isScatter || isBoxplot || datasets.length > 1,
              labels: { color: T.legendColor, font: { size: 12 }, padding: 16, boxWidth: 12 },
            },
            title: {
              display:  !!chartConfig.title,
              text:     chartConfig.title ?? '',
              color:    T.titleColor,
              font:     { size: 14, weight: 'bold' },
              padding:  { bottom: 12 },
            },
            tooltip: {
              backgroundColor: T.tooltipBg,
              titleColor:      T.tooltipTitle,
              bodyColor:       T.tooltipBody,
              borderColor:     T.tooltipBorder,
              borderWidth:     1,
              padding:         10,
              cornerRadius:    8,
            },
          },
          scales: isPieLike ? {} : {
            x: {
              type:        isScatter ? 'linear' : (isHorizontal ? 'linear' : 'category'),
              ...(isBoxplot ? {} : { beginAtZero: xBeginZero }),
              ticks: { color: T.tickColor, font: { size: 11 }, maxRotation: isHorizontal ? 0 : 35 },
              grid:  { color: T.gridColor },
              title: chartConfig.xAxisLabel ? {
                display: true,
                text:    chartConfig.xAxisLabel,
                color:   T.tickColor,
                font:    { size: 11, weight: '500' },
                padding: { top: 8 },
              } : { display: false },
            },
            y: {
              type:        isScatter ? 'linear' : (isHorizontal ? 'category' : 'linear'),
              // For boxplots, don't force beginAtZero — let Chart.js pick a sensible
              // range so the box and whiskers fill the axis nicely.
              ...(isBoxplot ? {} : { beginAtZero: yBeginZero }),
              ticks:       { color: T.tickColor, font: { size: 11 } },
              grid:        { color: T.gridColor },
              title: chartConfig.yAxisLabel ? {
                display: true,
                text:    chartConfig.yAxisLabel,
                color:   T.tickColor,
                font:    { size: 11, weight: '500' },
                padding: { bottom: 8 },
              } : { display: false },
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
  }, [chartConfig, height, lightBg]);

  return (
    <div className="relative w-full border border-slate-700/60 rounded-lg overflow-hidden p-4 transition-colors duration-200"
         style={{ height: `${height}px`, background: T.bg }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Static placeholder (for legacy mock messages without chartConfig) ──────────
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
                    <span className="text-slate-300">
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

// ── Viz Tweak Bar (all quick actions are instant client-side — no LLM calls) ──
function VizTweakBar({
  onApply, onExportPng, onFlip, onThemeToggle, onToggleExpand,
  isAdjusting, expanded, lightBg, vizJson,
}) {
  const [tweak, setTweak] = useState('');
  const chartType = vizJson?.type ?? 'bar';
  const isBar     = chartType === 'bar';

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = tweak.trim();
    if (!trimmed || isAdjusting) return;
    onApply(trimmed);
    setTweak('');
  };

  // Shared button base styles
  const btn = 'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-all border';
  const btnDefault = `${btn} bg-slate-800 hover:bg-slate-700 border-slate-700/50 hover:border-indigo-500/40 text-slate-400 hover:text-slate-200`;
  const btnActive  = `${btn} bg-indigo-600/20 border-indigo-500/50 text-indigo-300`;

  return (
    <div className="space-y-2 mt-2">
      {/* Quick-action toolbar — instant, no API round-trips */}
      <div className="flex items-center gap-1.5 flex-wrap">

        {/* Flip axes — bar charts only */}
        {isBar && (
          <button type="button" onClick={onFlip}
            title={vizJson?.indexAxis === 'y' ? 'Switch to vertical bars' : 'Switch to horizontal bars'}
            className={vizJson?.indexAxis === 'y' ? btnActive : btnDefault}>
            <FlipHorizontal size={11} />
            {vizJson?.indexAxis === 'y' ? 'Vertical' : 'Horizontal'}
          </button>
        )}

        {/* Light / dark background */}
        <button type="button" onClick={onThemeToggle}
          title={lightBg ? 'Switch to dark background' : 'Switch to white background'}
          className={lightBg ? btnActive : btnDefault}>
          {lightBg ? <Moon size={11} /> : <Sun size={11} />}
          {lightBg ? 'Dark' : 'Light'}
        </button>

        <div className="flex-1" />

        {/* Height toggle */}
        <button type="button" onClick={onToggleExpand}
          title={expanded ? 'Compact chart' : 'Expand chart'}
          className={expanded ? btnActive : btnDefault}>
          {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          {expanded ? 'Compact' : 'Expand'}
        </button>

        {/* PNG export */}
        <button type="button" onClick={onExportPng}
          title="Save chart as PNG"
          className={btnDefault}>
          <Download size={11} />
          PNG
        </button>
      </div>

      {/* Free-text tweak — LLM-powered for colour/style changes */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 px-1">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-lg focus-within:border-indigo-500/60 transition-colors">
          <Wand2 size={13} className="text-indigo-400 flex-shrink-0" />
          <input
            type="text"
            value={tweak}
            onChange={e => setTweak(e.target.value)}
            placeholder='Style tweak… e.g. "Make bars teal" or "Change line color to rose"'
            disabled={isAdjusting}
            className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!tweak.trim() || isAdjusting}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {isAdjusting
            ? <><Loader2 size={12} className="animate-spin" /> Applying…</>
            : <><Wand2 size={12} /> Apply</>
          }
        </button>
      </form>
    </div>
  );
}

/**
 * Renders a rich data block: chart (with stateful viz tweaking), table, and SQL accordion.
 *
 * Props:
 *   sql         — the SQL query string
 *   tableData   — { columns, rows, rowCount, elapsed }
 *   chartConfig — initial Chart.js config from the AI (used as seed for vizJson state)
 *   vizJson     — (optional) persisted viz state; if present, takes priority over chartConfig
 *   onVizUpdate — callback(newVizJson) invoked when the user applies a style tweak,
 *                 so the parent can persist the updated state
 */
export default function DataBlock({ sql, tableData, chartConfig, vizJson: vizJsonProp, onVizUpdate }) {
  // vizJson is the stateful source-of-truth for the chart.
  // Prefer vizJsonProp (persisted from DB) over chartConfig (initial AI output).
  const seedViz = vizJsonProp ?? chartConfig ?? null;
  const [vizJson,      setVizJson]      = useState(seedViz);
  const [isAdjusting,  setIsAdjusting]  = useState(false);
  const [tweakError,   setTweakError]   = useState(null);
  const [expanded,     setExpanded]     = useState(false);
  // lightBg is a display-only preference — not persisted to DB
  const [lightBg,      setLightBg]      = useState(false);

  // Ref to the canvas element for PNG export
  const canvasWrapRef = useRef(null);

  // Sync from parent if a new message (different chart) is rendered
  useEffect(() => {
    setVizJson(vizJsonProp ?? chartConfig ?? null);
    setTweakError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartConfig, vizJsonProp]);

  const isTextOnly     = vizJson?.type === 'none' || (!vizJson && !chartConfig);
  const [viewMode,     setViewMode]     = useState(isTextOnly ? 'table' : 'chart');
  const [accordionOpen, setAccordionOpen] = useState(false);

  const rowCount = tableData?.rowCount ?? tableData?.rows?.length ?? 0;
  const colCount = tableData?.columns?.length ?? 0;
  const elapsed  = tableData?.elapsed != null ? `${tableData.elapsed}ms` : null;

  // ── Apply a style tweak via the Viz Modifier ──────────────────────────────
  async function handleTweakApply(tweakText) {
    if (!vizJson) return;
    setIsAdjusting(true);
    setTweakError(null);
    try {
      const updated = await adjustViz(vizJson, tweakText);
      setVizJson(updated);
      onVizUpdate?.(updated);
    } catch (err) {
      setTweakError(err.message);
    } finally {
      setIsAdjusting(false);
    }
  }

  // ── PNG Export ──────────────────────────────────────────────────────────────
  const handleExportPng = useCallback(() => {
    const canvas = canvasWrapRef.current?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${(vizJson?.title ?? 'chart').replace(/\s+/g, '_')}.png`;
    a.click();
  }, [vizJson]);

  // ── Instant Flip (toggles indexAxis — no LLM call) ─────────────────────────
  function handleFlip() {
    const updated = {
      ...vizJson,
      indexAxis: vizJson?.indexAxis === 'y' ? 'x' : 'y',
      xAxisLabel: vizJson?.yAxisLabel,
      yAxisLabel: vizJson?.xAxisLabel
    };
    setVizJson(updated);
    onVizUpdate?.(updated);
  }

  // ── Instant light/dark background toggle (display-only, not persisted) ──────
  const handleThemeToggle = () => setLightBg(l => !l);

  const chartHeight = expanded ? 420 : 280;

  return (
    <div className="w-full space-y-3 animate-fade-in">
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700/50">
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
      <div ref={canvasWrapRef}>
        {viewMode === 'chart' ? (
          isTextOnly ? null :
          // Key on JSON string so Chart.js re-instantiates cleanly on every tweak
          <ChartRenderer
            key={JSON.stringify(vizJson) + lightBg}
            chartConfig={vizJson ?? chartConfig}
            height={chartHeight}
            lightBg={lightBg}
          />
        ) : (
          tableData ? <DataTable tableData={tableData} /> : null
        )}

        {/* No-chart notice */}
        {isTextOnly && (
          <div className="mb-2 flex items-start gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/15 rounded-lg">
            <span className="text-amber-400 text-base leading-none mt-0.5">〝</span>
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <span className="font-semibold text-amber-300">No chart available</span> — this result
              contains only text data. Displaying as a table instead.
            </p>
          </div>
        )}
      </div>

      {/* Viz Tweak Bar — only shown in chart view when there's a chartable config */}
      {viewMode === 'chart' && !isTextOnly && vizJson && (
        <div className="space-y-1.5">
          <VizTweakBar
            onApply={handleTweakApply}
            onExportPng={handleExportPng}
            onFlip={handleFlip}
            onThemeToggle={handleThemeToggle}
            isAdjusting={isAdjusting}
            expanded={expanded}
            onToggleExpand={() => setExpanded(e => !e)}
            lightBg={lightBg}
            vizJson={vizJson}
          />
          {tweakError && (
            <p className="text-xs text-rose-400 px-1">
              ⚠️ Tweak failed: {tweakError}
            </p>
          )}
        </div>
      )}

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
    </div>
  );
}
