import React from 'react';
import { Sparkles, HelpCircle } from 'lucide-react';
import DataBlock from './DataBlock';

// Minimal markdown-to-text renderer (bold + italic + line breaks)
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
