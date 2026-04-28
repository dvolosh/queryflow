import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Paperclip, Mic, Command, X, Loader2,
} from 'lucide-react';
import { EXECUTION_STEPS } from '../data/mockData';

export default function InputBar({ onSend, isLoading, executionStep, onRecommend, canRecommend }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  // Speech recognition state
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const recognitionRef = useRef(null);
  const prefixRef = useRef('');

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      // continuous = false so it naturally stops when they pause speaking
      recognition.continuous = false;
      recognition.interimResults = true;
      
      recognition.onstart = () => {
        setIsListening(true);
        // Save whatever was already typed so we can append to it cleanly
        let current = textareaRef.current ? textareaRef.current.value : '';
        if (current && !current.endsWith(' ')) current += ' ';
        prefixRef.current = current;
      };
      
      recognition.onerror = (e) => {
        console.error("Speech API Error:", e.error);
        if (e.error === 'not-allowed' || e.error === 'audio-capture') {
           setIsListening(false);
        }
      };
      
      recognition.onend = () => setIsListening(false);
      
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setValue(prefixRef.current + transcript);
        
        // Auto-resize the textarea
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
        }
      };
      
      recognitionRef.current = recognition;
    } else {
      setIsSpeechSupported(false);
    }
    
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      textareaRef.current?.focus();
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error("Mic start error:", err);
      }
    }
  };

  const handleSubmit = () => {
    if (!value.trim() || isLoading) return;
    onSend(value.trim());
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e) => {
    setValue(e.target.value);
    // Auto-resize
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  };

  const SUGGESTION_CHIPS = [
    'What are the top 10 products by revenue?',
    'Show churn rate trends for Q1',
    'Which regions underperformed this month?',
  ];

  return (
    <div className="flex-shrink-0 border-t border-slate-800/50 bg-transparent backdrop-blur-md px-4 py-4 rounded-b-2xl">
      {/* Execution progress bar */}
      {isLoading && (
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 size={13} className="text-indigo-400 animate-spin" />
              <span className="text-xs font-medium text-indigo-400">{executionStep}</span>
            </div>
            <span className="text-xs text-slate-600">QueryFlow engine</span>
          </div>
          <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-teal-500 rounded-full w-1/3 progress-indeterminate" />
          </div>
        </div>
      )}

      {/* Suggestion chips (only when idle) */}
      {!isLoading && !value && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1 scrollbar-thin">
          {/* Action Button: Business Recommendation */}
          <button
            onClick={onRecommend}
            disabled={!canRecommend}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 transition-all duration-150 whitespace-nowrap ${
              canRecommend
                ? 'border-amber-500/50 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-500 shadow-sm shadow-amber-500/10'
                : 'border-slate-800 text-slate-600 bg-slate-900/50 cursor-not-allowed'
            }`}
            title={canRecommend ? "Generate a business recommendation from this session" : "Ask at least one data question first"}
          >
            💡 Business Insights
          </button>

          {/* Divider */}
          <div className="w-px h-4 bg-slate-700/50 mx-1 flex-shrink-0" />

          {SUGGESTION_CHIPS.map((chip, i) => (
            <button
              key={i}
              onClick={() => setValue(chip)}
              className="flex-shrink-0 text-xs text-slate-400 border border-slate-700 rounded-full px-3 py-1.5 hover:border-indigo-500/50 hover:text-indigo-300 hover:bg-indigo-500/5 transition-all duration-150 whitespace-nowrap"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className={`relative flex items-end gap-3 rounded-2xl border bg-slate-900/50 transition-all duration-300 ${
        isLoading
          ? 'border-indigo-500/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]'
          : 'border-slate-700/80 hover:border-slate-600 focus-within:border-indigo-500/50 focus-within:shadow-[0_0_15px_rgba(139,92,246,0.15)] focus-within:bg-slate-800/80'
      }`}>
        {/* Attachment button */}
        <button
          className="flex-shrink-0 p-3 text-slate-500 hover:text-slate-300 transition-colors"
          title="Attach file"
          disabled={isLoading}
        >
          <Paperclip size={16} />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? 'Processing your query...' : 'Ask anything about your data...'}
          disabled={isLoading}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none py-3 pr-1 min-h-[44px] max-h-40 disabled:opacity-50 leading-relaxed"
          style={{ lineHeight: '1.6' }}
        />

        {/* Right actions */}
        <div className="flex items-center gap-1 p-2">
          {/* Keyboard shortcut hint */}
          <div className="hidden sm:flex items-center gap-1 mr-1">
            <kbd className="text-[10px] text-slate-600 bg-slate-700/60 px-1.5 py-0.5 rounded font-mono">⌘</kbd>
            <kbd className="text-[10px] text-slate-600 bg-slate-700/60 px-1.5 py-0.5 rounded font-mono">↵</kbd>
          </div>

          {isSpeechSupported && (
            <button
              onClick={toggleListening}
              className={`p-1.5 transition-all duration-300 rounded-full ${
                isListening 
                  ? 'text-rose-400 bg-rose-500/10 shadow-[0_0_10px_rgba(244,63,94,0.3)]' 
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
              }`}
              title={isListening ? "Stop listening" : "Voice input"}
              disabled={isLoading}
            >
              <Mic size={16} className={isListening ? 'animate-pulse' : ''} />
            </button>
          )}

          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isLoading}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 ${
              value.trim() && !isLoading
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/30 scale-100'
                : 'bg-slate-700/50 text-slate-600 cursor-not-allowed scale-95'
            }`}
            title="Send message"
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-slate-600 mt-2">
        QueryFlow is read-only · All queries use <code className="text-slate-500 font-mono">SELECT</code> statements only
      </p>
    </div>
  );
}
