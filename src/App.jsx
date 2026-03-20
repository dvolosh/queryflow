import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputBar from './components/InputBar';
import { INITIAL_MESSAGES, EXECUTION_STEPS } from './data/mockData';
import { Database, Wifi, ChevronDown } from 'lucide-react';

function HeaderBar({ dbStatus }) {
  return (
    <header className="flex-shrink-0 h-14 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-900/70 backdrop-blur-sm z-10">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-200">Negative Reviews Analysis</h1>
        <span className="text-slate-600">·</span>
        <span className="text-xs text-slate-500">5 messages</span>
      </div>

      <div className="flex items-center gap-3">
        {/* DB connection status */}
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 transition-colors group">
          <Database size={13} className="text-teal-400" />
          <span className="text-xs text-slate-400 group-hover:text-slate-300">product_db</span>
          <ChevronDown size={12} className="text-slate-600" />
        </button>

        {/* Connection indicator */}
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400" />
          </span>
          <span className="text-xs text-teal-400 font-medium">Connected</span>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isLoading, setIsLoading] = useState(false);
  const [executionStep, setExecutionStep] = useState('');
  const stepIndexRef = useRef(0);
  const stepTimerRef = useRef(null);

  const startLoadingSequence = useCallback(() => {
    setIsLoading(true);
    stepIndexRef.current = 0;
    setExecutionStep(EXECUTION_STEPS[0]);

    stepTimerRef.current = setInterval(() => {
      stepIndexRef.current++;
      if (stepIndexRef.current < EXECUTION_STEPS.length) {
        setExecutionStep(EXECUTION_STEPS[stepIndexRef.current]);
      } else {
        clearInterval(stepTimerRef.current);
      }
    }, 700);
  }, []);

  const stopLoadingSequence = useCallback(() => {
    clearInterval(stepTimerRef.current);
    setIsLoading(false);
    setExecutionStep('');
  }, []);

  const handleSend = useCallback((text) => {
    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      type: 'text',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    startLoadingSequence();

    // Simulate a response after delay
    setTimeout(() => {
      stopLoadingSequence();
      const reply = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        type: 'text',
        content: `I've analyzed your query: *"${text}"*\n\nTo demonstrate this in a production environment, I would execute the generated SQL against your connected database and render an interactive Plotly chart. Connect a live database endpoint in **Settings → Data Sources** to see real results.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, reply]);
    }, EXECUTION_STEPS.length * 700 + 400);
  }, [startLoadingSequence, stopLoadingSequence]);

  const handleClarify = useCallback((msgId, option) => {
    // Inject user's selected clarification as a user message
    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      type: 'text',
      content: option.label,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    startLoadingSequence();

    setTimeout(() => {
      stopLoadingSequence();
      const reply = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        type: 'text',
        content: `Got it! I'll filter for **${option.label}**. Running the sentiment analysis query now...`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, reply]);
    }, EXECUTION_STEPS.length * 700 + 400);
  }, [startLoadingSequence, stopLoadingSequence]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
      />

      {/* Main chat panel */}
      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <HeaderBar />
        <ChatArea
          messages={messages}
          isLoading={isLoading}
          executionStep={executionStep}
          onClarify={handleClarify}
        />
        <InputBar
          onSend={handleSend}
          isLoading={isLoading}
          executionStep={executionStep}
        />
      </main>
    </div>
  );
}
