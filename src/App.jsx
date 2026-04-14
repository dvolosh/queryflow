import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputBar from './components/InputBar';
import { INITIAL_MESSAGES } from './data/mockData';
import {
  sendChatMessage,
  getConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  loadConversationMessages,
  saveMessage,
  updateMessage,
} from './data/api';
import { Database, ChevronDown } from 'lucide-react';

// ── Header ────────────────────────────────────────────────────────────────────
function HeaderBar({ activeTitle }) {
  return (
    <header className="flex-shrink-0 h-14 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-900/70 backdrop-blur-sm z-10">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-200 truncate max-w-xs">
          {activeTitle ?? 'QueryFlow'}
        </h1>
        {activeTitle && (
          <>
            <span className="text-slate-600">·</span>
            <span className="text-xs text-slate-500">ChinookDB</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 transition-colors group">
          <Database size={13} className="text-teal-400" />
          <span className="text-xs text-slate-400 group-hover:text-slate-300">ChinookDB</span>
          <ChevronDown size={12} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400" />
          </span>
          <span className="text-xs text-teal-400 font-medium">Live</span>
        </div>
      </div>
    </header>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Conversation list shown in sidebar
  const [conversations, setConversations]   = useState([]);
  // ID of the currently open conversation (null = "new chat / welcome")
  const [activeConvId, setActiveConvId]     = useState(null);
  // Messages displayed in the chat area — start with just the greeting
  const [messages, setMessages]             = useState([INITIAL_MESSAGES[0]]);

  const [isLoading, setIsLoading]           = useState(false);
  const [executionStep, setExecutionStep]   = useState('');

  // Ref that always holds the latest activeConvId for use inside async callbacks
  const activeConvIdRef = useRef(null);
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  // Used by handleClarify to remember what the original question was
  const lastQuestionRef = useRef('');

  // ── On mount: load conversation list ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const convs = await getConversations();
      setConversations(convs);
      if (convs.length > 0) {
        // Auto-open the most-recently updated conversation
        await openConversation(convs[0].id, convs);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open an existing conversation ─────────────────────────────────────────
  async function openConversation(id, convList) {
    setActiveConvId(id);
    const msgs = await loadConversationMessages(id);
    setMessages(msgs.length > 0 ? msgs : [INITIAL_MESSAGES[0]]);

    // If the last message was an ambiguity, restore the original question ref
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (lastUser) lastQuestionRef.current = lastUser.content;
  }

  // ── New chat ──────────────────────────────────────────────────────────────
  function handleNewChat() {
    setActiveConvId(null);
    setMessages([INITIAL_MESSAGES[0]]); // clean slate — greeting only
    lastQuestionRef.current = '';
  }

  // ── Select a conversation from the sidebar ────────────────────────────────
  async function handleSelectConv(id) {
    if (id === activeConvId || isLoading) return;
    await openConversation(id, conversations);
  }

  // ── Delete a conversation ─────────────────────────────────────────────────
  async function handleDeleteConv(id) {
    await deleteConversation(id);
    const updated = conversations.filter(c => c.id !== id);
    setConversations(updated);

    // If we just deleted the active conversation, go to next or welcome
    if (id === activeConvIdRef.current) {
      if (updated.length > 0) {
        await openConversation(updated[0].id, updated);
      } else {
        setActiveConvId(null);
        setMessages([INITIAL_MESSAGES[0]]); // show only the greeting
      }
    }
  }

  // ── Rename a conversation ─────────────────────────────────────────────────
  async function handleRenameConv(id, newTitle) {
    await renameConversation(id, newTitle);
    setConversations(prev =>
      prev.map(c => c.id === id ? { ...c, title: newTitle } : c)
    );
  }

  // ── Core: persist a message object to DB (fire-and-forget) ───────────────
  function persistMessage(convId, msg) {
    saveMessage(convId, msg).catch(err =>
      console.warn('[App] saveMessage failed:', err.message)
    );
  }

  // ── Core: build an assistant message from a pipeline result ──────────────
  function buildAssistantMessage(result, originalQuestion) {
    // Plain text response (e.g. error_followup, revisualize no-history)
    if (result.type === 'text') {
      return {
        id:        crypto.randomUUID(),
        role:      'assistant',
        type:      'text',
        content:   result.summary ?? 'I encountered an issue. Could you rephrase?',
        timestamp: new Date(),
      };
    }
    if (result.type === 'ambiguity') {
      return {
        id:                   crypto.randomUUID(),
        role:                 'assistant',
        type:                 'ambiguity',
        content:              result.message,
        clarificationOptions: result.options ?? [],
        originalQuestion,
        timestamp:            new Date(),
      };
    }
    return {
      id:          crypto.randomUUID(),
      role:        'assistant',
      type:        'data_block',
      content:     result.summary || 'Here are the results from your query.',
      sql:         result.sql,
      tableData:   result.tableData,
      chartConfig: result.chartConfig,
      vizJson:     result.vizJson ?? result.chartConfig,  // stateful viz source-of-truth
      timestamp:   new Date(),
    };
  }

  // ── Core: run the full agent pipeline and persist both messages ───────────
  /**
   * @param {string}      userText    — question sent to the LLM
   * @param {string|null} context     — optional clarification context (chip label)
   * @param {string|null} displayText — text shown in the user bubble;
   *                                    defaults to userText when null
   */
  async function runAndPersist(userText, context = null, displayText = null) {
    // Determine / create the conversation
    let convId = activeConvIdRef.current;

    if (!convId) {
      convId = crypto.randomUUID();
      const title = userText.length > 60 ? userText.slice(0, 57) + '…' : userText;
      const conv  = { id: convId, title, created_at: Date.now(), updated_at: Date.now() };

      await createConversation({ id: convId, title });

      setActiveConvId(convId);
      activeConvIdRef.current = convId;
      setConversations(prev => [conv, ...prev]);
      setMessages([]);          // clear the welcome screen
    }

    // Snapshot history BEFORE appending the user message (server receives context up to
    // but not including the current turn, matching a typical chat-completion convention)
    const historySnapshot = messages.filter(m => m.id !== 'welcome'); // excludes greeting-only msg

    // User message — show displayText in the bubble (chip label for clarifications)
    const userMsg = {
      id:        crypto.randomUUID(),
      role:      'user',
      type:      'text',
      content:   displayText ?? userText,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    persistMessage(convId, userMsg);

    // Run pipeline
    setIsLoading(true);
    setExecutionStep('🔍 Analyst — evaluating intent...');

    try {
      const result = await sendChatMessage(userText, context, label => setExecutionStep(label), historySnapshot);
      const assistantMsg = buildAssistantMessage(result, userText);

      setMessages(prev => [...prev, assistantMsg]);
      persistMessage(convId, assistantMsg);

      // Bubble conversation to top of sidebar
      setConversations(prev =>
        prev
          .map(c => c.id === convId ? { ...c, updated_at: Date.now() } : c)
          .sort((a, b) => b.updated_at - a.updated_at)
      );
    } catch (err) {
      const errMsg = {
        id:        crypto.randomUUID(),
        role:      'assistant',
        type:      'text',
        content:   `⚠️ **Pipeline error:** ${err.message}\n\nMake sure Ollama is running \`gemma4:e4b\` on port 11434.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
      persistMessage(convId, errMsg);
    } finally {
      setIsLoading(false);
      setExecutionStep('');
    }
  }

  // ── Handle viz tweak updates (persists updated vizJson) ─────────────────────
  function handleVizUpdate(msgId, newVizJson) {
    // 1. Update in-memory state immediately so the chart re-renders
    let updatedMsg = null;
    setMessages(prev =>
      prev.map(m => {
        if (m.id !== msgId) return m;
        updatedMsg = { ...m, vizJson: newVizJson, chartConfig: newVizJson };
        return updatedMsg;
      })
    );

    // 2. Persist via PUT (UPDATE) so it survives conversation reloads.
    //    We cannot rely on the stale `messages` snapshot captured in this
    //    closure, so we rebuild the payload directly.
    const convId = activeConvIdRef.current;
    if (convId && updatedMsg) {
      updateMessage(convId, updatedMsg).catch(err =>
        console.warn('[App] updateMessage failed:', err.message)
      );
    }
  }

  // ── Handle new user message ───────────────────────────────────────────────
  function handleSend(text) {
    lastQuestionRef.current = text;
    runAndPersist(text);
  }

  // ── Handle clarification chip selection ───────────────────────────────────
  function handleClarify(msgId, option) {
    // Find original question from the user message just before the ambiguity msg
    const ambigIdx = messages.findIndex(m => m.id === msgId);
    const prevUser  = [...messages.slice(0, ambigIdx)].reverse().find(m => m.role === 'user');
    const originalQ = prevUser?.content ?? lastQuestionRef.current ?? option.label;

    lastQuestionRef.current = originalQ;

    // Show the chip selection in the user bubble, but send the full original
    // question to the LLM so it has complete context for the follow-up.
    const chipDisplay = `${option.icon}  ${option.label}`;
    runAndPersist(originalQ, option.label, chipDisplay);
  }

  // ── Derive header title from active conversation ───────────────────────────
  const activeTitle = conversations.find(c => c.id === activeConvId)?.title ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        conversations={conversations}
        activeConvId={activeConvId}
        onNew={handleNewChat}
        onSelect={handleSelectConv}
        onDelete={handleDeleteConv}
        onRename={handleRenameConv}
        isLoading={isLoading}
      />

      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <HeaderBar activeTitle={activeTitle} />
        <ChatArea
          messages={messages}
          isLoading={isLoading}
          executionStep={executionStep}
          onClarify={handleClarify}
          onVizUpdate={handleVizUpdate}
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
