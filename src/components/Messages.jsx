import React from 'react';
import { Sparkles, HelpCircle, FileText } from 'lucide-react';
import DataBlock from './DataBlock';

// ── Basic inline Markdown renderer (bold, italic, code, bullets) ──────────────
function MarkdownText({ text }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const rendered = line
          .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100 font-semibold">$1</strong>')
          .replace(/\*(.+?)\*/g, '<em class="text-slate-300 italic">$1</em>')
          .replace(/`(.+?)`/g, '<code class="bg-slate-700/60 text-indigo-300 px-1 rounded text-xs font-mono">$1</code>')
          .replace(/^- /g, '• ');
        if (!line.trim()) return <div key={i} className="h-2" />;
        return (
          <p
            key={i}
            className="text-slate-300 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        );
      })}
    </div>
  );
}

// ── Rich Markdown renderer for structured documents (h1–h3, lists, etc.) ─────
function MarkdownDoc({ markdown }) {
  const lines = markdown.split('\n');

  const renderInline = (text) =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100 font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em class="text-slate-300 italic">$1</em>')
      .replace(/`(.+?)`/g,       '<code class="bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded text-xs font-mono border border-slate-700/50">$1</code>');

  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // H1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      elements.push(
        <h1 key={i} className="text-lg font-bold text-slate-100 mt-1 mb-3 pb-2 border-b border-slate-700/60">
          {trimmed.slice(2)}
        </h1>
      );
      i++; continue;
    }

    // H2
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      elements.push(
        <h2 key={i} className="text-sm font-semibold text-slate-200 uppercase tracking-wider mt-4 mb-2 flex items-center gap-2">
          <span className="w-3 h-0.5 bg-indigo-500 inline-block rounded-full" />
          {trimmed.slice(3)}
        </h2>
      );
      i++; continue;
    }

    // H3
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-sm font-medium text-slate-300 mt-3 mb-1">
          {trimmed.slice(4)}
        </h3>
      );
      i++; continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const text = lines[i].trim().replace(/^\d+\.\s/, '');
        items.push(text);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-1.5 my-2 ml-1">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2.5 text-sm text-slate-300 leading-relaxed">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-300 text-xs flex items-center justify-center font-semibold mt-0.5">
                {idx + 1}
              </span>
              <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-1.5 my-2 ml-1">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2.5 text-sm text-slate-300 leading-relaxed">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-slate-500 mt-2" />
              <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Horizontal rule
    if (trimmed === '---' || trimmed === '___' || trimmed === '***') {
      elements.push(<hr key={i} className="border-slate-700/60 my-3" />);
      i++; continue;
    }

    // Paragraph
    elements.push(
      <p
        key={i}
        className="text-sm text-slate-300 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }}
      />
    );
    i++;
  }

  return <div className="space-y-1">{elements}</div>;
}


function AssistantAvatar() {
  return (
    <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
      <Sparkles size={13} className="text-white" />
    </div>
  );
}

// Plain text messages from user
export function UserMessage({ message }) {
  const time = message.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-end justify-end gap-3 animate-fade-in">
      <div className="max-w-[75%] flex flex-col items-end gap-1">
        <div className="bg-indigo-600 rounded-2xl rounded-br-sm px-4 py-2.5 shadow-lg shadow-indigo-600/25">
          <p className="text-sm text-white leading-relaxed">{message.content}</p>
        </div>
        <span className="text-xs text-slate-600 pr-1">{time}</span>
      </div>
    </div>
  );
}

// Plain assistant text message
export function AssistantTextMessage({ message }) {
  const time = message.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="bg-slate-800/40 border border-slate-700/40 shadow-sm backdrop-blur-sm rounded-2xl rounded-tl-sm px-4 py-3">
          <MarkdownText text={message.content} />
        </div>
        <span className="text-xs text-slate-600 pl-1">{time}</span>
      </div>
    </div>
  );
}

// Assistant message with data block
export function AssistantDataMessage({ message, onVizUpdate }) {
  const time = message.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 space-y-3">
        {/* Prose header */}
        <div className="bg-slate-800/40 border border-slate-700/40 shadow-sm backdrop-blur-sm rounded-2xl rounded-tl-sm px-4 py-3">
          <MarkdownText text={message.content} />
        </div>

        {/* Data block card */}
        <div className="bg-[#050505]/60 border border-slate-700/40 shadow-2xl backdrop-blur-md rounded-2xl p-4 space-y-3">
          <DataBlock
            sql={message.sql}
            tableData={message.tableData}
            chartConfig={message.chartConfig}
            vizJson={message.vizJson}
            onVizUpdate={onVizUpdate ? (newViz) => onVizUpdate(message.id, newViz) : undefined}
          />
        </div>

        <span className="text-xs text-slate-600 pl-1">{time}</span>
      </div>
    </div>
  );
}

// Ambiguity / clarification message with quick-action chips
export function AmbiguityMessage({ message, onSelect }) {
  const time = message.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
        <HelpCircle size={13} className="text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        {/* Message bubble */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl rounded-tl-sm px-4 py-3">
          <MarkdownText text={message.content} />
        </div>

        {/* Quick action chips */}
        <div className="flex flex-wrap gap-2">
          {message.clarificationOptions.map(opt => (
            <button
              key={opt.id}
              onClick={() => onSelect?.(opt)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-indigo-500/60 hover:bg-indigo-500/10 text-sm text-slate-300 hover:text-indigo-300 transition-all duration-150 group shadow-sm"
            >
              <span>{opt.icon}</span>
              <span className="font-medium">{opt.label}</span>
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-600 pl-1">{time}</span>
      </div>
    </div>
  );
}

// Typing indicator
export function TypingIndicator({ step }) {
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <AssistantAvatar />
      <div className="bg-slate-800/40 border border-slate-700/40 shadow-sm backdrop-blur-sm rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="typing-dot w-1.5 h-1.5 bg-indigo-400 rounded-full inline-block" />
          <span className="typing-dot w-1.5 h-1.5 bg-indigo-400 rounded-full inline-block" />
          <span className="typing-dot w-1.5 h-1.5 bg-indigo-400 rounded-full inline-block" />
        </div>
        {step && (
          <span className="text-xs text-slate-500 font-medium">{step}</span>
        )}
      </div>
    </div>
  );
}

// ── Business Recommendation Message ──────────────────────────────────────────
export function RecommendationMessage({ message }) {
  const time = message.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
        <FileText size={13} className="text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="bg-slate-800/40 border border-indigo-500/30 shadow-md shadow-indigo-500/5 backdrop-blur-sm rounded-2xl rounded-tl-sm px-6 py-5">
          <MarkdownDoc markdown={message.content} />
        </div>
        <span className="text-xs text-slate-600 pl-1">{time}</span>
      </div>
    </div>
  );
}
